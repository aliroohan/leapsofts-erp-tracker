import { EventEmitter } from 'node:events'
import type { Shift, TrackerState, TrackerUser, TrackingSummary } from '@shared/types'
import { DEFAULT_IDLE_TIMEOUT_MINUTES } from '@shared/types'
import { pendingCount } from './pendingBreaks'

class StateHub extends EventEmitter {
  private snapshot: TrackerState = {
    isAuthenticated: false,
    user: null,
    shift: null,
    idleSeconds: 0,
    idleTimeoutMinutes: DEFAULT_IDLE_TIMEOUT_MINUTES,
    isOnline: true,
    pendingCount: 0,
    lastError: null,
    monitoringActive: false,
    monitoringError: null,
    lastSampleAt: null,
    trackingSummary: null
  }

  get(): TrackerState {
    return { ...this.snapshot, pendingCount: pendingCount() }
  }

  patch(partial: Partial<TrackerState>): TrackerState {
    this.snapshot = { ...this.snapshot, ...partial, pendingCount: pendingCount() }
    const next = this.get()
    this.emit('change', next)
    return next
  }

  setUser(user: TrackerUser | null): void {
    const minutes = user?.idleTimeoutMinutes && user.idleTimeoutMinutes > 0
      ? user.idleTimeoutMinutes
      : DEFAULT_IDLE_TIMEOUT_MINUTES
    this.patch({
      user,
      isAuthenticated: Boolean(user),
      idleTimeoutMinutes: minutes
    })
  }

  setShift(shift: Shift | null): void {
    this.patch({ shift })
  }

  setIdleSeconds(idleSeconds: number): void {
    if (this.snapshot.idleSeconds === idleSeconds) return
    this.patch({ idleSeconds })
  }

  setOnline(isOnline: boolean): void {
    if (this.snapshot.isOnline === isOnline) return
    this.patch({ isOnline })
  }

  setError(lastError: string | null): void {
    this.patch({ lastError })
  }

  setMonitoringActive(monitoringActive: boolean): void {
    if (this.snapshot.monitoringActive === monitoringActive) return
    this.patch({ monitoringActive })
  }

  setMonitoringError(monitoringError: string | null): void {
    if (this.snapshot.monitoringError === monitoringError) return
    this.patch({ monitoringError })
  }

  setLastSampleAt(lastSampleAt: string | null): void {
    this.patch({ lastSampleAt })
  }

  setTrackingSummary(trackingSummary: TrackingSummary | null): void {
    const current = this.snapshot.trackingSummary
    if (
      current?.app === trackingSummary?.app &&
      current?.domain === trackingSummary?.domain &&
      current?.pendingSegments === trackingSummary?.pendingSegments
    ) {
      return
    }
    this.patch({ trackingSummary })
  }

  refreshPending(): void {
    this.patch({})
  }

  reset(): void {
    this.snapshot = {
      isAuthenticated: false,
      user: null,
      shift: null,
      idleSeconds: 0,
      idleTimeoutMinutes: DEFAULT_IDLE_TIMEOUT_MINUTES,
      isOnline: this.snapshot.isOnline,
      pendingCount: pendingCount(),
      lastError: null,
      monitoringActive: false,
      monitoringError: this.snapshot.monitoringError,
      lastSampleAt: this.snapshot.lastSampleAt,
      trackingSummary: null
    }
    this.emit('change', this.get())
  }
}

export const trackerState = new StateHub()

export function openBreakSource(shift: Shift | null): 'manual' | 'idle' | 'sleep' | null {
  if (!shift?.breaks?.length) return null
  const last = shift.breaks[shift.breaks.length - 1]
  if (!last || last.endTime) return null
  return last.source ?? 'manual'
}

export function isCheckedIn(shift: Shift | null): boolean {
  return Boolean(shift && shift.status === 'checked_in' && shift.checkInTime)
}
