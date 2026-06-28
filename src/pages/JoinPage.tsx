import { useCallback, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { randomMarioNickname } from '../lib/nicknames'
import {
  decodeRoomCodeParam,
  encodeRoomCodeForUrl,
  generateRoomCode,
  normalizeRoomCode,
} from '../lib/roomCode'
import styles from './JoinPage.module.css'

export function JoinPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [nickname, setNickname] = useState(() => randomMarioNickname())
  const [roomCode, setRoomCode] = useState(() => {
    const param = searchParams.get('code')
    return param ? decodeRoomCodeParam(param) : ''
  })
  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault()
    const name = nickname.trim() || randomMarioNickname()
    const code = normalizeRoomCode(roomCode) || generateRoomCode()

    sessionStorage.setItem('party-lotto-nickname', name)
    navigate(`/room/${encodeRoomCodeForUrl(code)}`)
  }

  const generateCode = useCallback(() => {
    setRoomCode(generateRoomCode())
  }, [])

  const suggestNickname = useCallback(() => {
    setNickname(randomMarioNickname())
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
          <div className={styles.codeRow}>
            <input
              id="nickname"
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              placeholder="Mario"
              maxLength={24}
              autoFocus={Boolean(searchParams.get('code'))}
            />
            <button type="button" onClick={suggestNickname}>
              Random
            </button>
          </div>

          <label htmlFor="room-code">Room name</label>
          <div className={styles.codeRow}>
            <input
              id="room-code"
              value={roomCode}
              onChange={(e) => setRoomCode(e.target.value)}
              placeholder="Friday Movie Night"
              maxLength={120}
            />
            <button type="button" onClick={generateCode}>
              Generate
            </button>
          </div>

          <button type="submit" className={styles.joinButton}>
            Join room
          </button>
        </form>
      </div>
    </div>
  )
}
