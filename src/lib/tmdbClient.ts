const TMDB_API_BASE = 'https://api.themoviedb.org/3'
const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p/w342'

export type MovieMetadata = {
  externalId: string
  title: string
  posterUrl: string | null
  year?: string
}

type TmdbSearchResponse = {
  results?: Array<{
    id: number
    title: string
    release_date?: string
    poster_path?: string | null
  }>
  status_code?: number
  status_message?: string
  success?: boolean
}

function getCredential(): string {
  const credential = import.meta.env.VITE_TMDB_API_KEY?.trim()
  if (!credential) {
    throw new Error(
      'TMDB API key is not configured. Add VITE_TMDB_API_KEY to your .env file.',
    )
  }
  return credential
}

function isJwtToken(credential: string): boolean {
  return credential.startsWith('eyJ')
}

function posterUrlFromPath(posterPath: string | null | undefined): string | null {
  if (!posterPath) return null
  return `${TMDB_IMAGE_BASE}${posterPath}`
}

function yearFromReleaseDate(releaseDate?: string): string | undefined {
  if (!releaseDate) return undefined
  return releaseDate.slice(0, 4)
}

function buildSearchRequest(query: string): { url: string; headers: HeadersInit } {
  const credential = getCredential()

  if (isJwtToken(credential)) {
    const url = new URL(`${TMDB_API_BASE}/search/movie`)
    url.searchParams.set('query', query)
    url.searchParams.set('include_adult', 'false')
    url.searchParams.set('language', 'en-US')

    return {
      url: url.toString(),
      headers: {
        Authorization: `Bearer ${credential}`,
        Accept: 'application/json',
      },
    }
  }

  const url = new URL(`${TMDB_API_BASE}/search/movie`)
  url.searchParams.set('query', query)
  url.searchParams.set('include_adult', 'false')
  url.searchParams.set('language', 'en-US')
  url.searchParams.set('api_key', credential)

  return {
    url: url.toString(),
    headers: { Accept: 'application/json' },
  }
}

async function readTmdbError(response: Response): Promise<string> {
  try {
    const data = (await response.json()) as TmdbSearchResponse
    if (data.status_message) {
      if (response.status === 401) {
        return `${data.status_message} Use the TMDB "API Key (v3 auth)" from themoviedb.org/settings/api — not the application name or OAuth client id.`
      }
      return data.status_message
    }
  } catch {
    // fall through
  }

  if (response.status === 401) {
    return 'Invalid TMDB API key. Use the "API Key (v3 auth)" from themoviedb.org/settings/api.'
  }

  return 'Failed to search TMDB. Try again in a moment.'
}

function networkSearchError(cause: unknown): Error {
  const message =
    cause instanceof Error ? cause.message : 'Network request failed.'
  if (/failed to fetch|networkerror|load failed/i.test(message)) {
    return new Error(
      'Could not reach TMDB (network blocked or offline). Use "Title + poster URL" instead, or try again.',
    )
  }
  return cause instanceof Error ? cause : new Error(message)
}

export async function searchMovies(query: string): Promise<MovieMetadata[]> {
  const trimmed = query.trim()
  if (trimmed.length < 2) return []

  const { url, headers } = buildSearchRequest(trimmed)
  let response: Response
  try {
    response = await fetch(url, { headers })
  } catch (error) {
    throw networkSearchError(error)
  }

  if (!response.ok) {
    throw new Error(await readTmdbError(response))
  }

  const data = (await response.json()) as TmdbSearchResponse
  if (data.success === false) {
    throw new Error(data.status_message ?? 'TMDB search failed.')
  }

  const results = data.results ?? []

  return results.slice(0, 8).map((movie) => {
    const year = yearFromReleaseDate(movie.release_date)
    return {
      externalId: `tmdb:${movie.id}`,
      title: year ? `${movie.title} (${year})` : movie.title,
      posterUrl: posterUrlFromPath(movie.poster_path),
      year,
    }
  })
}

export function createManualMovie(title: string, posterUrl: string): MovieMetadata {
  const trimmedTitle = title.trim()
  const trimmedPosterUrl = posterUrl.trim()

  if (!trimmedTitle) {
    throw new Error('Enter a movie title.')
  }

  if (!trimmedPosterUrl) {
    throw new Error('Enter a poster image URL.')
  }

  let parsedUrl: URL
  try {
    parsedUrl = new URL(trimmedPosterUrl)
  } catch {
    throw new Error('Poster URL must be a valid http or https link.')
  }

  if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
    throw new Error('Poster URL must be a valid http or https link.')
  }

  return {
    externalId: `manual:${trimmedTitle.toLowerCase()}:${parsedUrl.toString()}`,
    title: trimmedTitle,
    posterUrl: parsedUrl.toString(),
  }
}
