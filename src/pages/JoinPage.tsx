import { useCallback, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import styles from './JoinPage.module.css'

function randomNickname(): string {
  const names = ['Luigi', 'Peach', 'Toad', 'Yoshi', 'Rosalina', 'Koopa', 'Waluigi', 'Mario']
  return names[Math.floor(Math.random() * names.length)]
}

export function JoinPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [nickname, setNickname] = useState(() => randomNickname())
  const [roomCode, setRoomCode] = useState(() => searchParams.get('code')?.toUpperCase() ?? '')
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault()
    const code = roomCode.trim().toUpperCase()
    const name = nickname.trim()

    if (!code || code.length < 3) {
      setError('Enter a room code with at least 3 characters.')
      return
    }
    if (!name) {
      setError('Enter a nickname.')
      return
    }

    sessionStorage.setItem('party-lotto-nickname', name)
    navigate(`/room/${encodeURIComponent(code)}`)
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
            maxLength={24}
          />

          <label htmlFor="room-code">Room code</label>
          <div className={styles.codeRow}>
            <input
              id="room-code"
              value={roomCode}
              onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
              placeholder="ABC123"
              maxLength={12}
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
