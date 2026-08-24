import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import type { PendingBreak } from '@shared/types'

const FILE = 'pending-breaks.json'

function filePath(): string {
  const dir = app.getPath('userData')
  mkdirSync(dir, { recursive: true })
  return join(dir, FILE)
}

function readAll(): PendingBreak[] {
  const path = filePath()
  if (!existsSync(path)) return []
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as PendingBreak[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function writeAll(items: PendingBreak[]): void {
  writeFileSync(filePath(), JSON.stringify(items, null, 2), 'utf8')
}

export function listPendingBreaks(): PendingBreak[] {
  return readAll()
}

export function pendingCount(): number {
  return readAll().length
}

export function hasOpenPending(): boolean {
  return readAll().some((item) => !item.endTime)
}

/** Synchronous disk write — used on suspend / offline so the timestamp survives sleep. */
export function appendOpenInterval(source: PendingBreak['source'], startTime: string = new Date().toISOString()): PendingBreak | null {
  const items = readAll()
  if (items.some((item) => !item.endTime)) {
    return null
  }
  const entry: PendingBreak = {
    id: randomUUID(),
    startTime,
    endTime: null,
    source
  }
  items.push(entry)
  writeAll(items)
  return entry
}

export function closeOpenIntervals(endTime: string = new Date().toISOString()): PendingBreak[] {
  const items = readAll()
  let changed = false
  for (const item of items) {
    if (!item.endTime) {
      item.endTime = endTime
      changed = true
    }
  }
  if (changed) writeAll(items)
  return items.filter((item) => Boolean(item.endTime))
}

export function removePending(id: string): void {
  writeAll(readAll().filter((item) => item.id !== id))
}

export function closedPendingBreaks(): PendingBreak[] {
  return readAll().filter((item): item is PendingBreak & { endTime: string } => Boolean(item.endTime))
}
