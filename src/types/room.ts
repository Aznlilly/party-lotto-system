export type RoomPhase = 'collecting' | 'countdown' | 'frozen' | 'roulette' | 'winner'

export type MovieEntry = {
  id: string
  externalId: string
  title: string
  posterUrl: string | null
  addedBy: string
  addedByPeerId: string
  addedAt: number
}

export type ChatMessage = {
  id: string
  peerId: string
  nickname: string
  text: string
  timestamp: number
}

export type RoomState = {
  hostPeerId: string
  revision: number
  movies: MovieEntry[]
  messages: ChatMessage[]
  phase: RoomPhase
  countdownEndsAt?: number
  winnerId?: string
  rouletteSeed?: number
  frozenOffset?: number
}

export type PeerInfo = {
  peerId: string
  nickname: string
  joinedAt: number
}

export type AnnouncePayload = PeerInfo

export type StateSyncPayload = RoomState

export type ChatPayload = {
  text: string
  nickname: string
  peerId: string
}

export type AddMoviePayload = {
  externalId: string
  title: string
  posterUrl: string | null
  addedBy: string
  addedByPeerId: string
}

export type StartCountdownPayload = {
  durationSeconds: number
}

export const APP_ID = 'party-movie-lotto-v1'
export const COUNTDOWN_SECONDS = 30
export const CRAWL_LAP_MS = 60000

export function isBootstrapState(state: RoomState): boolean {
  return (
    state.movies.length === 0 &&
    state.messages.length === 0 &&
    state.phase === 'collecting' &&
    state.countdownEndsAt === undefined &&
    state.winnerId === undefined
  )
}

export function hasRoomContent(state: RoomState): boolean {
  return !isBootstrapState(state)
}

export function createInitialState(hostPeerId: string): RoomState {
  return {
    hostPeerId,
    revision: 0,
    movies: [],
    messages: [],
    phase: 'collecting',
  }
}

export function electHost(peers: PeerInfo[]): string {
  if (peers.length === 0) return ''
  const sorted = [...peers].sort((a, b) => {
    if (a.joinedAt !== b.joinedAt) return a.joinedAt - b.joinedAt
    return a.peerId.localeCompare(b.peerId)
  })
  return sorted[0].peerId
}
