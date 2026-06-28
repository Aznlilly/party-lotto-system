import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
  hasRoomContent,
  isBootstrapState,
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

export function useRoom(roomCode: string, nickname: string): UseRoomResult {
  const myPeerId = selfId
  const joinedAtRef = useRef(Date.now())
  const peersRef = useRef<Map<string, PeerInfo>>(new Map())
  const stateRef = useRef<RoomState>(createInitialState(myPeerId))
  const crawlOffsetRef = useRef(0)
  const rouletteTimerRef = useRef<number | null>(null)
  const isHostRef = useRef(true)
  const authoritativeHostRef = useRef(false)
  const hasRemotePeerRef = useRef(false)
  const receivedRemoteStateRef = useRef(false)
  const broadcastRef = useRef<(state: RoomState) => void>(() => {})

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

  const commitState = useCallback((next: RoomState, shouldBroadcast: boolean) => {
    if (
      !receivedRemoteStateRef.current &&
      !hasRemotePeerRef.current &&
      hasRoomContent(next) &&
      next.hostPeerId === myPeerId
    ) {
      authoritativeHostRef.current = true
      isHostRef.current = true
    }

    stateRef.current = next
    setRoomState(next)
    if (shouldBroadcast && isHostRef.current && authoritativeHostRef.current) {
      broadcastRef.current(next)
    }
  }, [myPeerId])

  const isHost = useMemo(
    () => roomState.hostPeerId === myPeerId,
    [roomState.hostPeerId, myPeerId],
  )

  const beginRoulette = useCallback((frozenOffset: number, movies: MovieEntry[]) => {
    if (movies.length === 0) return

    const rouletteSeed = Date.now()
    const winnerIndex =
      movies.length === 1 ? 0 : pickRandomIndex(rouletteSeed, movies.length)
    const winnerId = movies[winnerIndex].id
    const winnerT = getMoviePerimeterPosition(winnerIndex, movies.length, frozenOffset)
    const animation = buildRouletteAnimation(rouletteSeed, winnerT)
    const duration = getRouletteDuration(animation)

    commitState(
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
      commitState(
        {
          ...stateRef.current,
          phase: 'winner',
        },
        true,
      )
    }, duration + 150)
  }, [commitState])

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

    broadcastRef.current = (state: RoomState) => {
      void stateAction.send(state)
    }

    let receivedRemoteState = false
    receivedRemoteStateRef.current = false
    hasRemotePeerRef.current = false

    const syncFullStateToPeers = () => {
      if (!isHostRef.current || !authoritativeHostRef.current) return
      if (
        hasRemotePeerRef.current &&
        isBootstrapState(stateRef.current) &&
        !receivedRemoteState
      ) {
        return
      }
      broadcastRef.current(stateRef.current)
    }

    const requestFullState = () => {
      void requestAction.send({ requesterId: myPeerId })
    }

    const tryClaimAuthoritativeHost = () => {
      if (receivedRemoteState || hasRemotePeerRef.current) return
      if (electHost(Array.from(peersRef.current.values())) !== myPeerId) return

      authoritativeHostRef.current = true
      isHostRef.current = true
      if (stateRef.current.hostPeerId !== myPeerId) {
        commitState({ ...stateRef.current, hostPeerId: myPeerId }, true)
      } else if (hasRoomContent(stateRef.current)) {
        syncFullStateToPeers()
      }
    }

    let stateRetryTimer: ReturnType<typeof window.setInterval> | undefined

    const stopStateRetry = () => {
      if (stateRetryTimer !== undefined) {
        window.clearInterval(stateRetryTimer)
        stateRetryTimer = undefined
      }
    }

    const updatePeerCount = () => {
      setPeerCount(peersRef.current.size)
      setPeers(
        Array.from(peersRef.current.values()).sort((a, b) => a.joinedAt - b.joinedAt),
      )
    }

    const reelectHost = () => {
      const peerList = Array.from(peersRef.current.values())
      const newHostId = electHost(peerList)
      if (!newHostId) return

      const amHost = newHostId === myPeerId
      isHostRef.current = amHost

      if (amHost) {
        if (hasRemotePeerRef.current && !receivedRemoteState) {
          authoritativeHostRef.current = false
          requestFullState()
        } else {
          authoritativeHostRef.current = true
        }
      } else {
        authoritativeHostRef.current = false
      }

      if (newHostId === stateRef.current.hostPeerId) return

      commitState(
        {
          ...stateRef.current,
          hostPeerId: newHostId,
        },
        true,
      )
    }

    const handlePeerLeave = (peerId: string) => {
      if (peerId === myPeerId) return
      peersRef.current.delete(peerId)
      updatePeerCount()
      reelectHost()
    }

    const announceSelf = () => {
      void announceAction.send({
        peerId: myPeerId,
        nickname,
        joinedAt: joinedAtRef.current,
      })
    }

    announceAction.onMessage = (data) => {
      peersRef.current.set(data.peerId, data)
      updatePeerCount()
      reelectHost()
      syncFullStateToPeers()

      if (data.peerId !== myPeerId) {
        announceSelf()
      }
    }

    stateAction.onMessage = (state, context) => {
      if (context?.peerId === myPeerId) return

      const local = stateRef.current

      if (authoritativeHostRef.current) {
        return
      }

      if (hasRoomContent(local) && isBootstrapState(state)) {
        return
      }

      receivedRemoteState = true
      receivedRemoteStateRef.current = true
      authoritativeHostRef.current = false
      isHostRef.current = state.hostPeerId === myPeerId
      stateRef.current = state
      setRoomState(state)
      stopStateRetry()
    }

    requestAction.onMessage = () => {
      syncFullStateToPeers()
    }

    leaveAction.onMessage = (data) => {
      handlePeerLeave(data.peerId)
    }

    chatAction.onMessage = (data, context) => {
      if (!isHostRef.current || context.peerId === myPeerId) return

      commitState(
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

      commitState(
        {
          ...stateRef.current,
          movies: [...stateRef.current.movies, createMovieEntry(data)],
        },
        true,
      )
    }

    room.onPeerJoin = () => {
      hasRemotePeerRef.current = true
      setConnected(true)
      setConnectionError(null)
      announceSelf()
      requestFullState()
    }

    room.onPeerLeave = (peerId) => {
      handlePeerLeave(peerId)
    }

    const connectTimer = window.setTimeout(() => {
      setConnected(true)
      announceSelf()
      reelectHost()
      requestFullState()
      tryClaimAuthoritativeHost()
    }, 1500)

    const bootstrapTimer = window.setTimeout(() => {
      tryClaimAuthoritativeHost()
    }, 2800)

    let stateRetryCount = 0
    stateRetryTimer = window.setInterval(() => {
      if (receivedRemoteState || authoritativeHostRef.current) {
        stopStateRetry()
        return
      }
      stateRetryCount += 1
      if (stateRetryCount > 8) {
        stopStateRetry()
        return
      }
      requestFullState()
    }, 1200)

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
        commitState(
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
      hasRemotePeerRef.current = false
      receivedRemoteStateRef.current = false
      window.removeEventListener('pagehide', handlePageHide)
      window.clearTimeout(connectTimer)
      window.clearTimeout(bootstrapTimer)
      stopStateRetry()
      window.clearInterval(countdownCheck)
      if (rouletteTimerRef.current) window.clearTimeout(rouletteTimerRef.current)
      chatActionRef.current = null
      addMovieActionRef.current = null
      broadcastRef.current = () => {}
      void leaveAction.send({ peerId: myPeerId })
      void room.leave()
    }
  }, [roomCode, nickname, myPeerId, commitState, beginRoulette])

  const sendChat = useCallback(
    (text: string) => {
      const trimmed = text.trim()
      if (!trimmed) return

      if (isHostRef.current) {
        commitState(
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
      } else {
        void chatActionRef.current?.send({
          text: trimmed,
          nickname,
          peerId: myPeerId,
        })
      }
    },
    [nickname, myPeerId, commitState],
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
        commitState(
          {
            ...stateRef.current,
            movies: [...stateRef.current.movies, createMovieEntry(data)],
          },
          true,
        )
        return null
      }

      void addMovieActionRef.current?.send(data)
      return null
    },
    [nickname, myPeerId, commitState],
  )

  const startCountdown = useCallback(() => {
    if (!isHostRef.current || stateRef.current.movies.length === 0) return
    if (stateRef.current.phase !== 'collecting') return

    commitState(
      {
        ...stateRef.current,
        phase: 'countdown',
        countdownEndsAt: Date.now() + COUNTDOWN_SECONDS * 1000,
      },
      true,
    )
  }, [commitState])

  const resetRound = useCallback(() => {
    if (!isHostRef.current) return

    commitState(
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
  }, [commitState])

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
