import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import type { RepoOverview } from '../shared/types'

interface OverviewRecord {
  stamp: string
  overview: RepoOverview
  savedAt: number
}

interface ActivityRecord {
  stamp: string
  span: number
  author: string
  days: Record<string, number>
  savedAt: number
}

interface CacheFile {
  overview: Record<string, OverviewRecord>
  activity: Record<string, ActivityRecord>
}

const MAX_RECORDS = 400
let data: CacheFile | null = null
let timer: NodeJS.Timeout | null = null

function filePath(): string {
  const dir = app.getPath('userData')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return resolve(dir, 'repo-records.json')
}

function keyOf(path: string): string {
  return resolve(path).toLowerCase()
}

function load(): CacheFile {
  if (data) return data
  try {
    const parsed = JSON.parse(readFileSync(filePath(), 'utf8')) as Partial<CacheFile>
    data = {
      overview: parsed.overview && typeof parsed.overview === 'object' ? parsed.overview : {},
      activity: parsed.activity && typeof parsed.activity === 'object' ? parsed.activity : {}
    }
  } catch {
    data = { overview: {}, activity: {} }
  }
  return data
}

function prune(bucket: Record<string, { savedAt: number }>): void {
  const entries = Object.entries(bucket)
  if (entries.length <= MAX_RECORDS) return
  entries.sort((a, b) => a[1].savedAt - b[1].savedAt)
  for (const [key] of entries.slice(0, entries.length - MAX_RECORDS)) delete bucket[key]
}

export function flush(): void {
  if (timer) {
    clearTimeout(timer)
    timer = null
  }
  if (!data) return
  const file = filePath()
  if (!existsSync(dirname(file))) mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify(data))
}

function schedule(): void {
  if (timer) return
  timer = setTimeout(() => {
    timer = null
    flush()
  }, 400)
}

export function recallOverview(path: string, stamp: string): RepoOverview | null {
  const row = load().overview[keyOf(path)]
  if (!row || row.stamp !== stamp || !row.overview) return null
  return row.overview
}

export function saveOverview(path: string, stamp: string, overview: RepoOverview): void {
  const bucket = load().overview
  bucket[keyOf(path)] = { stamp, overview, savedAt: Date.now() }
  prune(bucket)
  schedule()
}

export function recallActivity(path: string, stamp: string, span: number, author: string): Record<string, number> | null {
  const row = load().activity[keyOf(path)]
  if (!row || row.stamp !== stamp || row.author !== author || row.span < span || !row.days) return null
  return row.days
}

export function saveActivity(path: string, stamp: string, span: number, author: string, days: Record<string, number>): void {
  const bucket = load().activity
  const key = keyOf(path)
  const prev = bucket[key]
  if (prev && prev.stamp === stamp && prev.author === author && prev.span > span) return
  bucket[key] = { stamp, span, author, days, savedAt: Date.now() }
  prune(bucket)
  schedule()
}

export function forget(path: string): void {
  const key = keyOf(path)
  const file = load()
  delete file.overview[key]
  delete file.activity[key]
  schedule()
}
