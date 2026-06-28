import type { PeerInfo } from '../types/room'
import { colorForPeer } from '../lib/userColors'
import styles from './PeerList.module.css'

type Props = {
  peers: PeerInfo[]
  myPeerId: string
  hostPeerId: string
}

export function PeerList({ peers, myPeerId, hostPeerId }: Props) {
  return (
    <aside className={styles.panel} aria-label="People in room">
      <div className={styles.header}>
        <h2>In room</h2>
        <span className={styles.count}>{peers.length}</span>
      </div>
      <ul className={styles.list}>
        {peers.map((peer) => {
          const isSelf = peer.peerId === myPeerId
          const isHost = peer.peerId === hostPeerId
          const color = colorForPeer(peer.peerId)

          return (
            <li key={peer.peerId} className={styles.item}>
              <span
                className={styles.dot}
                style={{ backgroundColor: color, color }}
                aria-hidden
              />
              <span className={styles.name} style={{ color }}>
                {peer.nickname}
                {isSelf ? ' (you)' : ''}
              </span>
              {isHost && <span className={styles.hostBadge}>host</span>}
            </li>
          )
        })}
      </ul>
    </aside>
  )
}
