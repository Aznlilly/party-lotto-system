export function normalizeRoomCode(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ')
}

export function normalizeRoomKey(raw: string): string {
  return normalizeRoomCode(raw).toLowerCase()
}

export function isValidRoomCode(raw: string): boolean {
  const normalized = normalizeRoomCode(raw)
  return normalized.length >= 1 && normalized.length <= 120
}

export function toTrysteroRoomId(displayCode: string): string {
  const key = normalizeRoomKey(displayCode)
  const bytes = new TextEncoder().encode(key)
  let binary = ''
  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function encodeRoomCodeForUrl(displayCode: string): string {
  return encodeURIComponent(normalizeRoomCode(displayCode))
}

export function decodeRoomCodeFromUrl(segment: string): string {
  try {
    return normalizeRoomCode(decodeURIComponent(segment))
  } catch {
    return normalizeRoomCode(segment)
  }
}

export function decodeRoomCodeParam(param: string): string {
  try {
    return normalizeRoomCode(decodeURIComponent(param))
  } catch {
    return normalizeRoomCode(param)
  }
}

const GENERATED_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const GENERATED_CODE_LENGTH = 10

export function generateRoomCode(length = GENERATED_CODE_LENGTH): string {
  let code = ''
  for (let i = 0; i < length; i += 1) {
    code += GENERATED_CODE_CHARS[Math.floor(Math.random() * GENERATED_CODE_CHARS.length)]
  }
  return code
}
