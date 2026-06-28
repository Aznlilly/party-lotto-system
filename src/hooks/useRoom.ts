import { useCallback, useEffect, useRef, useState } from 'react'
import { joinRoom, selfId } from 'trystero'
import type { MessageAction } from 'trystero'
import {
  APP_ID,
  COUNTDOWN_SECONDS,
  type AddMoviePayload,
  type AnnouncePayload,
  type ChatPayload,
  type MovieEntry,
  type PeerInfo,
  type RoomState,
  createInitialState,
  electHost,
} from '../types/room'
import {
  buildRouletteAnimation,
  getRouletteDuration,
  pickRandomIndex,
} from '../lib/rouletteEngine'
import { getMoviePerimeterPosition } from '../lib/perimeterLayout'
import { toTrysteroRoomId } from '../lib/roomCode'

type UseRoomResult = {
  roomState: RoomState
  myPeerId: string
  isHost: boolean
  peers: PeerInfo[]
  peerCount: number
  connected: boolean
  connectionError: string | null
  crawlOffsetRef: React.MutableRefObject<number>
  sendChat: (text: string) => void
  addMovie: (payload: Omit<AddMoviePayload, 'addedBy' | 'addedByPeerId'>) => Promise<string | null>
  startCountdown: () => void
  resetRound: () => void
}

function generateId(): string {
  return crypto.randomUUID()
}

function hasPeerVoted(movies: MovieEntry[], peerId: string): boolean {
  return movies.some((movie) => movie.addedByPeerId === peerId)
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
  return stateRevision(remote) > stateRevision(local)
}

export function useRoom(roomCode: string, nickname: string): UseRoomResult {
  const myPeerId = selfId
  const joinedAtRef = useRef(Date.now())
  const peersRef = useRef<Map<string, PeerInfo>>(new Map())
  const stateRef = useRef<RoomState>(createInitialState(myPeerId))
  const crawlOffsetRef = useRef(0)
  const rouletteTimerRef = useRef<number | null>(null)
  const isHostRef = useRef(false)
  const hasSyncedFromHostRef = useRef(false)
  const hasAnnouncedRef = useRef(false)
  const awaitingPeerListRef = useRef(false)
  const broadcastRef = useRef<(state: RoomState) => void>(() => {})
  const sendStateToPeerRef = useRef<(state: RoomState, peerId: string) => void>(() => {})

  const chatActionRef = useRef<MessageAction<ChatPayload> | null>(null)
  const addMovieActionRef = useRef<MessageAction<AddMoviePayload> | null>(null)

  const [roomState, setRoomState] = useState<RoomState>(() =>
    createInitialState(myPeerId),
  )
  const [peerCount, setPeerCount] = useState(1)
  const [peers, setPeers] = useState<PeerInfo[]>(() => [
    { peerId: myPeerId, nickname, joinedAt: joinedAtRef.current },
  ])
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
    peersRef.current.set(myPeerId, {
      peerId: myPeerId,
      nickname,
      joinedAt: joinedAtRef.current,
    })

    const trysteroRoomId = toTrysteroRoomId(roomCode)
    const room = joinRoom({ appId: APP_ID }, trysteroRoomId)

    const announceAction = room.makeAction<AnnouncePayload>('announce')
    const stateAction = room.makeAction<RoomState>('stateSync')
    const requestAction = room.makeAction<{ requesterId: string }>('requestState')
    const chatAction = room.makeAction<ChatPayload>('chat')
    const addMovieAction = room.makeAction<AddMoviePayload>('addMovie')
    const leaveAction = room.makeAction<{ peerId: string }>('peerLeave')

    chatActionRef.current = chatAction
    addMovieActionRef.current = addMovieAction

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

    const requestStateFromHost = () => {
      if (isHostRef.current || hasSyncedFromHostRef.current) return
      void requestAction.send({ requesterId: myPeerId })
    }

    const startSyncRetry = () => {
      if (syncRetryTimer !== undefined || isHostRef.current || hasSyncedFromHostRef.current) {
        return
      }

      let attempts = 0
      syncRetryTimer = window.setInterval(() => {
        if (isHostRef.current || hasSyncedFromHostRef.current) {
          stopSyncRetry()
          return
        }

        attempts += 1
        requestStateFromHost()
        if (attempts >= 12) {
          stopSyncRetry()
        }
      }, 1500)
    }

    const updatePeerCount = () => {
      setPeerCount(peersRef.current.size)
      setPeers(
        Array.from(peersRef.current.values()).sort((a, b) => a.joinedAt - b.joinedAt),
      )
    }

    const resolveHostRole = () => {
      const peerList = Array.from(peersRef.current.values())
      const electedId = electHost(peerList)
      const amElected = electedId === myPeerId

      if (peerList.length > 1) {
        awaitingPeerListRef.current = false
      }

      let amHost = false
      if (amElected && !hasSyncedFromHostRef.current) {
        amHost = !(awaitingPeerListRef.current && peerList.length === 1)
      } else if (amElected && hasSyncedFromHostRef.current) {
        amHost = true
        hasSyncedFromHostRef.current = false
      }

      isHostRef.current = amHost
      setIsHost(amHost)

      if (amHost) {
        stopSyncRetry()
        if (stateRef.current.hostPeerId !== myPeerId) {
          hostCommit({ ...stateRef.current, hostPeerId: myPeerId }, true)
        }
        return
      }

      if (!hasSyncedFromHostRef.current) {
        requestStateFromHost()
        startSyncRetry()
      }
    }

    const pushStateToPeer = (peerId: string) => {
      if (!isHostRef.current || peerId === myPeerId) return

      const now = Date.now()
      const lastSent = lastPushAt.get(peerId) ?? 0
      if (now - lastSent < 500) return
      lastPushAt.set(peerId, now)

      sendStateToPeerRef.current(stateRef.current, peerId)
    }

    const announceOnce = () => {
      if (hasAnnouncedRef.current) return
      hasAnnouncedRef.current = true
      void announceAction.send({
        peerId: myPeerId,
        nickname,
        joinedAt: joinedAtRef.current,
      })
    }

    announceAction.onMessage = (data) => {
      const isNewPeer = !peersRef.current.has(data.peerId)
      peersRef.current.set(data.peerId, data)
      updatePeerCount()
      resolveHostRole()

      if (isHostRef.current && isNewPeer && data.peerId !== myPeerId) {
        pushStateToPeer(data.peerId)
      }
    }

    stateAction.onMessage = (state, context) => {
      const fromPeerId = context?.peerId
      if (!fromPeerId || fromPeerId === myPeerId) return
      if (isHostRef.current) return
      if (fromPeerId !== state.hostPeerId) return
      if (!shouldApplyRemoteState(stateRef.current, state)) return

      hasSyncedFromHostRef.current = true
      isHostRef.current = false
      setIsHost(false)
      stateRef.current = state
      setRoomState(state)
      stopSyncRetry()
    }

    requestAction.onMessage = (data) => {
      if (!isHostRef.current) return
      pushStateToPeer(data.requesterId)
    }

    leaveAction.onMessage = (data) => {
      if (data.peerId === myPeerId) return
      peersRef.current.delete(data.peerId)
      lastPushAt.delete(data.peerId)
      updatePeerCount()
      resolveHostRole()
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

    room.onPeerJoin = () => {
      if (peersRef.current.size === 1 && !isHostRef.current) {
        awaitingPeerListRef.current = true
      }
      setConnected(true)
      setConnectionError(null)
      announceOnce()
    }

    room.onPeerLeave = (peerId) => {
      if (peerId === myPeerId) return
      peersRef.current.delete(peerId)
      lastPushAt.delete(peerId)
      updatePeerCount()
      resolveHostRole()
    }

    const connectTimer = window.setTimeout(() => {
      setConnected(true)
      announceOnce()
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

    return () => {
      hasSyncedFromHostRef.current = false
      hasAnnouncedRef.current = false
      awaitingPeerListRef.current = false
      window.removeEventListener('pagehide', handlePageHide)
      window.clearTimeout(connectTimer)
      stopSyncRetry()
      window.clearInterval(countdownCheck)
      if (rouletteTimerRef.current) window.clearTimeout(rouletteTimerRef.current)
      chatActionRef.current = null
      addMovieActionRef.current = null
      broadcastRef.current = () => {}
      sendStateToPeerRef.current = () => {}
      void leaveAction.send({ peerId: myPeerId })
      void room.leave()
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
                nickname,
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
      const payload = { text: trimmed, nickname, peerId: myPeerId }
      if (hostPeerId && hostPeerId !== myPeerId) {
        void chatActionRef.current?.send(payload, { target: hostPeerId })
      } else {
        void chatActionRef.current?.send(payload)
      }
    },
    [nickname, myPeerId, hostCommit],
  )

  const addMovie = useCallback(
    async (
      payload: Omit<AddMoviePayload, 'addedBy' | 'addedByPeerId'>,
    ): Promise<string | null> => {
      const data: AddMoviePayload = {
        ...payload,
        addedBy: nickname,
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
    [nickname, myPeerId, hostCommit],
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

  return {
    roomState,
    myPeerId,
    isHost,
    peers,
    peerCount,
    connected,
    connectionError,
    crawlOffsetRef,
    sendChat,
    addMovie,
    startCountdown,
    resetRound,
  }
}
