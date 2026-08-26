import { activeWindowAsync } from '@miniben90/x-win'
import type { UsagePlatform } from '@shared/types'

export interface ActiveWindowSnapshot {
  app: string
  execName: string
  title: string
  rawUrl: string | null
}

export function currentPlatform(): UsagePlatform {
  if (process.platform === 'darwin') return 'macos'
  if (process.platform === 'win32') return 'windows'
  return 'linux'
}

export async function getActiveWindow(): Promise<ActiveWindowSnapshot | null> {
  const win = await activeWindowAsync()
  if (!win) return null

  const info = win.info
  const app = (info?.name ?? '').trim()
  const execName = (info?.execName ?? '').trim()
  if (!app && !execName) return null

  const rawUrl = (win.url ?? '').trim()
  return {
    app: app || execName,
    execName,
    title: (win.title ?? '').trim(),
    rawUrl: rawUrl || null
  }
}
