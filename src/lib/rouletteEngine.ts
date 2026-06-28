export function mulberry32(seed: number): () => number {
  let t = seed >>> 0
  return () => {
    t += 0x6d2b79f5
    let r = Math.imul(t ^ (t >>> 15), 1 | t)
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r)
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296
  }
}

export type RouletteAnimation = {
  startT: number
  distance: number
  durationMs: number
  winnerT: number
}

export function easeOutQuint(progress: number): number {
  const t = Math.min(Math.max(progress, 0), 1)
  return 1 - Math.pow(1 - t, 5)
}

export function buildRouletteAnimation(
  seed: number,
  winnerT: number,
): RouletteAnimation {
  const rand = mulberry32(seed)
  const startT = rand()
  const laps = 3 + Math.floor(rand() * 2)
  const delta = (winnerT - startT + 1) % 1
  const distance = laps + delta
  const durationMs = 3200 + laps * 700

  return {
    startT,
    distance,
    durationMs,
    winnerT,
  }
}

export function highlightPositionAtProgress(
  animation: RouletteAnimation,
  progress: number,
): number {
  const eased = easeOutQuint(progress)
  return (animation.startT + eased * animation.distance) % 1
}

export function getRouletteDuration(animation: RouletteAnimation): number {
  return animation.durationMs
}

export function pickRandomIndex(seed: number, count: number): number {
  if (count <= 0) return 0
  const rand = mulberry32(seed)
  return Math.floor(rand() * count)
}
