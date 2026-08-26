import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import type { AppUsageSegment } from '@shared/types'

const FILE = 'pending-app-usage.json'
/** Roughly 40 offline days at 500 segments/day; oldest are dropped past this. */
const MAX_SEGMENTS = 20_000

function filePath(): string {
  const dir = app.getPath('userData')
  mkdirSync(dir, { recursive: true })
  return join(dir, FILE)
}

function readAll(): AppUsageSegment[] {
  const path = filePath()
  if (!existsSync(path)) return []
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as AppUsageSegment[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function writeAll(items: AppUsageSegment[]): void {
  const capped = items.length > MAX_SEGMENTS ? items.slice(items.length - MAX_SEGMENTS) : items
  writeFileSync(filePath(), JSON.stringify(capped, null, 2), 'utf8')
}

export function listPendingAppUsage(): AppUsageSegment[] {
  return readAll()
}

export function pendingAppUsageCount(): number {
  return readAll().length
}

export function enqueueAppUsageSegment(segment: AppUsageSegment): void {
  const items = readAll()
  items.push(segment)
  writeAll(items)
}

export function removeAppUsageSegments(clientIds: string[]): void {
  if (!clientIds.length) return
  const drop = new Set(clientIds)
  writeAll(readAll().filter((item) => !drop.has(item.clientId)))
}
