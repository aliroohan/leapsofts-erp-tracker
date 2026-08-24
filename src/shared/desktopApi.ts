import type { TrackerState } from './types'

export interface DesktopApi {
  getState: () => Promise<TrackerState>
  login: (email: string, password: string) => Promise<TrackerState>
  logout: () => Promise<TrackerState>
  checkIn: () => Promise<TrackerState>
  checkOut: () => Promise<TrackerState>
  startBreak: () => Promise<TrackerState>
  endBreak: () => Promise<TrackerState>
  onState: (cb: (state: TrackerState) => void) => () => void
}
