import { useEffect, useRef } from 'react'
import type { ChatMessage } from '../types/room'
import { colorForPeer } from '../lib/userColors'
import styles from './ChatPanel.module.css'

type Props = {
  messages: ChatMessage[]
  onSend: (text: string) => void
  disabled?: boolean
}

export function ChatPanel({ messages, onSend, disabled }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault()
    const input = inputRef.current
    if (!input || disabled) return
    const value = input.value.trim()
    if (!value) return
    onSend(value)
    input.value = ''
  }

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <h2>Chat</h2>
      </div>
      <div className={styles.messages}>
        {messages.length === 0 ? (
          <p className={styles.empty}>Say hi and pick your movie above.</p>
        ) : (
          messages.map((message) => (
            <div key={message.id} className={styles.message}>
              <span
                className={styles.author}
                style={{ color: colorForPeer(message.peerId ?? message.nickname) }}
              >
                {message.nickname}
              </span>
              <span className={styles.text}>{message.text}</span>
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>
      <form className={styles.form} onSubmit={handleSubmit}>
        <input
          ref={inputRef}
          type="text"
          placeholder="Message..."
          disabled={disabled}
          maxLength={500}
        />
        <button type="submit" disabled={disabled}>
          Send
        </button>
      </form>
    </div>
  )
}
