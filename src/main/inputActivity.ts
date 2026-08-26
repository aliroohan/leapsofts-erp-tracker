import { systemPreferences } from 'electron'
import { uIOhook } from 'uiohook-napi'
import { trackerState } from './trackerState'

const TICK_MS = 1000

export interface InputTick {
  keyUsed: boolean
  mouseUsed: boolean
}

type TickListener = (tick: InputTick) => void

let hookStarted = false
let handlersBound = false
let tickTimer: ReturnType<typeof setInterval> | null = null

let keyEventsThisSecond = 0
let mouseEventsThisSecond = 0
/** Seconds in which keyboard or mouse fired, counted in emitTick regardless of listeners. */
let cumulativeActiveSec = 0

const listeners = new Set<TickListener>()

function emitTick(): void {
  const tick: InputTick = {
    keyUsed: keyEventsThisSecond > 0,
    mouseUsed: mouseEventsThisSecond > 0
  }
  keyEventsThisSecond = 0
  mouseEventsThisSecond = 0
  if (tick.keyUsed || tick.mouseUsed) cumulativeActiveSec += 1
  for (const listener of listeners) {
    listener(tick)
  }
}

function bindHandlers(): void {
  if (handlersBound) return
  uIOhook.on('keydown', () => {
    keyEventsThisSecond += 1
  })
  uIOhook.on('mousemove', () => {
    mouseEventsThisSecond += 1
  })
  uIOhook.on('mousedown', () => {
    mouseEventsThisSecond += 1
  })
  uIOhook.on('wheel', () => {
    mouseEventsThisSecond += 1
  })
  handlersBound = true
}

function promptAccessibilityIfNeeded(): boolean {
  if (process.platform !== 'darwin') return true
  try {
    return systemPreferences.isTrustedAccessibilityClient(true)
  } catch {
    return false
  }
}

/** Idempotent — uIOhook.start() must never run twice in one process. */
export function ensureStarted(): boolean {
  if (!tickTimer) {
    tickTimer = setInterval(emitTick, TICK_MS)
  }
  if (hookStarted) return true

  if (!promptAccessibilityIfNeeded()) {
    trackerState.setMonitoringError(
      'Input monitoring unavailable — grant Accessibility/Input Monitoring permission in System Settings, then check in again.'
    )
    return false
  }

  try {
    bindHandlers()
    uIOhook.start()
    hookStarted = true
    trackerState.setMonitoringError(null)
    return true
  } catch {
    trackerState.setMonitoringError(
      'Input monitoring unavailable — grant Accessibility/Input Monitoring permission in System Settings, then check in again.'
    )
    return false
  }
}

export function getCumulativeActiveSec(): number {
  return cumulativeActiveSec
}

/** Input seen since the last 1s emitTick, not yet folded into cumulativeActiveSec. */
export function hasPendingInputThisSecond(): boolean {
  return keyEventsThisSecond > 0 || mouseEventsThisSecond > 0
}

export function onTick(fn: TickListener): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
    // Do not stop uIOhook or the tick timer here. Screenshots and app-usage share one
    // start(); stopping on last-unsubscribe then calling start() again can fail and
    // leave ticks firing with empty event counters (activeSec stuck at 0).
  }
}
