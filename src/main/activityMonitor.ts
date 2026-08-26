import { randomInt } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { desktopCapturer } from 'electron'
import { isNetworkError, uploadActivitySample } from './api'
import { flushPendingAppUsage } from './appUsageMonitor'
import { ensureStarted as ensureInputActivityStarted, onTick, type InputTick } from './inputActivity'
import {
  enqueueActivitySample,
  imageDir,
  listPendingActivitySamples,
  removeActivitySample
} from './pendingActivitySamples'
import { isCheckedIn, openBreakSource, trackerState } from './trackerState'

const WINDOW_MS = 10 * 60 * 1000
const SCREENSHOT_WIDTH = 1280
const SCREENSHOT_HEIGHT = 800
const JPEG_QUALITY = 45

let windowTimer: ReturnType<typeof setTimeout> | null = null
let captureTimer: ReturnType<typeof setTimeout> | null = null
let flushTimer: ReturnType<typeof setInterval> | null = null
let unsubscribeTick: (() => void) | null = null

let running = false
let captureInFlight: Promise<void> | null = null

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

function alignedSlotStart(now: number = Date.now()): number {
  return now - (now % WINDOW_MS)
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
  if (captureTimer) {
    clearTimeout(captureTimer)
    captureTimer = null
  }
}

async function takeScreenshotForWindow(win: ActiveWindow): Promise<void> {
  const work = (async () => {
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

    ;(win as ActiveWindow & { imagePath?: string }).imagePath = filePath
  })()

  captureInFlight = work
  try {
    await work
  } finally {
    if (captureInFlight === work) captureInFlight = null
  }
}

function onSecondTick({ keyUsed, mouseUsed }: InputTick): void {
  const win = activeWindow
  if (!win) return

  win.secondsElapsed += 1
  if (keyUsed) win.keyboardSeconds += 1
  if (mouseUsed) win.mouseSeconds += 1
  if (keyUsed || mouseUsed) win.combinedSeconds += 1

  if (!shouldMonitor()) {
    void closeCurrentWindowEarly()
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
  void flushPendingAppUsage()
}

async function awaitCaptureThenEnqueue(win: ActiveWindow): Promise<void> {
  if (captureInFlight) {
    await captureInFlight
  }
  enqueueFinishedWindow(win as ActiveWindow & { imagePath?: string })
}

async function closeCurrentWindowEarly(): Promise<void> {
  const win = activeWindow
  clearWindowTimers()
  activeWindow = null
  if (win) {
    await awaitCaptureThenEnqueue(win)
  }
  scheduleNextWindow()
}

function startWindow(): void {
  if (!shouldMonitor()) {
    scheduleNextWindow()
    return
  }

  const now = Date.now()
  const windowStart = alignedSlotStart(now)
  const msIntoSlot = now % WINDOW_MS
  const msUntilEnd = msIntoSlot === 0 ? WINDOW_MS : WINDOW_MS - msIntoSlot

  const win: ActiveWindow & { imagePath?: string } = {
    windowStart,
    secondsElapsed: 0,
    keyboardSeconds: 0,
    mouseSeconds: 0,
    combinedSeconds: 0,
    screenshotTaken: false
  }
  activeWindow = win

  const remainingSec = Math.max(1, Math.floor(msUntilEnd / 1000))
  const offsetSec = remainingSec <= 1 ? 0 : randomInt(remainingSec)
  captureTimer = setTimeout(() => {
    if (activeWindow === win) {
      void takeScreenshotForWindow(win)
    }
  }, offsetSec * 1000)

  windowTimer = setTimeout(() => {
    void (async () => {
      if (activeWindow !== win) return
      clearWindowTimers()
      activeWindow = null
      await awaitCaptureThenEnqueue(win)
      if (!running) return
      startWindow()
    })()
  }, msUntilEnd)
}

function scheduleNextWindow(): void {
  if (!running) return
  if (windowTimer) {
    clearTimeout(windowTimer)
    windowTimer = null
  }
  if (!shouldMonitor()) {
    windowTimer = setTimeout(() => {
      if (!running) return
      startWindow()
    }, 1000)
    return
  }
  const now = Date.now()
  const msIntoWindow = now % WINDOW_MS
  if (msIntoWindow === 0) {
    startWindow()
    return
  }
  windowTimer = setTimeout(() => {
    if (!running) return
    startWindow()
  }, WINDOW_MS - msIntoWindow)
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
  const hookOk = ensureInputActivityStarted()
  if (running) {
    trackerState.setMonitoringActive(hookOk)
    return
  }
  running = true
  trackerState.setMonitoringError(null)
  trackerState.setMonitoringActive(hookOk)
  unsubscribeTick = onTick(onSecondTick)

  startWindow()

  if (!flushTimer) {
    flushTimer = setInterval(() => {
      void flushPendingActivity()
      void flushPendingAppUsage()
    }, 60_000)
  }

  void flushPendingActivity()
  void flushPendingAppUsage()
}

export function stopActivityMonitor(): void {
  running = false
  if (windowTimer) {
    clearTimeout(windowTimer)
    windowTimer = null
  }
  clearWindowTimers()
  if (activeWindow) {
    const win = activeWindow
    activeWindow = null
    void awaitCaptureThenEnqueue(win)
  }
  if (unsubscribeTick) {
    unsubscribeTick()
    unsubscribeTick = null
  }
  trackerState.setMonitoringActive(false)
}
