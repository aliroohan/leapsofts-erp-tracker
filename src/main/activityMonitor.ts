import { randomInt } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { desktopCapturer } from 'electron'
import { uIOhook } from 'uiohook-napi'
import { isNetworkError, uploadActivitySample } from './api'
import {
  enqueueActivitySample,
  imageDir,
  listPendingActivitySamples,
  removeActivitySample
} from './pendingActivitySamples'
import { isCheckedIn, openBreakSource, trackerState } from './trackerState'

const WINDOW_MS = 10 * 60 * 1000
const TICK_MS = 1000
const SCREENSHOT_WIDTH = 1280
const SCREENSHOT_HEIGHT = 800
const JPEG_QUALITY = 45

let hookStarted = false
let hookFailed = false

let windowTimer: ReturnType<typeof setTimeout> | null = null
let tickTimer: ReturnType<typeof setInterval> | null = null
let captureTimer: ReturnType<typeof setTimeout> | null = null
let flushTimer: ReturnType<typeof setInterval> | null = null

let running = false

let keyEventsThisSecond = 0
let mouseEventsThisSecond = 0

interface ActiveWindow {
  windowStart: number
  secondsElapsed: number
  keyboardSeconds: number
  mouseSeconds: number
  combinedSeconds: number
  screenshotTaken: boolean
}

let activeWindow: ActiveWindow | null = null

function shouldMonitor(): boolean {
  const { shift, isAuthenticated } = trackerState.get()
  if (!isAuthenticated || !isCheckedIn(shift)) return false
  return !openBreakSource(shift)
}

function ensureHookStarted(): boolean {
  if (hookStarted) return true
  if (hookFailed) return false
  try {
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
    uIOhook.start()
    hookStarted = true
    return true
  } catch {
    hookFailed = true
    trackerState.setMonitoringError(
      'Input monitoring unavailable — grant Accessibility/Input Monitoring permission in System Settings and restart the app.'
    )
    return false
  }
}

function stopHook(): void {
  if (!hookStarted) return
  try {
    uIOhook.stop()
  } catch {
    // ignore
  }
  hookStarted = false
}

async function captureScreenshotJpeg(): Promise<Buffer | null> {
  try {
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: SCREENSHOT_WIDTH, height: SCREENSHOT_HEIGHT }
    })
    if (!sources.length) {
      trackerState.setMonitoringError(
        'Screen Recording permission is required — grant it in System Settings and restart the app.'
      )
      return null
    }
    const primary = sources[0]
    const thumb = primary.thumbnail
    if (thumb.isEmpty()) {
      trackerState.setMonitoringError(
        'Screen Recording permission is required — grant it in System Settings and restart the app.'
      )
      return null
    }
    const resized = thumb.resize({ width: SCREENSHOT_WIDTH })
    return resized.toJPEG(JPEG_QUALITY)
  } catch {
    trackerState.setMonitoringError(
      'Screen capture failed — grant Screen Recording permission in System Settings and restart the app.'
    )
    return null
  }
}

function clearWindowTimers(): void {
  if (tickTimer) {
    clearInterval(tickTimer)
    tickTimer = null
  }
  if (captureTimer) {
    clearTimeout(captureTimer)
    captureTimer = null
  }
}

async function takeScreenshotForWindow(win: ActiveWindow): Promise<void> {
  const jpeg = await captureScreenshotJpeg()
  if (!jpeg) return
  win.screenshotTaken = true

  const dir = imageDir()
  const fileName = `${win.windowStart}-${randomInt(1_000_000)}.jpg`
  const filePath = join(dir, fileName)
  try {
    writeFileSync(filePath, jpeg)
  } catch {
    return
  }

  // Stash the path on the window so finishWindow can enqueue once totals are final.
  ;(win as ActiveWindow & { imagePath?: string }).imagePath = filePath
}

function onSecondTick(): void {
  const win = activeWindow
  if (!win) return

  const keyUsed = keyEventsThisSecond > 0
  const mouseUsed = mouseEventsThisSecond > 0
  keyEventsThisSecond = 0
  mouseEventsThisSecond = 0

  win.secondsElapsed += 1
  if (keyUsed) win.keyboardSeconds += 1
  if (mouseUsed) win.mouseSeconds += 1
  if (keyUsed || mouseUsed) win.combinedSeconds += 1

  if (!shouldMonitor()) {
    closeCurrentWindowEarly()
  }
}

function enqueueFinishedWindow(win: ActiveWindow & { imagePath?: string }): void {
  if (!win.imagePath || win.secondsElapsed <= 0) return
  const total = win.secondsElapsed
  const keyboardPct = Math.round((win.keyboardSeconds / total) * 100)
  const mousePct = Math.round((win.mouseSeconds / total) * 100)
  const combinedPct = Math.round((win.combinedSeconds / total) * 100)
  const capturedAt = new Date().toISOString()

  enqueueActivitySample({
    windowStart: new Date(win.windowStart).toISOString(),
    capturedAt,
    keyboardPct,
    mousePct,
    combinedPct,
    imagePath: win.imagePath
  })
  trackerState.setLastSampleAt(capturedAt)
  void flushPendingActivity()
}

function closeCurrentWindowEarly(): void {
  const win = activeWindow
  clearWindowTimers()
  activeWindow = null
  if (win) {
    enqueueFinishedWindow(win as ActiveWindow & { imagePath?: string })
  }
  scheduleNextWindow()
}

function startWindow(): void {
  if (!shouldMonitor()) {
    scheduleNextWindow()
    return
  }

  const windowStart = Date.now()
  const win: ActiveWindow & { imagePath?: string } = {
    windowStart,
    secondsElapsed: 0,
    keyboardSeconds: 0,
    mouseSeconds: 0,
    combinedSeconds: 0,
    screenshotTaken: false
  }
  activeWindow = win

  const offsetSec = randomInt(600)
  tickTimer = setInterval(onSecondTick, TICK_MS)
  captureTimer = setTimeout(() => {
    if (activeWindow === win) {
      void takeScreenshotForWindow(win)
    }
  }, offsetSec * 1000)

  windowTimer = setTimeout(() => {
    if (activeWindow !== win) return
    clearWindowTimers()
    activeWindow = null
    enqueueFinishedWindow(win)
    scheduleNextWindow()
  }, WINDOW_MS)
}

function scheduleNextWindow(): void {
  if (!running) return
  if (windowTimer) {
    clearTimeout(windowTimer)
    windowTimer = null
  }
  const now = Date.now()
  const msIntoWindow = now % WINDOW_MS
  const msUntilBoundary = WINDOW_MS - msIntoWindow
  windowTimer = setTimeout(() => {
    if (!running) return
    startWindow()
  }, msUntilBoundary)
}

export async function flushPendingActivity(): Promise<void> {
  const pending = listPendingActivitySamples()
  if (!pending.length) return

  for (const item of pending) {
    let imageBuffer: Buffer
    try {
      imageBuffer = readFileSync(item.imagePath)
    } catch {
      removeActivitySample(item.id)
      continue
    }
    try {
      await uploadActivitySample({
        windowStart: item.windowStart,
        capturedAt: item.capturedAt,
        keyboardPct: item.keyboardPct,
        mousePct: item.mousePct,
        combinedPct: item.combinedPct,
        imageBuffer
      })
      removeActivitySample(item.id)
      trackerState.setError(null)
    } catch (err) {
      if (isNetworkError(err)) {
        trackerState.setOnline(false)
        return
      }
      const message = err instanceof Error ? err.message : ''
      const lower = message.toLowerCase()
      if (lower.includes('duplicate') || lower.includes('already')) {
        removeActivitySample(item.id)
        continue
      }
      // Drop unrecoverable/validation errors so the queue doesn't jam forever.
      removeActivitySample(item.id)
    }
  }
}

export function startActivityMonitor(): void {
  if (running) return
  running = true
  trackerState.setMonitoringError(null)

  const hookOk = ensureHookStarted()
  trackerState.setMonitoringActive(hookOk)

  scheduleNextWindow()

  if (!flushTimer) {
    flushTimer = setInterval(() => {
      void flushPendingActivity()
    }, 60_000)
  }

  void flushPendingActivity()
}

export function stopActivityMonitor(): void {
  running = false
  if (windowTimer) {
    clearTimeout(windowTimer)
    windowTimer = null
  }
  clearWindowTimers()
  if (activeWindow) {
    enqueueFinishedWindow(activeWindow as ActiveWindow & { imagePath?: string })
    activeWindow = null
  }
  stopHook()
  trackerState.setMonitoringActive(false)
}
