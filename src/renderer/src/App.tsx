import { useEffect, useState, type JSX } from 'react'
import type { TrackerState } from '@shared/types'
import { formatDuration, getWorkedSeconds, openBreak } from './time'

export default function App(): JSX.Element {
  const [state, setState] = useState<TrackerState | null>(null)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [now, setNow] = useState(Date.now())

  useEffect(() => {
    void window.desktop.getState().then(setState)
    return window.desktop.onState(setState)
  }, [])

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [])

  const run = async (fn: () => Promise<TrackerState>): Promise<void> => {
    setBusy(true)
    setFormError(null)
    try {
      setState(await fn())
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Request failed')
    } finally {
      setBusy(false)
    }
  }

  if (!state) {
    return (
      <div className="app">
        <p className="sub">Loading…</p>
      </div>
    )
  }

  if (!state.isAuthenticated) {
    return (
      <div className="app">
        <div>
          <h1>Leapsofts Time Tracker</h1>
          <p className="sub">Sign in with your ERP account</p>
        </div>
        <div className="card">
          <label htmlFor="email">Email</label>
          <input
            id="email"
            type="email"
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <label htmlFor="password">Password</label>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          {formError ? <p className="error">{formError}</p> : null}
          <button
            disabled={busy || !email || !password}
            onClick={() => run(() => window.desktop.login(email, password))}
          >
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </div>
      </div>
    )
  }

  const shift = state.shift
  const checkedIn = shift?.status === 'checked_in'
  const currentBreak = openBreak(shift)
  const source = currentBreak?.source ?? (currentBreak ? 'manual' : null)
  const elapsed = getWorkedSeconds(shift, now)
  const name =
    `${state.user?.firstName ?? ''} ${state.user?.lastName ?? ''}`.trim() || state.user?.email || 'You'

  return (
    <div className="app">
      <div className="top">
        <div>
          <h1>{name}</h1>
          <p className="sub">Idle timeout {state.idleTimeoutMinutes} min · OS-wide</p>
        </div>
        <button className="secondary" disabled={busy} onClick={() => run(() => window.desktop.logout())}>
          Sign out
        </button>
      </div>

      <div className="card">
        <div className="meta">
          <span>{checkedIn ? 'Worked today' : 'Not checked in'}</span>
          {source ? (
            <span className={`badge ${source}`}>
              {source === 'idle' ? 'Idle break' : source === 'sleep' ? 'Sleep / offline' : 'Manual break'}
            </span>
          ) : (
            <span className="badge">{state.isOnline ? 'Online' : 'Offline'}</span>
          )}
        </div>
        <div className="clock">{formatDuration(elapsed)}</div>
        <p className="sub">
          System idle {Math.floor(state.idleSeconds / 60)}m {state.idleSeconds % 60}s
          {state.pendingCount ? ` · ${state.pendingCount} queued interval(s)` : ''}
        </p>
        {state.lastError ? <p className="error">{state.lastError}</p> : null}
        {formError ? <p className="error">{formError}</p> : null}
      </div>

      {checkedIn && !currentBreak ? (
        <div className="card">
          {state.monitoringError ? (
            <p className="error">{state.monitoringError}</p>
          ) : (
            <p className="sub">
              Screen &amp; activity monitoring: {state.monitoringActive ? 'On' : 'Starting…'}
              {state.lastSampleAt
                ? ` · last capture ${new Date(state.lastSampleAt).toLocaleTimeString()}`
                : ''}
            </p>
          )}
        </div>
      ) : null}

      <div className="row">
        {!checkedIn ? (
          <button disabled={busy} onClick={() => run(() => window.desktop.checkIn())}>
            Check in
          </button>
        ) : (
          <button className="danger" disabled={busy} onClick={() => run(() => window.desktop.checkOut())}>
            Check out
          </button>
        )}
        {checkedIn && !currentBreak ? (
          <button className="secondary" disabled={busy} onClick={() => run(() => window.desktop.startBreak())}>
            Start break
          </button>
        ) : null}
        {checkedIn && currentBreak ? (
          <button className="secondary" disabled={busy} onClick={() => run(() => window.desktop.endBreak())}>
            End break
          </button>
        ) : null}
      </div>
    </div>
  )
}
