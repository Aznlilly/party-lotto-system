const USER_COLORS = [
  '#ff6b6b',
  '#ffd54f',
  '#81c784',
  '#64b5f6',
  '#ba68c8',
  '#4dd0e1',
  '#ffb74d',
  '#f06292',
  '#aed581',
  '#9575cd',
  '#4fc3f7',
  '#ff8a65',
]

export function colorForPeer(peerId: string): string {
  let hash = 0
  for (let i = 0; i < peerId.length; i += 1) {
    hash = (hash * 31 + peerId.charCodeAt(i)) >>> 0
  }
  return USER_COLORS[hash % USER_COLORS.length]
}
