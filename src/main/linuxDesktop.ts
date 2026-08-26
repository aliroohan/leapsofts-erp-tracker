import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import {
  enableExtension,
  installExtension
} from '@miniben90/x-win'

const execFileAsync = promisify(execFile)

export const XWIN_EXTENSION_UUID = 'x-win@miniben90.org'

let mutterIdleSupported: boolean | null = null
let cachedMutterIdleSec: number | null = null
let mutterInFlight = false
let windowTrackingPrepared = false

export function isWaylandSession(): boolean {
  if (process.platform !== 'linux') return false
  const type = (process.env.XDG_SESSION_TYPE ?? '').toLowerCase()
  return type === 'wayland' || Boolean(process.env.WAYLAND_DISPLAY)
}

export function isGnomeLikeDesktop(): boolean {
  if (process.platform !== 'linux') return false
  const desktop = `${process.env.XDG_CURRENT_DESKTOP ?? ''} ${process.env.XDG_SESSION_DESKTOP ?? ''}`.toLowerCase()
  return (
    desktop.includes('gnome') ||
    desktop.includes('ubuntu') ||
    desktop.includes('zorin') ||
    desktop.includes('unity') ||
    desktop.includes('cinnamon')
  )
}

function xwinExtensionMetadataPath(): string {
  return join(
    homedir(),
    '.local/share/gnome-shell/extensions',
    XWIN_EXTENSION_UUID,
    'metadata.json'
  )
}

export function isXWinExtensionOnDisk(): boolean {
  return existsSync(xwinExtensionMetadataPath())
}

export function windowTrackingUnavailableMessage(): string {
  if (process.platform === 'darwin') {
    return 'Window tracking unavailable — grant Screen Recording and Automation permission in System Settings and restart the app.'
  }
  if (process.platform === 'linux' && isWaylandSession()) {
    return [
      'Window tracking on GNOME Wayland needs the “x-win” GNOME extension.',
      'It has been installed. Log out and sign back in, then reopen this app.',
      'There is no Screen Recording or Automation toggle for this on Linux.'
    ].join(' ')
  }
  if (process.platform === 'linux') {
    return 'Window tracking unavailable on this Linux session. Restart the app, or log out and sign back in.'
  }
  return 'Window tracking unavailable. Restart the app and try again.'
}

export function screenCaptureUnavailableMessage(): string {
  if (process.platform === 'darwin') {
    return 'Screen Recording permission is required — grant it in System Settings and restart the app.'
  }
  if (process.platform === 'linux') {
    return 'Screen capture failed — allow screen sharing when the system prompt appears (Settings → Privacy → Screen Cast), then restart the app.'
  }
  return 'Screen capture failed. Restart the app and try again.'
}

export function inputMonitoringUnavailableMessage(): string {
  if (process.platform === 'darwin') {
    return 'Input monitoring unavailable — grant Accessibility/Input Monitoring permission in System Settings, then check in again.'
  }
  if (process.platform === 'linux') {
    return 'Input monitoring unavailable on this Linux session. Keyboard and mouse hooks need X11 libraries; restart the app after installing them.'
  }
  return 'Input monitoring unavailable. Restart the app and try again.'
}

function parseEnabledExtensions(raw: string): string[] {
  const trimmed = raw.trim()
  if (!trimmed || trimmed === '@as []' || trimmed === '[]') return []
  return [...trimmed.matchAll(/'([^']+)'/g)].map((match) => match[1])
}

function serializeEnabledExtensions(uuids: string[]): string {
  if (!uuids.length) return '@as []'
  return `[${uuids.map((uuid) => `'${uuid}'`).join(', ')}]`
}

async function enableXWinInGnomeSettings(): Promise<void> {
  try {
    const { stdout } = await execFileAsync(
      'gsettings',
      ['get', 'org.gnome.shell', 'enabled-extensions'],
      { timeout: 2000 }
    )
    const current = parseEnabledExtensions(stdout)
    if (current.includes(XWIN_EXTENSION_UUID)) return
    const next = serializeEnabledExtensions([...current, XWIN_EXTENSION_UUID])
    await execFileAsync(
      'gsettings',
      ['set', 'org.gnome.shell', 'enabled-extensions', next],
      { timeout: 2000 }
    )
  } catch {
    // gsettings is missing on non-GNOME desktops.
  }
}

/** Installs the x-win GNOME extension and marks it enabled for the next login. */
export async function prepareLinuxWindowTracking(): Promise<void> {
  if (process.platform !== 'linux' || windowTrackingPrepared) return
  windowTrackingPrepared = true
  if (!isWaylandSession() || !isGnomeLikeDesktop()) return

  try {
    if (!isXWinExtensionOnDisk()) {
      installExtension()
    }
  } catch {
    // installExtension throws if the native binding cannot write the files.
  }

  await enableXWinInGnomeSettings()

  try {
    enableExtension()
  } catch {
    // GNOME only loads a newly copied extension after a session restart.
  }
}

function parseMutterIdleMs(stdout: string): number | null {
  const match = stdout.match(/uint64\s+(\d+)/) ?? stdout.match(/(\d+)/)
  if (!match) return null
  const ms = Number(match[1])
  if (!Number.isFinite(ms) || ms < 0) return null
  return ms
}

async function queryMutterIdleSeconds(): Promise<number | null> {
  try {
    const { stdout } = await execFileAsync(
      'gdbus',
      [
        'call',
        '--session',
        '--dest',
        'org.gnome.Mutter.IdleMonitor',
        '--object-path',
        '/org/gnome/Mutter/IdleMonitor/Core',
        '--method',
        'org.gnome.Mutter.IdleMonitor.GetIdletime'
      ],
      { timeout: 1500 }
    )
    const ms = parseMutterIdleMs(stdout)
    if (ms == null) return null
    return Math.floor(ms / 1000)
  } catch {
    return null
  }
}

export function getCachedMutterIdleSeconds(): number | null {
  if (mutterIdleSupported === false) return null
  return cachedMutterIdleSec
}

export function refreshMutterIdleSeconds(): void {
  if (process.platform !== 'linux') return
  if (mutterIdleSupported === false || mutterInFlight) return
  mutterInFlight = true
  void queryMutterIdleSeconds()
    .then((seconds) => {
      if (seconds == null) {
        mutterIdleSupported = false
        return
      }
      mutterIdleSupported = true
      cachedMutterIdleSec = seconds
    })
    .finally(() => {
      mutterInFlight = false
    })
}

export async function probeMutterIdleSeconds(): Promise<number | null> {
  if (process.platform !== 'linux') return null
  const seconds = await queryMutterIdleSeconds()
  mutterIdleSupported = seconds != null
  cachedMutterIdleSec = seconds
  return seconds
}
