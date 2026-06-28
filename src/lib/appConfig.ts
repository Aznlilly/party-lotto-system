function parsePositiveInt(raw: string | undefined, fallback: number): number {
  if (!raw?.trim()) return fallback
  const parsed = Number.parseInt(raw.trim(), 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

export const COUNTDOWN_SECONDS = parsePositiveInt(
  import.meta.env.VITE_COUNTDOWN_SECONDS,
  10,
)
