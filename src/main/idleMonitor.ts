import { net, powerMonitor } from 'electron'
import { flushPendingActivity, startActivityMonitor, stopActivityMonitor } from './activityMonitor'
import {
  closeOpenUsageSegment,
  flushPendingAppUsage,
  startAppUsageMonitor,
  stopAppUsageMonitor
} from './appUsageMonitor'
import {
  appendOpenInterval,
  closeOpenIntervals,
  closedPendingBreaks,
  hasOpenPending,
  removePending
} from './pendingBreaks'
import {
  checkIn,
  checkOut,
  endBreak,
  fetchMe,
  fetchTodayShift,
  isNetworkError,
  login as apiLogin,
  logoutRemote,
  recordBreak,
  startBreak
} from './api'
import { isCheckedIn, openBreakSource, trackerState } from './trackerState'
import { loadAccessToken } from './tokenStore'
import {
  getCachedMutterIdleSeconds,
  probeMutterIdleSeconds,
  refreshMutterIdleSeconds
} from './linuxDesktop'
import type { Shift } from '@shared/types'

const IDLE_POLL_MS = 2000
/** ~5s of activity (3 × 2s polls) before auto-ending an idle break. */
const ACTIVITY_POLLS_TO_END_IDLE = 3
const ACTIVITY_IDLE_THRESHOLD_SEC = 3

let pollTimer: ReturnType<typeof setInterval> | null = null
let activityStreak = 0
let inFlight = false
let wired = false

function wantsScreenshots(): boolean {
  return trackerState.get().user?.monitorScreenshots !== false
}

function wantsAppUsage(): boolean {
  return trackerState.get().user?.monitorAppUsage !== false
}

function syncActivityMonitor(): void {
  const { shift, isAuthenticated } = trackerState.get()
  const shouldRun = isAuthenticated && isCheckedIn(shift) && !openBreakSource(shift)
  if (shouldRun && wantsScreenshots()) {
    startActivityMonitor()
  } else {
    stopActivityMonitor()
  }
  if (shouldRun && wantsAppUsage()) {
    startAppUsageMonitor()
  } else {
    stopAppUsageMonitor()
  }
}

async function refreshMeQuietly(): Promise<void> {
  try {
    const user = await fetchMe()
    trackerState.setUser(user)
    syncActivityMonitor()
  } catch {
    // Keep the last known profile if /users/me is briefly unavailable.
  }
}

async function applyShift(shift: Shift | null): Promise<void> {
  await refreshMeQuietly()
  trackerState.setShift(shift)
  syncActivityMonitor()
}

function shouldRecordSleep(): boolean {
  const { shift, isAuthenticated } = trackerState.get()
  if (!isAuthenticated || !isCheckedIn(shift)) return false
  return openBreakSource(shift) !== 'manual'
}

function recordSleepOrOfflineStart(): void {
  if (!shouldRecordSleep()) return
  appendOpenInterval('sleep')
  trackerState.refreshPending()
}

async function flushPendingQueue(): Promise<void> {
  const closed = closedPendingBreaks()
  if (!closed.length) {
    trackerState.refreshPending()
    return
  }

  for (const item of closed) {
    if (!item.endTime) continue
    try {
      const shift = await recordBreak({
        startTime: item.startTime,
        endTime: item.endTime,
        source: item.source
      })
      removePending(item.id)
      await applyShift(shift)
      trackerState.setError(null)
    } catch (err) {
      if (isNetworkError(err)) {
        trackerState.setOnline(false)
        trackerState.setError('Offline — sleep/idle intervals will sync when the network returns')
        return
      }
      // Idempotent duplicate / validation that time is already counted: drop the entry.
      const message = err instanceof Error ? err.message : 'Failed to sync break'
      const lower = message.toLowerCase()
      if (
        lower.includes('duplicate') ||
        lower.includes('already') ||
        lower.includes('idempotent')
      ) {
        removePending(item.id)
        continue
      }
      trackerState.setError(message)
      return
    }
  }
  trackerState.refreshPending()
}

async function closeOpenAndFlush(endTime: string = new Date().toISOString()): Promise<void> {
  closeOpenUsageSegment()
  closeOpenIntervals(endTime)
  trackerState.refreshPending()
  await flushPendingQueue()
  await flushPendingActivity()
  await flushPendingAppUsage()
}

async function refreshProfileAndShift(): Promise<void> {
  const user = await fetchMe()
  trackerState.setUser(user)
  const shift = await fetchTodayShift()
  await applyShift(shift)
}

export async function bootstrapSession(): Promise<void> {
  if (!loadAccessToken()) {
    trackerState.reset()
    stopActivityMonitor()
    stopAppUsageMonitor()
    return
  }
  try {
    await refreshProfileAndShift()
    trackerState.setError(null)
    await closeOpenAndFlush()
  } catch (err) {
    if (isNetworkError(err)) {
      trackerState.setOnline(false)
      return
    }
    trackerState.reset()
  }
}

export async function login(email: string, password: string): Promise<void> {
  const user = await apiLogin(email, password)
  trackerState.setUser(user)
  try {
    const me = await fetchMe()
    trackerState.setUser(me)
  } catch {
    // login user payload is enough if /users/me is briefly unavailable
  }
  const shift = await fetchTodayShift()
  await applyShift(shift)
  trackerState.setError(null)
  await flushPendingQueue()
}

export async function logout(): Promise<void> {
  stopActivityMonitor()
  stopAppUsageMonitor()
  await logoutRemote()
  trackerState.reset()
}

export async function userCheckIn(): Promise<void> {
  const shift = await checkIn()
  await applyShift(shift)
}

export async function userCheckOut(): Promise<void> {
  closeOpenUsageSegment()
  await flushPendingActivity()
  await flushPendingAppUsage()
  const shift = await checkOut()
  await applyShift(shift)
}

export async function userStartBreak(): Promise<void> {
  closeOpenUsageSegment()
  await flushPendingActivity()
  await flushPendingAppUsage()
  const shift = await startBreak('manual')
  await applyShift(shift)
}

export async function userEndBreak(): Promise<void> {
  const shift = await endBreak()
  await applyShift(shift)
}

async function maybeStartIdleBreak(idleSeconds: number): Promise<void> {
  const { shift, idleTimeoutMinutes, isOnline, isAuthenticated } = trackerState.get()
  if (!isAuthenticated || !isOnline || !isCheckedIn(shift)) return
  if (openBreakSource(shift)) return
  if (hasOpenPending()) return
  if (inFlight) return

  const threshold = Math.max(1, idleTimeoutMinutes) * 60
  if (idleSeconds < threshold) return

  inFlight = true
  try {
    const next = await startBreak('idle')
    await applyShift(next)
    trackerState.setError(null)
  } catch (err) {
    if (isNetworkError(err)) {
      trackerState.setOnline(false)
      recordSleepOrOfflineStart()
      return
    }
    trackerState.setError(err instanceof Error ? err.message : 'Could not start idle break')
  } finally {
    inFlight = false
  }
}

async function maybeEndIdleBreak(): Promise<void> {
  const { shift, isOnline } = trackerState.get()
  if (!isOnline || openBreakSource(shift) !== 'idle' || inFlight) return

  inFlight = true
  try {
    const next = await endBreak()
    await applyShift(next)
    trackerState.setError(null)
  } catch (err) {
    if (isNetworkError(err)) {
      trackerState.setOnline(false)
      return
    }
    trackerState.setError(err instanceof Error ? err.message : 'Could not end idle break')
  } finally {
    inFlight = false
  }
}

function onIdleTick(): void {
  const online = net.isOnline()
  const wasOnline = trackerState.get().isOnline
  trackerState.setOnline(online)

  if (wasOnline && !online) {
    recordSleepOrOfflineStart()
  }
  if (!wasOnline && online) {
    void closeOpenAndFlush()
  }

  refreshMutterIdleSeconds()
  const mutterIdle = getCachedMutterIdleSeconds()
  const idleSeconds = mutterIdle ?? powerMonitor.getSystemIdleTime()
  trackerState.setIdleSeconds(idleSeconds)

  if (idleSeconds < ACTIVITY_IDLE_THRESHOLD_SEC) {
    activityStreak += 1
  } else {
    activityStreak = 0
  }

  if (activityStreak >= ACTIVITY_POLLS_TO_END_IDLE) {
    void maybeEndIdleBreak()
    return
  }

  void maybeStartIdleBreak(idleSeconds)
}

export function startIdleMonitor(): void {
  if (pollTimer) return
  pollTimer = setInterval(onIdleTick, IDLE_POLL_MS)
  void probeMutterIdleSeconds().finally(() => {
    onIdleTick()
  })
}

export function wirePowerAndNetwork(): void {
  if (wired) return
  wired = true

  powerMonitor.on('suspend', () => {
    closeOpenUsageSegment()
    recordSleepOrOfflineStart()
    void flushPendingActivity()
    void flushPendingAppUsage()
  })

  powerMonitor.on('resume', () => {
    void closeOpenAndFlush()
  })

  powerMonitor.on('unlock-screen', () => {
    void closeOpenAndFlush()
  })
}

export { flushPendingQueue }
