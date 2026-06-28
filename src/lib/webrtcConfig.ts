type TurnServerConfig = {
  urls: string | string[]
  username: string
  credential: string
}

const FREETURN_SERVERS: TurnServerConfig = {
  urls: [
    'turn:freeturn.net:3478?transport=udp',
    'turn:freeturn.net:3478?transport=tcp',
    'turns:freeturn.net:5349?transport=tcp',
  ],
  username: 'free',
  credential: 'free',
}

function customTurnFromEnv(): TurnServerConfig | null {
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

export function getTrysteroConnectionConfig() {
  return {
    relayConfig: { redundancy: 10 },
    turnConfig: [customTurnFromEnv() ?? FREETURN_SERVERS],
  }
}
