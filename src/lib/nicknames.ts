import type { PeerInfo } from '../types/room'

const MARIO_NICKNAMES = [
  'Mario',
  'Luigi',
  'Peach',
  'Toad',
  'Yoshi',
  'Rosalina',
  'Daisy',
  'Waluigi',
  'Wario',
  'Bowser',
  'Koopa',
  'Shy Guy',
  'Boo',
  'Kamek',
  'Birdo',
]

export function randomMarioNickname(): string {
  return MARIO_NICKNAMES[Math.floor(Math.random() * MARIO_NICKNAMES.length)]
}

export function resolveUniqueNickname(
  desired: string,
  peers: PeerInfo[],
  peerId: string,
): string {
  const trimmed = desired.trim()
  if (!trimmed) return trimmed

  const taken = new Set(
    peers
      .filter((peer) => peer.peerId !== peerId)
      .map((peer) => peer.nickname.toLowerCase()),
  )

  if (!taken.has(trimmed.toLowerCase())) {
    return trimmed
  }

  let suffix = 2
  while (taken.has(`${trimmed}-${suffix}`.toLowerCase())) {
    suffix += 1
  }

  return `${trimmed}-${suffix}`
}
