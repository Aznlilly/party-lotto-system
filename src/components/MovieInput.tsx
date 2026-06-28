import { useEffect, useState } from 'react'
import {
  createManualMovie,
  searchMovies,
  type MovieMetadata,
} from '../lib/tmdbClient'
import styles from './MovieInput.module.css'

type InputMode = 'search' | 'custom'

type Props = {
  onAdd: (payload: {
    externalId: string
    title: string
    posterUrl: string | null
  }) => Promise<string | null>
  disabled?: boolean
  hasVoted?: boolean
  votedTitle?: string | null
}

export function MovieInput({ onAdd, disabled, hasVoted, votedTitle }: Props) {
  const [mode, setMode] = useState<InputMode>('search')
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<MovieMetadata[]>([])
  const [searching, setSearching] = useState(false)
  const [addingId, setAddingId] = useState<string | null>(null)
  const [customTitle, setCustomTitle] = useState('')
  const [customPosterUrl, setCustomPosterUrl] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    if (mode !== 'search' || hasVoted) return

    const trimmed = query.trim()
    if (trimmed.length < 2) {
      setResults([])
      setSearching(false)
      return
    }

    setSearching(true)
    setError(null)

    const timer = window.setTimeout(async () => {
      try {
        const movies = await searchMovies(trimmed)
        setResults(movies)
        if (movies.length === 0) {
          setNotice('No matches found. Try a different title or use custom poster.')
        } else {
          setNotice(null)
        }
      } catch (err) {
        setResults([])
        setError(err instanceof Error ? err.message : 'Search failed.')
      } finally {
        setSearching(false)
      }
    }, 350)

    return () => window.clearTimeout(timer)
  }, [mode, query, hasVoted])

  const handleAddMovie = async (movie: MovieMetadata) => {
    if (disabled || addingId || hasVoted) return

    setError(null)
    setNotice(null)
    setAddingId(movie.externalId)

    try {
      const voteError = await onAdd(movie)
      if (voteError) {
        setNotice(voteError)
      } else {
        setQuery('')
        setResults([])
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add movie.')
    } finally {
      setAddingId(null)
    }
  }

  const handleCustomSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (disabled || loading || hasVoted) return

    setError(null)
    setNotice(null)
    setLoading(true)

    try {
      const movie = createManualMovie(customTitle, customPosterUrl)
      const voteError = await onAdd(movie)
      if (voteError) {
        setNotice(voteError)
      } else {
        setCustomTitle('')
        setCustomPosterUrl('')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add movie.')
    } finally {
      setLoading(false)
    }
  }

  if (hasVoted && votedTitle) {
    return (
      <div className={styles.wrapper}>
        <div className={styles.votedCard}>
          <p className={styles.votedLabel}>Your pick</p>
          <p className={styles.votedTitle}>{votedTitle}</p>
        </div>
      </div>
    )
  }

  return (
    <div className={styles.wrapper}>
      <div className={styles.modeToggle}>
        <button
          type="button"
          className={mode === 'search' ? styles.modeActive : styles.modeButton}
          onClick={() => setMode('search')}
          disabled={disabled}
        >
          Search TMDB
        </button>
        <button
          type="button"
          className={mode === 'custom' ? styles.modeActive : styles.modeButton}
          onClick={() => setMode('custom')}
          disabled={disabled}
        >
          Title + poster URL
        </button>
      </div>

      {mode === 'search' ? (
        <div className={styles.form}>
          <label htmlFor="movie-search">Search for a movie</label>
          <input
            id="movie-search"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Fight Club, Dune, The Matrix..."
            disabled={disabled}
          />
          {searching && <p className={styles.hint}>Searching...</p>}
          {results.length > 0 && (
            <ul className={styles.results}>
              {results.map((movie) => (
                <li key={`${movie.externalId}-${movie.title}`}>
                  <button
                    type="button"
                    className={styles.resultButton}
                    onClick={() => handleAddMovie(movie)}
                    disabled={disabled || addingId === movie.externalId}
                  >
                    {movie.posterUrl ? (
                      <img src={movie.posterUrl} alt="" className={styles.resultPoster} />
                    ) : (
                      <div className={styles.resultPosterFallback}>?</div>
                    )}
                    <span className={styles.resultTitle}>{movie.title}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <form className={styles.form} onSubmit={handleCustomSubmit}>
          <label htmlFor="custom-title">Movie title</label>
          <input
            id="custom-title"
            type="text"
            value={customTitle}
            onChange={(e) => setCustomTitle(e.target.value)}
            placeholder="My favorite obscure film"
            disabled={disabled || loading}
            maxLength={120}
          />

          <label htmlFor="custom-poster">Poster image URL</label>
          <div className={styles.row}>
            <input
              id="custom-poster"
              type="url"
              value={customPosterUrl}
              onChange={(e) => setCustomPosterUrl(e.target.value)}
              placeholder="https://example.com/poster.jpg"
              disabled={disabled || loading}
            />
            <button
              type="submit"
              disabled={disabled || loading || !customTitle.trim() || !customPosterUrl.trim()}
            >
              {loading ? 'Adding...' : 'Add'}
            </button>
          </div>
        </form>
      )}

      {error && <p className={styles.error}>{error}</p>}
      {notice && !error && <p className={styles.notice}>{notice}</p>}
      <p className={styles.attribution}>
        Movie search powered by TMDB. Poster URLs can also be added manually.
      </p>
    </div>
  )
}
