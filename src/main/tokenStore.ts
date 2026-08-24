import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app, safeStorage } from 'electron'

const TOKEN_FILE = 'access-token.bin'

function tokenPath(): string {
  const dir = app.getPath('userData')
  mkdirSync(dir, { recursive: true })
  return join(dir, TOKEN_FILE)
}

export function saveAccessToken(token: string): void {
  const path = tokenPath()
  if (safeStorage.isEncryptionAvailable()) {
    writeFileSync(path, safeStorage.encryptString(token))
    return
  }
  writeFileSync(path, token, 'utf8')
}

export function loadAccessToken(): string | null {
  const path = tokenPath()
  if (!existsSync(path)) return null
  const buf = readFileSync(path)
  if (buf.length === 0) return null
  try {
    if (safeStorage.isEncryptionAvailable()) {
      return safeStorage.decryptString(buf)
    }
    return buf.toString('utf8')
  } catch {
    return buf.toString('utf8')
  }
}

export function clearAccessToken(): void {
  const path = tokenPath()
  if (existsSync(path)) {
    writeFileSync(path, Buffer.alloc(0))
  }
}
