import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import type { PendingActivitySample } from '@shared/types'

const FILE = 'pending-activity-samples.json'
const IMAGE_DIR = 'activity-screenshots'

function filePath(): string {
  const dir = app.getPath('userData')
  mkdirSync(dir, { recursive: true })
  return join(dir, FILE)
}

export function imageDir(): string {
  const dir = join(app.getPath('userData'), IMAGE_DIR)
  mkdirSync(dir, { recursive: true })
  return dir
}

function readAll(): PendingActivitySample[] {
  const path = filePath()
  if (!existsSync(path)) return []
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as PendingActivitySample[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function writeAll(items: PendingActivitySample[]): void {
  writeFileSync(filePath(), JSON.stringify(items, null, 2), 'utf8')
}

export function listPendingActivitySamples(): PendingActivitySample[] {
  return readAll()
}

export function pendingActivityCount(): number {
  return readAll().length
}

export function enqueueActivitySample(
  sample: Omit<PendingActivitySample, 'id'>
): PendingActivitySample {
  const items = readAll()
  const entry: PendingActivitySample = { id: randomUUID(), ...sample }
  items.push(entry)
  writeAll(items)
  return entry
}

export function removeActivitySample(id: string): void {
  const items = readAll()
  const target = items.find((item) => item.id === id)
  if (target) {
    try {
      if (existsSync(target.imagePath)) unlinkSync(target.imagePath)
    } catch {
      // best effort cleanup
    }
  }
  writeAll(items.filter((item) => item.id !== id))
}
