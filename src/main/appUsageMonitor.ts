import { randomUUID } from 'node:crypto'
import type { AppUsageSegment } from '@shared/types'
import { currentPlatform, getActiveWindow } from './activeWindowProvider'
import { isNetworkError, uploadAppUsage } from './api'
import {
  ensureStarted as ensureInputActivityStarted,
  getCumulativeActiveSec,
  hasPendingInputThisSecond,
  onTick,
  type InputTick
} from './inputActivity'
import {
  enqueueAppUsageSegment,
  listPendingAppUsage,
  pendingAppUsageCount,
  removeAppUsageSegments
} from './pendingAppUsage'
import { isCheckedIn, openBreakSource, trackerState } from './trackerState'
import { sanitizeUrl } from './urlSanitizer'

const POLL_MS = 5000
const FLUSH_MS = 60_000
const WINDOW_MS = 10 * 60 * 1000
const MIN_SEGMENT_SEC = 2
const BATCH_SIZE = 200

interface OpenSegment {
  app: string
  execName: string
  title: string
  url: string | null
  domain: string | null
  startedAtMs: number
  /** Snapshot of inputActivity cumulativeActiveSec when the segment opened. */
  activeOrigin: number
  /** Backup count from onTick while this segment is open. */
  activeSec: number
}

let pollTimer: ReturnType<typeof setInterval> | null = null
let flushTimer: ReturnType<typeof setInterval> | null = null
let unsubscribeTick: (() => void) | null = null

let running = false
let polling = false
let open: OpenSegment | null = null

function shouldMonitor(): boolean {
  const { shift, isAuthenticated } = trackerState.get()
  if (!isAuthenticated || !isCheckedIn(shift)) return false
  return !openBreakSource(shift)
}

function publishSummary(): void {
  trackerState.setTrackingSummary({
    app: open?.app ?? null,
    domain: open?.domain ?? null,
    pendingSegments: pendingAppUsageCount()
  })
}

function measureActiveSec(segment: OpenSegment): number {
  const fromCumulative = getCumulativeActiveSec() - segment.activeOrigin
  const fromTicks = segment.activeSec
  let active = Math.max(0, fromCumulative, fromTicks)
  // Close can land between input events and the 1s emitTick; count that partial second.
  if (hasPendingInputThisSecond()) active += 1
  return active
}

function closeOpenSegment(endMs: number = Date.now()): void {
  const segment = open
  open = null
  if (!segment) return

  const elapsedMs = endMs - segment.startedAtMs
  if (elapsedMs < MIN_SEGMENT_SEC * 1000) return
  const durationSec = Math.max(MIN_SEGMENT_SEC, Math.round(elapsedMs / 1000))

  const entry: AppUsageSegment = {
    clientId: randomUUID(),
    app: segment.app,
    execName: segment.execName,
    title: segment.title,
    url: segment.url,
    domain: segment.domain,
    startedAt: new Date(segment.startedAtMs).toISOString(),
    endedAt: new Date(endMs).toISOString(),
    durationSec,
    activeSec: Math.min(measureActiveSec(segment), durationSec),
    platform: currentPlatform()
  }
  enqueueAppUsageSegment(entry)
}

/** Called on break start, check-out, suspend and shutdown so no segment spans idle time. */
export function closeOpenUsageSegment(): void {
  closeOpenSegment()
  publishSummary()
}

function onSecondTick({ keyUsed, mouseUsed }: InputTick): void {
  if (!open) return
  if (keyUsed || mouseUsed) open.activeSec += 1
}

async function poll(): Promise<void> {
  if (polling) return
  polling = true
  try {
    if (!shouldMonitor()) {
      closeOpenSegment()
      publishSummary()
      return
    }

    let snapshot: Awaited<ReturnType<typeof getActiveWindow>>
    try {
      snapshot = await getActiveWindow()
    } catch {
      trackerState.setMonitoringError(
        'Window tracking unavailable — grant Screen Recording and Automation permission in System Settings and restart the app.'
      )
      closeOpenSegment()
      publishSummary()
      return
    }

    const now = Date.now()
    if (!snapshot) {
      closeOpenSegment(now)
      publishSummary()
      return
    }

    const sanitized = sanitizeUrl(snapshot.rawUrl)
    const url = sanitized?.url ?? null
    const domain = sanitized?.domain ?? null

    const crossesBoundary =
      open !== null && Math.floor(open.startedAtMs / WINDOW_MS) !== Math.floor(now / WINDOW_MS)
    const changed =
      open === null ||
      open.app !== snapshot.app ||
      open.title !== snapshot.title ||
      open.url !== url

    if (changed || crossesBoundary) {
      closeOpenSegment(now)
      open = {
        app: snapshot.app,
        execName: snapshot.execName,
        title: snapshot.title,
        url,
        domain,
        startedAtMs: now,
        activeOrigin: getCumulativeActiveSec(),
        activeSec: 0
      }
    }

    publishSummary()
  } finally {
    polling = false
  }
}

export async function flushPendingAppUsage(): Promise<void> {
  const pending = listPendingAppUsage()
  if (!pending.length) return

  for (let i = 0; i < pending.length; i += BATCH_SIZE) {
    const batch = pending.slice(i, i + BATCH_SIZE)
    const ids = batch.map((item) => item.clientId)
    try {
      await uploadAppUsage(batch)
      removeAppUsageSegments(ids)
      trackerState.setError(null)
    } catch (err) {
      if (isNetworkError(err)) {
        trackerState.setOnline(false)
        return
      }
      // Drop unrecoverable/validation errors so the queue doesn't jam forever.
      removeAppUsageSegments(ids)
    }
  }
  publishSummary()
}

export function startAppUsageMonitor(): void {
  ensureInputActivityStarted()
  if (running) return
  running = true
  unsubscribeTick = onTick(onSecondTick)

  pollTimer = setInterval(() => {
    void poll()
  }, POLL_MS)
  void poll()

  if (!flushTimer) {
    flushTimer = setInterval(() => {
      void flushPendingAppUsage()
    }, FLUSH_MS)
  }

  void flushPendingAppUsage()
}

export function stopAppUsageMonitor(): void {
  if (!running) return
  running = false

  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
  if (unsubscribeTick) {
    unsubscribeTick()
    unsubscribeTick = null
  }
  closeOpenSegment()
  publishSummary()
  void flushPendingAppUsage()
}
