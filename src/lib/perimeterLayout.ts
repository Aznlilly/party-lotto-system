export type Point = { x: number; y: number }

export type Slot = {
  index: number
  x: number
  y: number
  edge: 'top' | 'right' | 'bottom' | 'left'
}

export type PerimeterInsets = {
  top: number
  right: number
  bottom: number
  left: number
}

export type SafeRect = {
  top: number
  right: number
  bottom: number
  left: number
}

export type PerimeterConfig = {
  width: number
  height: number
  tileWidth: number
  tileHeight: number
  padding: number
  insets: PerimeterInsets
}

const POSTER_ASPECT = 3 / 2

export type TileDimensions = {
  tileWidth: number
  tileHeight: number
  padding: number
  insets: PerimeterInsets
}

/** Keeps the crawl path outside the centered chat / movie panel. */
export function computeUiSafeRect(viewportWidth: number, viewportHeight: number): SafeRect {
  const headerHeight = 72
  const mainHorizontalPadding = 16
  const panelWidth = Math.min(viewportWidth - mainHorizontalPadding * 2, 720)
  const mainAreaHeight = Math.max(viewportHeight - headerHeight, 0)
  const panelHeight = Math.min(mainAreaHeight * 0.72, 640)
  const panelLeft = (viewportWidth - panelWidth) / 2
  const panelTop = headerHeight + Math.max((mainAreaHeight - panelHeight) / 2, 0)
  const buffer = 24

  return {
    left: panelLeft - buffer,
    top: panelTop - buffer,
    right: panelLeft + panelWidth + buffer,
    bottom: panelTop + panelHeight + buffer,
  }
}

function maxTileWidthForSafeRect(
  safeRect: SafeRect,
  viewportWidth: number,
  viewportHeight: number,
  padding: number,
): number {
  const horizontalClearance = Math.min(
    safeRect.left - padding,
    viewportWidth - padding - safeRect.right,
  )
  const verticalClearance = Math.min(
    safeRect.top - padding,
    viewportHeight - padding - safeRect.bottom,
  )
  const fromVertical = verticalClearance / POSTER_ASPECT

  return Math.max(0, Math.min(horizontalClearance, fromVertical))
}

export function computeDynamicTileSize(
  viewportWidth: number,
  viewportHeight: number,
  movieCount: number,
): TileDimensions {
  const count = Math.max(movieCount, 1)
  const shortSide = Math.min(viewportWidth, viewportHeight)
  const padding = Math.max(10, Math.min(22, Math.round(shortSide * 0.014)))
  const insets: PerimeterInsets = {
    top: padding,
    right: padding,
    bottom: padding,
    left: padding,
  }
  const safeRect = computeUiSafeRect(viewportWidth, viewportHeight)
  const safeMaxWidth = maxTileWidthForSafeRect(
    safeRect,
    viewportWidth,
    viewportHeight,
    padding,
  )
  const minWidth = shortSide < 480 ? 44 : shortSide < 768 ? 56 : 68
  const maxWidth = Math.min(
    shortSide < 768 ? 108 : 176,
    Math.round(shortSide * 0.24),
    safeMaxWidth > 0 ? Math.floor(safeMaxWidth) : minWidth,
  )
  const gapFraction = 0.1

  function perimeterFor(tileWidth: number): number {
    const tileHeight = Math.round(tileWidth * POSTER_ASPECT)
    const top = Math.max(viewportWidth - insets.left - insets.right - tileWidth, 0)
    const side = Math.max(viewportHeight - insets.top - insets.bottom - tileHeight, 0)
    return 2 * top + 2 * side || 1
  }

  function fits(tileWidth: number): boolean {
    if (tileWidth > safeMaxWidth) return false
    const arcLength = perimeterFor(tileWidth) / count
    return tileWidth <= arcLength * (1 - gapFraction)
  }

  let lo = minWidth
  let hi = Math.max(minWidth, maxWidth)

  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2)
    if (fits(mid)) lo = mid
    else hi = mid - 1
  }

  const tileWidth = lo
  const tileHeight = Math.round(tileWidth * POSTER_ASPECT)

  return { tileWidth, tileHeight, padding, insets }
}

function getEdgeLengths(config: PerimeterConfig) {
  const { width, height, tileWidth, tileHeight, insets } = config
  const innerW = width - insets.left - insets.right - tileWidth
  const innerH = height - insets.top - insets.bottom - tileHeight
  return {
    top: Math.max(innerW, 0),
    right: Math.max(innerH, 0),
    bottom: Math.max(innerW, 0),
    left: Math.max(innerH, 0),
  }
}

function getPerimeterLength(config: PerimeterConfig): number {
  const edges = getEdgeLengths(config)
  return edges.top + edges.right + edges.bottom + edges.left || 1
}

export function positionOnPerimeter(config: PerimeterConfig, t: number): Point {
  const { width, height, tileWidth, tileHeight, insets } = config
  const edges = getEdgeLengths(config)
  const perimeter = getPerimeterLength(config)
  const wrapped = ((t % 1) + 1) % 1
  const dist = wrapped * perimeter

  if (dist <= edges.top) {
    return { x: insets.left + dist, y: insets.top }
  }
  if (dist <= edges.top + edges.right) {
    return {
      x: width - insets.right - tileWidth,
      y: insets.top + (dist - edges.top),
    }
  }
  if (dist <= edges.top + edges.right + edges.bottom) {
    return {
      x: width - insets.right - tileWidth - (dist - edges.top - edges.right),
      y: height - insets.bottom - tileHeight,
    }
  }
  return {
    x: insets.left,
    y: height - insets.bottom - tileHeight - (dist - edges.top - edges.right - edges.bottom),
  }
}

export function getMoviePerimeterPosition(
  movieIndex: number,
  movieCount: number,
  offset: number,
): number {
  if (movieCount <= 0) return 0
  return ((movieIndex / movieCount) + offset) % 1
}

export function computeSlots(config: PerimeterConfig, slotCount: number): Slot[] {
  if (slotCount <= 0) return []

  return Array.from({ length: slotCount }, (_, index) => {
    const t = (index + 0.5) / slotCount
    const point = positionOnPerimeter(config, t)
    return { index, ...point, edge: 'top' as const }
  })
}

export function assignMoviesToSlots<T>(
  movies: T[],
  slotCount: number,
  offset: number,
): (T | null)[] {
  if (slotCount === 0) return []
  const shift = Math.floor(offset * slotCount) % slotCount
  const result: (T | null)[] = Array.from({ length: slotCount }, () => null)

  movies.forEach((movie, movieIndex) => {
    const slotIndex = (movieIndex + shift) % slotCount
    result[slotIndex] = movie
  })

  return result
}

export function getMovieSlotIndex(
  movieIndex: number,
  movieCount: number,
  slotCount: number,
  offset: number,
): number {
  if (movieCount === 0 || slotCount === 0) return 0
  const shift = Math.floor(offset * slotCount) % slotCount
  return (movieIndex + shift) % slotCount
}
