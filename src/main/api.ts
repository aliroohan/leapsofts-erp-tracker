import { net, session } from 'electron'
import type { BreakSource, Shift, TrackerUser } from '@shared/types'
import { clearAccessToken, loadAccessToken, saveAccessToken } from './tokenStore'

const apiBase = (): string => {
  const raw = (import.meta.env.VITE_API_URL as string | undefined) || 'http://localhost:5000/api/v1'
  return raw.replace(/\/$/, '')
}

interface ApiEnvelope<T> {
  success?: boolean
  data?: T
  message?: string
  error?: { message?: string; code?: string }
}

class ApiError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

let refreshing = false

async function parseBody(res: Response): Promise<ApiEnvelope<unknown>> {
  const text = await res.text()
  if (!text) return {}
  try {
    return JSON.parse(text) as ApiEnvelope<unknown>
  } catch {
    return { message: text }
  }
}

async function rawFetch(path: string, init: RequestInit, token?: string | null): Promise<Response> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(init.headers as Record<string, string> | undefined)
  }
  if (token) headers.Authorization = `Bearer ${token}`

  return session.defaultSession.fetch(`${apiBase()}${path}`, {
    method: init.method ?? 'GET',
    headers,
    body: init.body as string | undefined
  })
}

async function refreshAccessToken(): Promise<string | null> {
  if (refreshing) return loadAccessToken()
  refreshing = true
  try {
    const res = await rawFetch('/auth/refresh', { method: 'POST' }, null)
    const body = await parseBody(res)
    if (!res.ok) return null
    const token = (body.data as { accessToken?: string } | undefined)?.accessToken
    if (!token) return null
    saveAccessToken(token)
    return token
  } catch {
    return null
  } finally {
    refreshing = false
  }
}

export async function apiRequest<T>(path: string, init: RequestInit = {}, retry = true): Promise<T> {
  let token = loadAccessToken()
  let res: Response
  try {
    res = await rawFetch(path, init, token)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Network error'
    throw new ApiError(message, 0)
  }

  if (res.status === 401 && retry && !path.includes('/auth/login')) {
    const next = await refreshAccessToken()
    if (next) {
      return apiRequest<T>(path, init, false)
    }
  }

  const body = await parseBody(res)
  if (!res.ok) {
    const message =
      (body.error && typeof body.error === 'object' && body.error.message) ||
      body.message ||
      `Request failed (${res.status})`
    throw new ApiError(String(message), res.status)
  }

  return body.data as T
}

export function isNetworkError(err: unknown): boolean {
  if (err instanceof ApiError && err.status === 0) return true
  if (err instanceof TypeError) return true
  return false
}

export async function login(email: string, password: string): Promise<TrackerUser> {
  const data = await apiRequest<{ accessToken: string; user: TrackerUser }>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password })
  })
  saveAccessToken(data.accessToken)
  return data.user
}

export async function fetchMe(): Promise<TrackerUser> {
  return apiRequest<TrackerUser>('/users/me')
}

export async function fetchTodayShift(): Promise<Shift | null> {
  try {
    const shift = await apiRequest<Shift | null>('/shifts/today')
    return shift ?? null
  } catch (err) {
    if (err instanceof ApiError && (err.status === 404 || err.status === 400)) return null
    throw err
  }
}

export async function checkIn(): Promise<Shift> {
  return apiRequest<Shift>('/shifts/check-in', { method: 'POST' })
}

export async function checkOut(): Promise<Shift> {
  return apiRequest<Shift>('/shifts/check-out', { method: 'POST' })
}

export async function startBreak(source: BreakSource = 'manual'): Promise<Shift> {
  return apiRequest<Shift>('/shifts/break/start', {
    method: 'POST',
    body: JSON.stringify({ source })
  })
}

export async function endBreak(): Promise<Shift> {
  return apiRequest<Shift>('/shifts/break/end', { method: 'POST' })
}

export async function recordBreak(payload: {
  startTime: string
  endTime: string
  source: 'sleep' | 'idle'
}): Promise<Shift> {
  return apiRequest<Shift>('/shifts/break/record', {
    method: 'POST',
    body: JSON.stringify(payload)
  })
}

export async function logoutRemote(): Promise<void> {
  try {
    await apiRequest('/auth/logout', { method: 'POST' })
  } catch {
    // still clear local session
  }
  clearAccessToken()
}

export function isOnlineNow(): boolean {
  return net.isOnline()
}

export { ApiError }
