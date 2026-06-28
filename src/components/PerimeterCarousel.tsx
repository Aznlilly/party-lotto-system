import {
  memo,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
} from 'react'
import type { MovieEntry, RoomPhase } from '../types/room'
import { CRAWL_LAP_MS } from '../types/room'
import {
  buildRouletteAnimation,
  highlightPositionAtProgress,
} from '../lib/rouletteEngine'
import {
  computeDynamicTileSize,
  getMoviePerimeterPosition,
  positionOnPerimeter,
  type PerimeterConfig,
} from '../lib/perimeterLayout'
import styles from './PerimeterCarousel.module.css'

type Props = {
  movies: MovieEntry[]
  phase: RoomPhase
  frozenOffset?: number
  crawlOffsetRef: MutableRefObject<number>
  winnerId?: string
  rouletteSeed?: number
}

function applyTileTransforms(
  movies: MovieEntry[],
  config: PerimeterConfig,
  offset: number,
  tileRefs: Map<string, HTMLDivElement>,
) {
  movies.forEach((movie, index) => {
    const el = tileRefs.get(movie.id)
    if (!el) return
    const t = getMoviePerimeterPosition(index, movies.length, offset)
    const point = positionOnPerimeter(config, t)
    el.style.transform = `translate3d(${point.x}px, ${point.y}px, 0)`
  })
}

function PerimeterCarouselInner({
  movies,
  phase,
  frozenOffset,
  crawlOffsetRef,
  winnerId,
  rouletteSeed,
}: Props) {
  const [size, setSize] = useState({ width: window.innerWidth, height: window.innerHeight })
  const [highlightPosition, setHighlightPosition] = useState<number | null>(null)
  const frozenOffsetRef = useRef(frozenOffset ?? crawlOffsetRef.current)
  const tileRefs = useRef(new Map<string, HTMLDivElement>())
  const moviesRef = useRef(movies)
  const configRef = useRef<PerimeterConfig | null>(null)

  moviesRef.current = movies

  useEffect(() => {
    const onResize = () => {
      setSize({ width: window.innerWidth, height: window.innerHeight })
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const isCrawling = phase === 'collecting' || phase === 'countdown'

  const tileSize = useMemo(
    () => computeDynamicTileSize(size.width, size.height, movies.length),
    [size.width, size.height, movies.length],
  )

  const config: PerimeterConfig = useMemo(
    () => ({
      width: size.width,
      height: size.height,
      tileWidth: tileSize.tileWidth,
      tileHeight: tileSize.tileHeight,
      padding: tileSize.padding,
      insets: tileSize.insets,
    }),
    [size.width, size.height, tileSize],
  )

  configRef.current = config

  const movieIds = useMemo(() => movies.map((movie) => movie.id).join(','), [movies])

  useEffect(() => {
    if (phase === 'frozen' || phase === 'roulette' || phase === 'winner' || phase === 'revealed') {
      frozenOffsetRef.current = frozenOffset ?? crawlOffsetRef.current
    }
  }, [phase, frozenOffset, crawlOffsetRef])

  useEffect(() => {
    if (!isCrawling) return

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reducedMotion) return

    let frame = 0
    let last = performance.now()
    let currentOffset = crawlOffsetRef.current

    const tick = (now: number) => {
      const delta = now - last
      last = now
      currentOffset = (currentOffset + delta / CRAWL_LAP_MS) % 1
      crawlOffsetRef.current = currentOffset

      const liveConfig = configRef.current
      if (liveConfig) {
        applyTileTransforms(moviesRef.current, liveConfig, currentOffset, tileRefs.current)
      }

      frame = requestAnimationFrame(tick)
    }

    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [isCrawling, movieIds, crawlOffsetRef])

  useEffect(() => {
    if (isCrawling) return
    const liveConfig = configRef.current
    if (!liveConfig) return
    applyTileTransforms(
      moviesRef.current,
      liveConfig,
      frozenOffsetRef.current,
      tileRefs.current,
    )
  }, [isCrawling, movieIds, phase, frozenOffset])

  useEffect(() => {
    if (phase !== 'roulette' || !rouletteSeed || !winnerId || movies.length === 0) {
      setHighlightPosition(null)
      return
    }

    const winnerIndex = movies.findIndex((movie) => movie.id === winnerId)
    if (winnerIndex < 0) return

    const offset = frozenOffsetRef.current
    const winnerT = getMoviePerimeterPosition(winnerIndex, movies.length, offset)
    const animation = buildRouletteAnimation(rouletteSeed, winnerT)

    let cancelled = false
    let frame = 0
    const startTime = performance.now()

    const tick = (now: number) => {
      if (cancelled) return

      const elapsed = now - startTime
      const progress = Math.min(elapsed / animation.durationMs, 1)
      const position = highlightPositionAtProgress(animation, progress)
      setHighlightPosition(position)

      if (progress >= 1) {
        setHighlightPosition(animation.winnerT)
        return
      }

      frame = requestAnimationFrame(tick)
    }

    frame = requestAnimationFrame(tick)

    return () => {
      cancelled = true
      cancelAnimationFrame(frame)
    }
  }, [phase, movieIds, winnerId, rouletteSeed, movies.length])

  const staticOffset =
    phase === 'frozen' ||
    phase === 'roulette' ||
    phase === 'winner' ||
    phase === 'revealed'
      ? frozenOffsetRef.current
      : crawlOffsetRef.current

  const winnerHighlightPosition = useMemo(() => {
    if ((phase !== 'winner' && phase !== 'revealed') || !winnerId || movies.length === 0) {
      return null
    }

    const winnerIndex = movies.findIndex((movie) => movie.id === winnerId)
    if (winnerIndex < 0) return null

    return getMoviePerimeterPosition(winnerIndex, movies.length, staticOffset)
  }, [phase, winnerId, movies, staticOffset])

  const activeHighlightPosition = highlightPosition ?? winnerHighlightPosition

  const highlightPoint =
    activeHighlightPosition == null
      ? null
      : positionOnPerimeter(config, activeHighlightPosition)

  if (movies.length === 0) return null

  return (
    <div
      className={`${styles.layer} ${styles.layerBack}`}
      aria-hidden={phase === 'winner'}
      style={
        {
          '--tile-width': `${tileSize.tileWidth}px`,
        } as React.CSSProperties
      }
    >
      {movies.map((movie, index) => {
        const t = getMoviePerimeterPosition(index, movies.length, staticOffset)
        const point = positionOnPerimeter(config, t)
        const isWinner =
          (phase === 'winner' || phase === 'revealed') && movie.id === winnerId

        return (
          <div
            key={movie.id}
            ref={(el) => {
              if (el) tileRefs.current.set(movie.id, el)
              else tileRefs.current.delete(movie.id)
            }}
            className={`${styles.tile} ${isWinner ? styles.winnerTile : ''}`}
            style={{
              transform: `translate3d(${point.x}px, ${point.y}px, 0)`,
              width: tileSize.tileWidth,
              height: tileSize.tileHeight,
            }}
          >
            {movie.posterUrl ? (
              <img src={movie.posterUrl} alt={movie.title} loading="lazy" />
            ) : (
              <div className={styles.placeholder}>
                <span>{movie.title}</span>
              </div>
            )}
          </div>
        )
      })}

      {highlightPoint && (
        <div
          className={styles.highlightRing}
          style={{
            transform: `translate3d(${highlightPoint.x}px, ${highlightPoint.y}px, 0)`,
            width: tileSize.tileWidth,
            height: tileSize.tileHeight,
          }}
        />
      )}
    </div>
  )
}

function carouselPropsEqual(prev: Props, next: Props): boolean {
  if (
    prev.phase !== next.phase ||
    prev.frozenOffset !== next.frozenOffset ||
    prev.winnerId !== next.winnerId ||
    prev.rouletteSeed !== next.rouletteSeed ||
    prev.crawlOffsetRef !== next.crawlOffsetRef ||
    prev.movies.length !== next.movies.length
  ) {
    return false
  }

  return prev.movies.every((movie, index) => movie.id === next.movies[index]?.id)
}

export const PerimeterCarousel = memo(PerimeterCarouselInner, carouselPropsEqual)
