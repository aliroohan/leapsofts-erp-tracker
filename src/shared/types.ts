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
}

export interface PendingBreak {
  id: string
  startTime: string
  endTime: string | null
  source: 'sleep' | 'idle'
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
}

export const DEFAULT_IDLE_TIMEOUT_MINUTES = 5
