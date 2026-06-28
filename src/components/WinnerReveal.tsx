import type { MovieEntry } from '../types/room'
import styles from './WinnerReveal.module.css'

type Props = {
  movie: MovieEntry | null
  visible: boolean
  isHost: boolean
  onReset: () => void
}

export function WinnerReveal({ movie, visible, isHost, onReset }: Props) {
  if (!visible || !movie) return null

  return (
    <div className={styles.overlay}>
      <div className={styles.content}>
        <p className={styles.eyebrow}>Tonight&apos;s pick</p>
        <div className={styles.posterWrap}>
          {movie.posterUrl ? (
            <img src={movie.posterUrl} alt={movie.title} className={styles.poster} />
          ) : (
            <div className={styles.placeholder}>{movie.title}</div>
          )}
        </div>
        <h2 className={styles.title}>{movie.title}</h2>
        <p className={styles.subtitle}>Added by {movie.addedBy}</p>
        {isHost && (
          <button type="button" className={styles.resetButton} onClick={onReset}>
            Pick again
          </button>
        )}
      </div>
    </div>
  )
}
