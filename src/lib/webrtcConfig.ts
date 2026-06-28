type IceServer = RTCIceServer

const STUN_SERVERS: IceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun.cloudflare.com:3478' },
  { urls: 'stun:freeturn.net:3478' },
  { urls: 'stun:freeturn.net:5349' },
]

const FREETURN_SERVERS: IceServer[] = [
  {
    urls: [
      'turns:freeturn.net:5349?transport=tcp',
      'turns:freeturn.tel:5349?transport=tcp',
      'turn:freeturn.net:3478?transport=tcp',
      'turn:freeturn.net:3478?transport=udp',
    ],
    username: 'free',
    credential: 'free',
  },
]

function customTurnFromEnv(): IceServer | null {
  const urls = import.meta.env.VITE_TURN_URLS?.split(',')
    .map((url: string) => url.trim())
    .filter(Boolean)
  const username = import.meta.env.VITE_TURN_USERNAME?.trim()
  const credential = import.meta.env.VITE_TURN_CREDENTIAL?.trim()

  if (!urls?.length || !username || !credential) {
    return null
  }

  return { urls, username, credential }
}

async function fetchMeteredIceServers(): Promise<IceServer[] | null> {
  const apiKey = import.meta.env.VITE_METERED_TURN_API_KEY?.trim()
  const domain = import.meta.env.VITE_METERED_TURN_DOMAIN?.trim()
  if (!apiKey || !domain) return null

  try {
    const response = await fetch(
      `https://${domain}/api/v1/turn/credentials?apiKey=${encodeURIComponent(apiKey)}`,
    )
    if (!response.ok) return null

    const data = (await response.json()) as IceServer[] | { iceServers?: IceServer[] }
    if (Array.isArray(data)) return data
    if (Array.isArray(data.iceServers)) return data.iceServers
  } catch {
    return null
  }

  return null
}

export async function resolveIceServers(): Promise<IceServer[]> {
  const customTurn = customTurnFromEnv()
  if (customTurn) {
    return [...STUN_SERVERS, customTurn]
  }

  const metered = await fetchMeteredIceServers()
  if (metered?.length) {
    return [...STUN_SERVERS, ...metered]
  }

  return [...STUN_SERVERS, ...FREETURN_SERVERS]
}

export async function getTrysteroConnectionConfig() {
  return {
    relayConfig: { redundancy: 10 },
    rtcConfig: {
      iceServers: await resolveIceServers(),
    },
  }
}

export function formatPeerConnectionError(error: string): string {
  if (/turn server|turnconfig|iceservers/i.test(error)) {
    return (
      'Could not connect through the network (TURN relay failed). ' +
      'Try refreshing, use the exact invite link, or ask the host to share from the same Wi‑Fi if possible. ' +
      'For strict networks, set up Metered Open Relay (free) via VITE_METERED_TURN_* in .env.'
    )
  }

  return `Peer connection failed (${error}). Try refreshing, or use the exact invite link from the host.`
}
