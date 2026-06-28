import { useCallback, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  decodeRoomCodeParam,
  encodeRoomCodeForUrl,
  isValidRoomCode,
  normalizeRoomCode,
} from '../lib/roomCode'
import styles from './JoinPage.module.css'

function randomNickname(): string {
  const names = ['Luigi', 'Peach', 'Toad', 'Yoshi', 'Rosalina', 'Koopa', 'Waluigi', 'Mario']
  return names[Math.floor(Math.random() * names.length)]
}

export function JoinPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [nickname, setNickname] = useState(() => {
    const invited = searchParams.get('code')
    return invited ? '' : randomNickname()
  })
  const [roomCode, setRoomCode] = useState(() => {
    const param = searchParams.get('code')
    return param ? decodeRoomCodeParam(param) : ''
  })
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault()
    const code = normalizeRoomCode(roomCode)
    const name = nickname.trim()

    if (!isValidRoomCode(code)) {
      setError('Enter a room name between 1 and 120 characters.')
      return
    }
    if (!name) {
      setError('Enter a nickname.')
      return
    }

    sessionStorage.setItem('party-lotto-nickname', name)
    navigate(`/room/${encodeRoomCodeForUrl(code)}`)
  }

  const generateCode = useCallback(() => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
    let code = ''
    for (let i = 0; i < 6; i += 1) {
      code += chars[Math.floor(Math.random() * chars.length)]
    }
    setRoomCode(code)
  }, [])

  const subtitle = useMemo(
    () => 'Search for movies or paste a poster URL, chat with friends, and let the lotto pick.',
    [],
  )

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <p className={styles.kicker}>Party Movie Lotto</p>
        <h1>Pick a movie Mario Kart style</h1>
        <p className={styles.subtitle}>{subtitle}</p>

        <form className={styles.form} onSubmit={handleSubmit}>
          <label htmlFor="nickname">Nickname</label>
          <input
            id="nickname"
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
            placeholder="Your name"
            maxLength={24}
            autoFocus={Boolean(searchParams.get('code'))}
          />

          <label htmlFor="room-code">Room name</label>
          <div className={styles.codeRow}>
            <input
              id="room-code"
              value={roomCode}
              onChange={(e) => setRoomCode(e.target.value)}
              placeholder="fun room of doom and silliness"
              maxLength={120}
            />
            <button type="button" onClick={generateCode}>
              Generate
            </button>
          </div>

          {error && <p className={styles.error}>{error}</p>}

          <button type="submit" className={styles.joinButton}>
            Join room
          </button>
        </form>
      </div>
    </div>
  )
}
