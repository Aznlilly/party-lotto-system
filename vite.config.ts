import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

function normalizeBasePath(raw: string | undefined): string {
  if (!raw?.trim()) return '/'
  const trimmed = raw.trim()
  if (trimmed === '/') return '/'
  return trimmed.endsWith('/') ? trimmed : `${trimmed}/`
}

export default defineConfig({
  plugins: [react()],
  base: normalizeBasePath(process.env.VITE_BASE_PATH),
})
