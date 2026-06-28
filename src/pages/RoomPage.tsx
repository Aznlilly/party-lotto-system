import { useMemo } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import { ChatPanel } from '../components/ChatPanel'
import { CountdownBadge } from '../components/CountdownBadge'
import { MovieInput } from '../components/MovieInput'
import { PerimeterCarousel } from '../components/PerimeterCarousel'
import { WinnerReveal } from '../components/WinnerReveal'
import { useRoom } from '../hooks/useRoom'
import styles from './RoomPage.module.css'

export function RoomPage() {
  const { code = '' } = useParams()
  const roomCode = decodeURIComponent(code).toUpperCase()
  const nickname =
    sessionStorage.getItem('party-lotto-nickname') ??
    `Guest-${Math.floor(Math.random() * 9999)}`

  const {
    roomState,
    myPeerId,
    isHost,
    peerCount,
    connected,
    crawlOffsetRef,
    sendChat,
    addMovie,
    startCountdown,
    resetRound,
  } = useRoom(roomCode, nickname)

  const myVote = useMemo(
    () => roomState.movies.find((movie) => movie.addedByPeerId === myPeerId) ?? null,
    [roomState.movies, myPeerId],
  )

  const hasVoted = myVote !== null

  const winner = useMemo(
    () => roomState.movies.find((movie) => movie.id === roomState.winnerId) ?? null,
    [roomState.movies, roomState.winnerId],
  )

  const inputsDisabled =
    roomState.phase !== 'collecting' && roomState.phase !== 'countdown'

  if (!roomCode) {
    return <Navigate to="/" replace />
  }

  return (
    <div className={styles.page}>
      <PerimeterCarousel
        movies={roomState.movies}
        phase={roomState.phase}
        frozenOffset={roomState.frozenOffset}
        crawlOffsetRef={crawlOffsetRef}
        winnerId={roomState.winnerId}
        rouletteSeed={roomState.rouletteSeed}
      />

      <CountdownBadge
        visible={roomState.phase === 'countdown'}
        countdownEndsAt={roomState.countdownEndsAt}
      />

      <WinnerReveal
        movie={winner}
        visible={roomState.phase === 'winner'}
        isHost={isHost}
        onReset={resetRound}
      />

      <header className={styles.header}>
        <div>
          <p className={styles.roomLabel}>Room {roomCode}</p>
          <p className={styles.meta}>
            {connected ? `${peerCount} connected` : 'Connecting...'}
            {isHost ? ' · You are host' : ''}
          </p>
        </div>
        <Link to="/" className={styles.leaveLink}>
          Leave
        </Link>
      </header>

      <main className={styles.main}>
        <div className={styles.centerPanel}>
          <MovieInput
            onAdd={addMovie}
            disabled={inputsDisabled}
            hasVoted={hasVoted}
            votedTitle={myVote?.title ?? null}
          />
          <div className={styles.chatWrap}>
            <ChatPanel
              messages={roomState.messages}
              onSend={sendChat}
              disabled={roomState.phase === 'winner'}
            />
          </div>
          {isHost && roomState.phase === 'collecting' && (
            <button
              type="button"
              className={styles.startButton}
              onClick={startCountdown}
              disabled={roomState.movies.length === 0}
            >
              Start selection ({roomState.movies.length} vote{roomState.movies.length === 1 ? '' : 's'})
            </button>
          )}
          {roomState.phase === 'frozen' && (
            <p className={styles.phaseNotice}>Posters frozen. Get ready...</p>
          )}
          {roomState.phase === 'roulette' && (
            <p className={styles.phaseNotice}>Selecting a movie...</p>
          )}
        </div>
      </main>
    </div>
  )
}
