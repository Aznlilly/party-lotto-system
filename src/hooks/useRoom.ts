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

function statesEqual(a: RoomState, b: RoomState): boolean {
  return (
    a.phase === b.phase &&
    a.hostPeerId === b.hostPeerId &&
    a.countdownEndsAt === b.countdownEndsAt &&
    a.winnerId === b.winnerId &&
    a.rouletteSeed === b.rouletteSeed &&
    a.frozenOffset === b.frozenOffset &&
    a.movies.length === b.movies.length &&
    a.messages.length === b.messages.length &&
    a.movies.every((movie, index) => movie.id === b.movies[index]?.id) &&
    a.messages.every((message, index) => message.id === b.messages[index]?.id)
  )
}

export function useRoom(roomCode: string, nickname: string): UseRoomResult {
  const myPeerId = selfId
  const joinedAtRef = useRef(Date.now())
  const peersRef = useRef<Map<string, PeerInfo>>(new Map())
  const stateRef = useRef<RoomState>(createInitialState(myPeerId))
  const crawlOffsetRef = useRef(0)
  const rouletteTimerRef = useRef<number | null>(null)
  const isHostRef = useRef(false)
  const hasSeenRemotePeerRef = useRef(false)
  const hasHostStateRef = useRef(false)
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

  const commitState = useCallback((next: RoomState, shouldBroadcast: boolean) => {
    if (!isHostRef.current) return

    stateRef.current = next
    setRoomState(next)
    if (shouldBroadcast) {
      broadcastRef.current(next)
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

    broadcastRef.current = (state) => {
      void stateAction.send(state)
    }

    sendStateToPeerRef.current = (state, peerId) => {
      void stateAction.send(state, { target: peerId })
    }

    let syncRetryTimer: ReturnType<typeof window.setInterval> | undefined

    const stopSyncRetry = () => {
      if (syncRetryTimer !== undefined) {
        window.clearInterval(syncRetryTimer)
        syncRetryTimer = undefined
      }
    }

    const requestStateFromHost = () => {
      if (isHostRef.current || hasHostStateRef.current) return
      void requestAction.send({ requesterId: myPeerId })
    }

    const startSyncRetry = () => {
      if (syncRetryTimer !== undefined || isHostRef.current || hasHostStateRef.current) return

      let attempts = 0
      syncRetryTimer = window.setInterval(() => {
        if (isHostRef.current || hasHostStateRef.current) {
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
      let amHost = electedId === myPeerId

      if (amHost && hasSeenRemotePeerRef.current && peerList.length === 1) {
        amHost = false
      }

      isHostRef.current = amHost
      setIsHost(amHost)

      if (amHost) {
        stopSyncRetry()
        if (stateRef.current.hostPeerId !== myPeerId) {
          commitState({ ...stateRef.current, hostPeerId: myPeerId }, true)
        }
        return
      }

      if (!hasHostStateRef.current) {
        requestStateFromHost()
        startSyncRetry()
      }
    }

    const pushStateToPeer = (peerId: string) => {
      if (!isHostRef.current || peerId === myPeerId) return
      sendStateToPeerRef.current(stateRef.current, peerId)
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
      resolveHostRole()

      if (data.peerId !== myPeerId) {
        announceSelf()
        pushStateToPeer(data.peerId)
      }
    }

    stateAction.onMessage = (state, context) => {
      const fromPeerId = context?.peerId
      if (!fromPeerId || fromPeerId === myPeerId) return

      if (isHostRef.current) return
      if (fromPeerId !== state.hostPeerId) return
      if (statesEqual(stateRef.current, state)) return

      hasHostStateRef.current = true
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
      updatePeerCount()
      resolveHostRole()
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
      hasSeenRemotePeerRef.current = true
      setConnected(true)
      setConnectionError(null)
      announceSelf()
      resolveHostRole()
    }

    room.onPeerLeave = (peerId) => {
      if (peerId === myPeerId) return
      peersRef.current.delete(peerId)
      updatePeerCount()
      resolveHostRole()
    }

    const connectTimer = window.setTimeout(() => {
      setConnected(true)
      announceSelf()
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
      hasSeenRemotePeerRef.current = false
      hasHostStateRef.current = false
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
