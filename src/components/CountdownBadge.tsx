import { useEffect, useState } from 'react'
import styles from './CountdownBadge.module.css'

type Props = {
  countdownEndsAt?: number
  visible: boolean
}

export function CountdownBadge({ countdownEndsAt, visible }: Props) {
  const [remaining, setRemaining] = useState(0)

  useEffect(() => {
    if (!visible || !countdownEndsAt) return

    const tick = () => {
      setRemaining(Math.max(0, Math.ceil((countdownEndsAt - Date.now()) / 1000)))
    }

    tick()
    const interval = window.setInterval(tick, 200)
    return () => window.clearInterval(interval)
  }, [visible, countdownEndsAt])

  if (!visible || !countdownEndsAt) return null

  return (
    <div className={styles.badge} role="timer" aria-live="polite">
      <span className={styles.label}>Starting soon</span>
      <span className={styles.value}>{remaining}</span>
    </div>
  )
}
