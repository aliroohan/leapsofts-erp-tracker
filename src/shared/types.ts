export type BreakSource = 'manual' | 'idle' | 'sleep'

export interface ShiftBreak {
  startTime: string
  endTime: string | null
  source?: BreakSource
}

export interface Shift {
  _id: string
  userId: string
  date: string
  checkInTime: string | null
  checkOutTime: string | null
  totalMinutes?: number
  breaks?: ShiftBreak[]
  totalBreakMinutes?: number
  status: 'not_started' | 'checked_in' | 'checked_out'
  isActive?: boolean
}

export interface TrackerUser {
  _id: string
  email: string
  firstName?: string
  lastName?: string
  idleTimeoutMinutes?: number
  monitorScreenshots?: boolean
  monitorAppUsage?: boolean
}

export interface PendingBreak {
  id: string
  startTime: string
  endTime: string | null
  source: 'sleep' | 'idle'
}

export type UsagePlatform = 'macos' | 'windows' | 'linux'

export interface AppUsageSegment {
  /** uuid, backend idempotency key */
  clientId: string
  app: string
  execName: string
  title: string
  /** Hostname only (no path, query, or hash). */
  url: string | null
  domain: string | null
  startedAt: string
  endedAt: string
  /** Wall-clock focus time. */
  durationSec: number
  /** Seconds within the segment that saw keyboard or mouse input. */
  activeSec: number
  platform: UsagePlatform
}

export interface TrackingSummary {
  app: string | null
  domain: string | null
  pendingSegments: number
}

export interface TrackerState {
  isAuthenticated: boolean
  user: TrackerUser | null
  shift: Shift | null
  idleSeconds: number
  idleTimeoutMinutes: number
  isOnline: boolean
  pendingCount: number
  lastError: string | null
  monitoringActive: boolean
  monitoringError: string | null
  lastSampleAt: string | null
  trackingSummary: TrackingSummary | null
}

export interface PendingActivitySample {
  id: string
  windowStart: string
  capturedAt: string
  keyboardPct: number
  mousePct: number
  combinedPct: number
  /** Absolute path to the JPEG screenshot on disk, queued for upload. */
  imagePath: string
}

export const DEFAULT_IDLE_TIMEOUT_MINUTES = 5
