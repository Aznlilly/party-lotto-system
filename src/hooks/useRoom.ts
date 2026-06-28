import { useCallback, useEffect, useRef, useState } from 'react'
import { joinRoom, selfId } from 'trystero'
import type { MessageAction } from 'trystero'
import {
  APP_ID,
  type AddMoviePayload,
  type AnnouncePayload,
  type ChatPayload,
  type ChatMessage,
  type MovieEntry,
  type PeerInfo,
  type RoomState,
  createInitialState,
  electHost,
} from '../types/room'
import { COUNTDOWN_SECONDS } from '../lib/appConfig'
import {
  buildRouletteAnimation,
  getRouletteDuration,
  pickRandomIndex,
} from '../lib/rouletteEngine'
import { getMoviePerimeterPosition } from '../lib/perimeterLayout'
import { resolveUniqueNickname } from '../lib/nicknames'
import { toTrysteroRoomId } from '../lib/roomCode'
import { getTrysteroConnectionConfig, formatPeerConnectionError } from '../lib/webrtcConfig'

type UseRoomResult = {
  roomState: RoomState
  myPeerId: string
  isHost: boolean
  connected: boolean
  connectionError: string | null
  crawlOffsetRef: React.MutableRefObject<number>
  sendChat: (text: string) => void
  addMovie: (payload: Omit<AddMoviePayload, 'addedBy' | 'addedByPeerId'>) => Promise<string | null>
  startCountdown: () => void
  resetRound: () => void
  dismissWinner: () => void
}

function generateId(): string {
  return crypto.randomUUID()
}

function hasPeerVoted(movies: MovieEntry[], peerId: string): boolean {
  return movies.some((movie) => movie.addedByPeerId === peerId)
}

function createWinnerAnnouncement(winner: MovieEntry | undefined): ChatMessage {
  return {
    id: generateId(),
    peerId: 'system',
    nickname: 'Party Lotto',
    text: winner
      ? `Tonight's pick: ${winner.title} (added by ${winner.addedBy})`
      : 'A winner was selected!',
    timestamp: Date.now(),
    kind: 'winner-announcement',
  }
}

function hasWinnerAnnouncement(messages: ChatMessage[]): boolean {
  return messages.some((message) => message.kind === 'winner-announcement')
}

function createMovieEntry(data: AddMoviePayload): MovieEntry {
  return {
    id: generateId(),
    externalId: data.externalId,
    title: data.title,
    posterUrl: data.posterUrl,
    addedBy: data.addedBy,
    addedByPeerId: data.addedByPeerId,
    addedAt: Date.now(),
  }
}

function stateRevision(state: RoomState): number {
  return state.revision ?? 0
}

function shouldApplyRemoteState(local: RoomState, remote: RoomState): boolean {
  if (stateRevision(remote) > stateRevision(local)) return true
  return (
    stateRevision(remote) >= stateRevision(local) &&
    peersRosterChanged(local.peers, remote.peers)
  )
}

function isWaitingForHostSnapshot(
  hasRemotePeer: boolean,
  peerCount: number,
  hasSyncedFromHost: boolean,
): boolean {
  return hasRemotePeer && peerCount === 1 && !hasSyncedFromHost
}

function sortedPeers(peers: Iterable<PeerInfo>): PeerInfo[] {
  return Array.from(peers).sort((a, b) => {
    if (a.joinedAt !== b.joinedAt) return a.joinedAt - b.joinedAt
    return a.peerId.localeCompare(b.peerId)
  })
}

function peersRosterChanged(current: PeerInfo[], next: PeerInfo[]): boolean {
  if (current.length !== next.length) return true
  return next.some(
    (peer, index) =>
      peer.peerId !== current[index]?.peerId ||
      peer.nickname !== current[index]?.nickname,
  )
}

function buildAuthoritativePeers(peers: Iterable<PeerInfo>): PeerInfo[] {
  const committed: PeerInfo[] = []
  for (const peer of sortedPeers(peers)) {
    committed.push({
      ...peer,
      nickname: resolveUniqueNickname(peer.nickname, committed, peer.peerId),
    })
  }
  return committed
}

function syncAssignedNickname(
  state: RoomState,
  myPeerId: string,
  nicknameRef: React.MutableRefObject<string>,
  selfPeerRef: React.MutableRefObject<PeerInfo>,
  peersRef: React.MutableRefObject<Map<string, PeerInfo>>,
): void {
  const me = state.peers.find((peer) => peer.peerId === myPeerId)
  if (!me || me.nickname === nicknameRef.current) return

  nicknameRef.current = me.nickname
  sessionStorage.setItem('party-lotto-nickname', me.nickname)
  selfPeerRef.current = { ...selfPeerRef.current, nickname: me.nickname }
  peersRef.current.set(myPeerId, selfPeerRef.current)
}

export function useRoom(roomCode: string, nickname: string): UseRoomResult {
  const myPeerId = selfId
  const joinedAtRef = useRef(Date.now())
  const nicknameRef = useRef(nickname)
  const selfPeerRef = useRef<PeerInfo>({
    peerId: myPeerId,
    nickname,
    joinedAt: joinedAtRef.current,
  })
  const peersRef = useRef<Map<string, PeerInfo>>(new Map())
  const stateRef = useRef<RoomState>(
    createInitialState(myPeerId, selfPeerRef.current),
  )
  const crawlOffsetRef = useRef(0)
  const rouletteTimerRef = useRef<number | null>(null)
  const isHostRef = useRef(false)
  const hasSyncedFromHostRef = useRef(false)
  const hasAnnouncedRef = useRef(false)
  const hasRemotePeerRef = useRef(false)
  const expectExistingRoomRef = useRef(
    sessionStorage.getItem('party-lotto-expect-existing') === '1',
  )
  const broadcastRef = useRef<(state: RoomState) => void>(() => {})
  const sendStateToPeerRef = useRef<(state: RoomState, peerId: string) => void>(() => {})

  const chatActionRef = useRef<MessageAction<ChatPayload> | null>(null)
  const addMovieActionRef = useRef<MessageAction<AddMoviePayload> | null>(null)
  const announceActionRef = useRef<MessageAction<AnnouncePayload> | null>(null)
  const dismissWinnerActionRef = useRef<MessageAction<Record<string, never>> | null>(null)

  const [roomState, setRoomState] = useState<RoomState>(() =>
    createInitialState(myPeerId, selfPeerRef.current),
  )
  const [connected, setConnected] = useState(false)
  const [connectionError, setConnectionError] = useState<string | null>(null)
  const [isHost, setIsHost] = useState(true)

  const hostCommit = useCallback((next: RoomState, shouldBroadcast: boolean) => {
    if (!isHostRef.current) return

    const stamped: RoomState = {
      ...next,
      revision: stateRevision(stateRef.current) + 1,
    }

    stateRef.current = stamped
    setRoomState(stamped)
    if (isHostRef.current) {
      peersRef.current.clear()
      for (const peer of stamped.peers) {
        peersRef.current.set(peer.peerId, peer)
      }
    }
    if (shouldBroadcast) {
      broadcastRef.current(stamped)
    }
  }, [])

  const beginRoulette = useCallback((frozenOffset: number, movies: MovieEntry[]) => {
    if (movies.length === 0) return

    const rouletteSeed = Date.now()
    const winnerIndex =
      movies.length === 1 ? 0 : pickRandomIndex(rouletteSeed, movies.length)
    const winnerId = movies[winnerIndex].id
    const winnerT = getMoviePerimeterPosition(winnerIndex, movies.length, frozenOffset)
    const animation = buildRouletteAnimation(rouletteSeed, winnerT)
    const duration = getRouletteDuration(animation)

    hostCommit(
      {
        ...stateRef.current,
        phase: movies.length === 1 ? 'winner' : 'roulette',
        frozenOffset,
        winnerId,
        rouletteSeed,
      },
      true,
    )

    if (movies.length === 1) return

    if (rouletteTimerRef.current) window.clearTimeout(rouletteTimerRef.current)
    rouletteTimerRef.current = window.setTimeout(() => {
      hostCommit(
        {
          ...stateRef.current,
          phase: 'winner',
        },
        true,
      )
    }, duration + 150)
  }, [hostCommit])

  useEffect(() => {
    nicknameRef.current = nickname
    selfPeerRef.current = {
      peerId: myPeerId,
      nickname,
      joinedAt: joinedAtRef.current,
    }
    peersRef.current.set(myPeerId, selfPeerRef.current)

    const trysteroRoomId = toTrysteroRoomId(roomCode)
    let cancelled = false
    let teardown: (() => void) | undefined

    void getTrysteroConnectionConfig().then((connectionConfig) => {
      if (cancelled) return

      const room = joinRoom(
        {
          appId: APP_ID,
          ...connectionConfig,
        },
        trysteroRoomId,
        {
          onJoinError: (details) => {
            setConnectionError(formatPeerConnectionError(details.error))
          },
        },
      )

    const announceAction = room.makeAction<AnnouncePayload>('announce')
    const stateAction = room.makeAction<RoomState>('stateSync')
    const requestAction = room.makeAction<{ requesterId: string }>('requestState')
    const requestAnnounceAction = room.makeAction<{ requesterId: string }>('requestAnnounce')
    const chatAction = room.makeAction<ChatPayload>('chat')
    const addMovieAction = room.makeAction<AddMoviePayload>('addMovie')
    const dismissWinnerAction = room.makeAction<Record<string, never>>('dismissWinner')
    const leaveAction = room.makeAction<{ peerId: string }>('peerLeave')

    announceActionRef.current = announceAction
    chatActionRef.current = chatAction
    addMovieActionRef.current = addMovieAction
    dismissWinnerActionRef.current = dismissWinnerAction

    broadcastRef.current = (state) => {
      void stateAction.send(state)
    }

    sendStateToPeerRef.current = (state, peerId) => {
      void stateAction.send(state, { target: peerId })
    }

    let syncRetryTimer: ReturnType<typeof window.setInterval> | undefined
    const lastPushAt = new Map<string, number>()

    const stopSyncRetry = () => {
      if (syncRetryTimer !== undefined) {
        window.clearInterval(syncRetryTimer)
        syncRetryTimer = undefined
      }
    }

    const needsHostSync = () => {
      if (hasSyncedFromHostRef.current) return false
      if (isWaitingForHostSnapshot(
        hasRemotePeerRef.current,
        peersRef.current.size,
        hasSyncedFromHostRef.current,
      )) {
        return true
      }
      return !isHostRef.current
    }

    const requestStateFromHost = () => {
      if (!needsHostSync()) return

      const payload = { requesterId: myPeerId }
      const hostPeerId = stateRef.current.hostPeerId
      if (hostPeerId && hostPeerId !== myPeerId) {
        void requestAction.send(payload, { target: hostPeerId })
        return
      }

      const connectedIds = Object.keys(room.getPeers())
      if (connectedIds.length > 0) {
        for (const peerId of connectedIds) {
          void requestAction.send(payload, { target: peerId })
        }
        return
      }

      void requestAction.send(payload)
    }

    const startSyncRetry = () => {
      if (syncRetryTimer !== undefined || !needsHostSync()) {
        return
      }

      let attempts = 0
      syncRetryTimer = window.setInterval(() => {
        if (!needsHostSync()) {
          stopSyncRetry()
          return
        }

        attempts += 1
        requestStateFromHost()
        if (!expectExistingRoomRef.current && attempts >= 30) {
          stopSyncRetry()
        }
      }, 1500)
    }

    const syncHostRoleFromState = () => {
      const amHost = stateRef.current.hostPeerId === myPeerId
      isHostRef.current = amHost
      setIsHost(amHost)
    }

    const resolveHostRole = () => {
      if (hasSyncedFromHostRef.current) {
        syncHostRoleFromState()
        return
      }

      const peerList = sortedPeers(peersRef.current.values())
      const electedId = electHost(peerList)
      let amHost = electedId === myPeerId

      if (isWaitingForHostSnapshot(
        hasRemotePeerRef.current,
        peerList.length,
        hasSyncedFromHostRef.current,
      )) {
        amHost = false
      }

      if (
        !hasRemotePeerRef.current &&
        expectExistingRoomRef.current &&
        !hasSyncedFromHostRef.current
      ) {
        amHost = false
      }

      isHostRef.current = amHost
      setIsHost(amHost)

      if (amHost) {
        stopSyncRetry()
        const nextPeers = buildAuthoritativePeers(peersRef.current.values())
        for (const peer of nextPeers) {
          peersRef.current.set(peer.peerId, peer)
        }
        const hostChanged = stateRef.current.hostPeerId !== myPeerId
        const peersChanged = peersRosterChanged(stateRef.current.peers, nextPeers)
        if (hostChanged || peersChanged) {
          hostCommit(
            { ...stateRef.current, hostPeerId: myPeerId, peers: nextPeers },
            true,
          )
        }
        return
      }

      requestStateFromHost()
      startSyncRetry()
    }

    const pushStateToPeer = (peerId: string) => {
      if (!isHostRef.current || peerId === myPeerId) return

      const now = Date.now()
      const lastSent = lastPushAt.get(peerId) ?? 0
      if (now - lastSent < 500) return
      lastPushAt.set(peerId, now)

      sendStateToPeerRef.current(stateRef.current, peerId)
    }

    const sendAnnounce = (targetPeerId?: string) => {
      const payload: AnnouncePayload = {
        peerId: myPeerId,
        nickname: nicknameRef.current,
        joinedAt: joinedAtRef.current,
      }

      if (targetPeerId) {
        void announceAction.send(payload, { target: targetPeerId })
        return
      }

      void announceAction.send(payload)
    }

    const announceToHost = () => {
      const hostPeerId = stateRef.current.hostPeerId
      if (hostPeerId && hostPeerId !== myPeerId) {
        sendAnnounce(hostPeerId)
        if (hasAnnouncedRef.current) return
        hasAnnouncedRef.current = true
        window.setTimeout(() => sendAnnounce(hostPeerId), 1200)
        window.setTimeout(() => sendAnnounce(hostPeerId), 3500)
        return
      }

      if (hasAnnouncedRef.current) return
      hasAnnouncedRef.current = true
      sendAnnounce()
      window.setTimeout(() => sendAnnounce(), 1200)
      window.setTimeout(() => sendAnnounce(), 3500)
    }

    const promptPeerToAnnounce = (peerId: string) => {
      if (!isHostRef.current || peerId === myPeerId) return
      if (stateRef.current.peers.some((peer) => peer.peerId === peerId)) return

      void requestAnnounceAction.send({ requesterId: myPeerId }, { target: peerId })
    }

    const reconcileConnectedPeers = () => {
      if (!isHostRef.current) return

      for (const peerId of Object.keys(room.getPeers())) {
        promptPeerToAnnounce(peerId)
      }
    }

    const ensureRegisteredWithHost = () => {
      if (isHostRef.current || !hasSyncedFromHostRef.current) return
      if (stateRef.current.peers.some((peer) => peer.peerId === myPeerId)) return

      hasAnnouncedRef.current = false
      announceToHost()
    }

    const syncHostPeersFromState = () => {
      peersRef.current.clear()
      for (const peer of stateRef.current.peers) {
        peersRef.current.set(peer.peerId, peer)
      }
    }

    const commitPeerRoster = (peerId: string) => {
      const nextPeers = buildAuthoritativePeers(peersRef.current.values())
      for (const peer of nextPeers) {
        peersRef.current.set(peer.peerId, peer)
      }
      if (!peersRosterChanged(stateRef.current.peers, nextPeers)) {
        pushStateToPeer(peerId)
        return
      }

      hostCommit({ ...stateRef.current, peers: nextPeers }, true)
      pushStateToPeer(peerId)
    }

    announceAction.onMessage = (data) => {
      if (!isHostRef.current) {
        if (!hasSyncedFromHostRef.current) {
          peersRef.current.set(data.peerId, data)
          resolveHostRole()
        }
        return
      }

      peersRef.current.set(data.peerId, data)
      if (data.peerId === myPeerId) return

      commitPeerRoster(data.peerId)
    }

    stateAction.onMessage = (state, context) => {
      const fromPeerId = context?.peerId
      if (!fromPeerId || fromPeerId === myPeerId) return
      if (fromPeerId !== state.hostPeerId) return

      if (isHostRef.current && state.hostPeerId === myPeerId) {
        return
      }

      if (isHostRef.current && state.hostPeerId !== myPeerId) {
        isHostRef.current = false
        setIsHost(false)
      }

      if (!hasSyncedFromHostRef.current) {
        hasSyncedFromHostRef.current = true
        stateRef.current = state
        setRoomState(state)
        syncAssignedNickname(state, myPeerId, nicknameRef, selfPeerRef, peersRef)
        syncHostRoleFromState()
        if (isHostRef.current) {
          syncHostPeersFromState()
        }
        ensureRegisteredWithHost()
        setConnectionError(null)
        stopSyncRetry()
        return
      }

      if (!shouldApplyRemoteState(stateRef.current, state)) return

      stateRef.current = state
      setRoomState(state)
      syncAssignedNickname(state, myPeerId, nicknameRef, selfPeerRef, peersRef)
      syncHostRoleFromState()
      ensureRegisteredWithHost()
      setConnectionError(null)
      stopSyncRetry()
    }

    requestAction.onMessage = (data) => {
      if (!isHostRef.current) return
      pushStateToPeer(data.requesterId)
      promptPeerToAnnounce(data.requesterId)
    }

    requestAnnounceAction.onMessage = (_data, context) => {
      const requesterId = context?.peerId
      if (!requesterId) return
      sendAnnounce(requesterId)
    }

    const removePeer = (peerId: string) => {
      if (!isHostRef.current || peerId === myPeerId) return
      if (!peersRef.current.has(peerId)) return

      peersRef.current.delete(peerId)
      lastPushAt.delete(peerId)

      const nextPeers = sortedPeers(peersRef.current.values())
      if (peersRosterChanged(stateRef.current.peers, nextPeers)) {
        hostCommit({ ...stateRef.current, peers: nextPeers }, true)
      }
      resolveHostRole()
    }

    leaveAction.onMessage = (data) => {
      removePeer(data.peerId)
    }

    chatAction.onMessage = (data, context) => {
      if (!isHostRef.current || context.peerId === myPeerId) return

      hostCommit(
        {
          ...stateRef.current,
          messages: [
            ...stateRef.current.messages,
            {
              id: generateId(),
              peerId: data.peerId,
              nickname: data.nickname,
              text: data.text,
              timestamp: Date.now(),
            },
          ],
        },
        true,
      )
    }

    addMovieAction.onMessage = (data, context) => {
      if (!isHostRef.current || context.peerId === myPeerId) return
      if (hasPeerVoted(stateRef.current.movies, data.addedByPeerId)) return

      hostCommit(
        {
          ...stateRef.current,
          movies: [...stateRef.current.movies, createMovieEntry(data)],
        },
        true,
      )
    }

    const commitWinnerDismissal = () => {
      if (stateRef.current.phase !== 'winner') return

      const winner = stateRef.current.movies.find(
        (movie) => movie.id === stateRef.current.winnerId,
      )
      const messages = hasWinnerAnnouncement(stateRef.current.messages)
        ? stateRef.current.messages
        : [...stateRef.current.messages, createWinnerAnnouncement(winner)]

      hostCommit(
        {
          ...stateRef.current,
          phase: 'revealed',
          messages,
        },
        true,
      )
    }

    dismissWinnerAction.onMessage = (_data, context) => {
      if (!isHostRef.current || context.peerId === myPeerId) return
      commitWinnerDismissal()
    }

    room.onPeerJoin = (peerId) => {
      hasRemotePeerRef.current = true
      setConnected(true)
      setConnectionError(null)

      // Trystero delivers actions reliably when targeted to the peer that just joined.
      sendAnnounce(peerId)
      if (isHostRef.current) {
        promptPeerToAnnounce(peerId)
        window.setTimeout(() => promptPeerToAnnounce(peerId), 1500)
        window.setTimeout(() => promptPeerToAnnounce(peerId), 4000)
      } else {
        announceToHost()
      }
      resolveHostRole()
    }

    room.onPeerLeave = (peerId) => {
      removePeer(peerId)
    }

    const connectTimer = window.setTimeout(() => {
      setConnected(true)
      announceToHost()
      resolveHostRole()
    }, 800)

    const handlePageHide = () => {
      void leaveAction.send({ peerId: myPeerId })
      void room.leave()
    }

    window.addEventListener('pagehide', handlePageHide)

    const countdownCheck = window.setInterval(() => {
      if (!isHostRef.current) return
      const state = stateRef.current
      if (state.phase !== 'countdown' || !state.countdownEndsAt) return

      if (Date.now() >= state.countdownEndsAt) {
        const frozenOffset = crawlOffsetRef.current % 1
        hostCommit(
          {
            ...state,
            phase: 'frozen',
            frozenOffset,
          },
          true,
        )
        window.setTimeout(() => {
          beginRoulette(frozenOffset, stateRef.current.movies)
        }, 400)
      }
    }, 200)

    const rosterReconcileTimer = window.setInterval(reconcileConnectedPeers, 5000)

    const connectionWatchdog = window.setTimeout(() => {
      if (hasSyncedFromHostRef.current) return

      const connectedPeerCount = Object.keys(room.getPeers()).length
      const rosterCount = stateRef.current.peers.length

      if (expectExistingRoomRef.current && rosterCount === 1 && connectedPeerCount === 0) {
        setConnectionError(
          `Can't find room "${roomCode}". Use the exact invite link from the host — room names must match exactly (spacing and spelling).`,
        )
        return
      }

      if (
        isHostRef.current &&
        rosterCount === 1 &&
        connectedPeerCount === 0 &&
        !expectExistingRoomRef.current
      ) {
        setConnectionError(
          'You are alone in this room. Share the invite link below so friends join the same room.',
        )
      }
    }, 15000)

    teardown = () => {
      hasSyncedFromHostRef.current = false
      hasAnnouncedRef.current = false
      hasRemotePeerRef.current = false
      window.removeEventListener('pagehide', handlePageHide)
      window.clearTimeout(connectTimer)
      window.clearTimeout(connectionWatchdog)
      stopSyncRetry()
      window.clearInterval(countdownCheck)
      window.clearInterval(rosterReconcileTimer)
      if (rouletteTimerRef.current) window.clearTimeout(rouletteTimerRef.current)
      announceActionRef.current = null
      chatActionRef.current = null
      addMovieActionRef.current = null
      dismissWinnerActionRef.current = null
      broadcastRef.current = () => {}
      sendStateToPeerRef.current = () => {}
      void leaveAction.send({ peerId: myPeerId })
      void room.leave()
    }
    })

    return () => {
      cancelled = true
      teardown?.()
    }
  }, [roomCode, nickname, myPeerId, hostCommit, beginRoulette])

  const sendChat = useCallback(
    (text: string) => {
      const trimmed = text.trim()
      if (!trimmed) return

      if (isHostRef.current) {
        hostCommit(
          {
            ...stateRef.current,
            messages: [
              ...stateRef.current.messages,
              {
                id: generateId(),
                peerId: myPeerId,
                nickname: nicknameRef.current,
                text: trimmed,
                timestamp: Date.now(),
              },
            ],
          },
          true,
        )
        return
      }

      const hostPeerId = stateRef.current.hostPeerId
      const payload = { text: trimmed, nickname: nicknameRef.current, peerId: myPeerId }
      if (hostPeerId && hostPeerId !== myPeerId) {
        void chatActionRef.current?.send(payload, { target: hostPeerId })
      } else {
        void chatActionRef.current?.send(payload)
      }
    },
    [myPeerId, hostCommit],
  )

  const addMovie = useCallback(
    async (
      payload: Omit<AddMoviePayload, 'addedBy' | 'addedByPeerId'>,
    ): Promise<string | null> => {
      const data: AddMoviePayload = {
        ...payload,
        addedBy: nicknameRef.current,
        addedByPeerId: myPeerId,
      }

      if (hasPeerVoted(stateRef.current.movies, myPeerId)) {
        return 'You already picked a movie'
      }

      if (isHostRef.current) {
        hostCommit(
          {
            ...stateRef.current,
            movies: [...stateRef.current.movies, createMovieEntry(data)],
          },
          true,
        )
        return null
      }

      const hostPeerId = stateRef.current.hostPeerId
      if (hostPeerId && hostPeerId !== myPeerId) {
        void addMovieActionRef.current?.send(data, { target: hostPeerId })
      } else {
        void addMovieActionRef.current?.send(data)
      }
      return null
    },
    [myPeerId, hostCommit],
  )

  const startCountdown = useCallback(() => {
    if (!isHostRef.current || stateRef.current.movies.length === 0) return
    if (stateRef.current.phase !== 'collecting') return

    hostCommit(
      {
        ...stateRef.current,
        phase: 'countdown',
        countdownEndsAt: Date.now() + COUNTDOWN_SECONDS * 1000,
      },
      true,
    )
  }, [hostCommit])

  const resetRound = useCallback(() => {
    if (!isHostRef.current) return
    if (stateRef.current.phase !== 'collecting' && stateRef.current.phase !== 'revealed') {
      return
    }

    hostCommit(
      {
        ...stateRef.current,
        phase: 'collecting',
        movies: [],
        countdownEndsAt: undefined,
        winnerId: undefined,
        rouletteSeed: undefined,
        frozenOffset: undefined,
      },
      true,
    )
  }, [hostCommit])

  const dismissWinner = useCallback(() => {
    if (stateRef.current.phase !== 'winner') return

    if (isHostRef.current) {
      const winner = stateRef.current.movies.find(
        (movie) => movie.id === stateRef.current.winnerId,
      )
      const messages = hasWinnerAnnouncement(stateRef.current.messages)
        ? stateRef.current.messages
        : [...stateRef.current.messages, createWinnerAnnouncement(winner)]

      hostCommit(
        {
          ...stateRef.current,
          phase: 'revealed',
          messages,
        },
        true,
      )
      return
    }

    const hostPeerId = stateRef.current.hostPeerId
    if (hostPeerId && hostPeerId !== myPeerId) {
      void dismissWinnerActionRef.current?.send({}, { target: hostPeerId })
    } else {
      void dismissWinnerActionRef.current?.send({})
    }
  }, [myPeerId, hostCommit])

  return {
    roomState,
    myPeerId,
    isHost,
    connected,
    connectionError,
    crawlOffsetRef,
    sendChat,
    addMovie,
    startCountdown,
    resetRound,
    dismissWinner,
  }
}
