import type { MovieEntry } from '../types/room'
import { getTmdbMovieUrl } from '../lib/tmdbClient'
import styles from './WinnerReveal.module.css'

type Props = {
  movie: MovieEntry | null
  visible: boolean
  isHost: boolean
  onDismiss: () => void
  onReset: () => void
}

export function WinnerReveal({ movie, visible, isHost, onDismiss, onReset }: Props) {
  if (!visible || !movie) return null

  const tmdbUrl = getTmdbMovieUrl(movie.externalId)

  const poster = movie.posterUrl ? (
    <img src={movie.posterUrl} alt={movie.title} className={styles.poster} />
  ) : (
    <div className={styles.placeholder}>{movie.title}</div>
  )

  return (
    <div className={styles.overlay} onClick={onDismiss}>
      <button
        type="button"
        className={styles.closeButton}
        onClick={onDismiss}
        aria-label="Close and return to chat"
      >
        ×
      </button>

      <div className={styles.content}>
        <p className={styles.eyebrow}>Tonight&apos;s pick</p>
        <div
          className={styles.posterWrap}
          onClick={(event) => event.stopPropagation()}
        >
          {tmdbUrl ? (
            <a
              href={tmdbUrl}
              target="_blank"
              rel="noopener noreferrer"
              className={styles.posterLink}
              aria-label={`Open ${movie.title} on TMDB`}
            >
              {poster}
            </a>
          ) : (
            poster
          )}
        </div>
        <h2 className={styles.title}>{movie.title}</h2>
        <p className={styles.subtitle}>Added by {movie.addedBy}</p>
        {tmdbUrl && (
          <p className={styles.tmdbHint}>Click poster for TMDB</p>
        )}
        {isHost && (
          <button
            type="button"
            className={styles.resetButton}
            onClick={(event) => {
              event.stopPropagation()
              onReset()
            }}
          >
            Pick again
          </button>
        )}
      </div>
    </div>
  )
}
