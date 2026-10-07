export function dayKey(date: Date): string {
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`
}

export function dayKeyFromUnix(seconds: number): string {
  return dayKey(new Date(seconds * 1000))
}

export function contributionLevel(count: number): 0 | 1 | 2 | 3 | 4 {
  if (count <= 0) return 0
  if (count < 3) return 1
  if (count < 6) return 2
  if (count < 10) return 3
  return 4
}

export const RECENT_DAYS = 30
/** Day squares across the home graph: a full year of weeks. */
export const HISTORY_DAYS = 371

export type ContributionScale = 'day' | 'week' | 'month' | 'year'

export const CONTRIBUTION_SCALES: { id: ContributionScale; label: string; range: string }[] = [
  { id: 'day', label: 'Day', range: 'the last 30 days' },
  { id: 'week', label: 'Week', range: 'the last 16 weeks' },
  { id: 'month', label: 'Month', range: 'the last 12 months' },
  { id: 'year', label: 'Year', range: 'the last 5 years' }
]

export interface ScaleWindow {
  start: Date
  end: Date
  days: number
}

/** Inclusive window for a contribution scale. Day stays the short recent view. */
export function scaleWindow(scale: ContributionScale, now = new Date()): ScaleWindow {
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const start = new Date(end)
  if (scale === 'day') start.setDate(start.getDate() - (RECENT_DAYS - 1))
  else if (scale === 'week') start.setDate(start.getDate() - (16 * 7 - 1))
  else if (scale === 'month') {
    start.setDate(1)
    start.setMonth(start.getMonth() - 11)
  } else {
    start.setMonth(0, 1)
    start.setFullYear(start.getFullYear() - 4)
  }
  const days = Math.round((end.getTime() - start.getTime()) / 86400000) + 1
  return { start, end, days }
}

export interface ContributionBucket {
  key: string
  label: string
  title: string
  from: Date
  to: Date
}

export function contributionBuckets(scale: ContributionScale, now = new Date()): ContributionBucket[] {
  const { start, end } = scaleWindow(scale, now)
  if (scale === 'week') return weekBuckets(start, end)
  if (scale === 'month') return monthBuckets(start, end)
  if (scale === 'year') return yearBuckets(start, end)
  return []
}

function weekBuckets(start: Date, end: Date): ContributionBucket[] {
  const cursor = new Date(start)
  cursor.setDate(cursor.getDate() - cursor.getDay())
  const buckets: ContributionBucket[] = []
  while (cursor <= end && buckets.length < 20) {
    const weekEnd = new Date(cursor)
    weekEnd.setDate(weekEnd.getDate() + 6)
    const from = new Date(Math.max(cursor.getTime(), start.getTime()))
    const to = new Date(Math.min(weekEnd.getTime(), end.getTime()))
    buckets.push({
      key: dayKey(from),
      label: from.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
      title: `the week of ${from.toLocaleDateString(undefined, { month: 'long', day: 'numeric' })}`,
      from,
      to
    })
    cursor.setDate(cursor.getDate() + 7)
  }
  return buckets
}

function monthBuckets(start: Date, end: Date): ContributionBucket[] {
  const cursor = new Date(start.getFullYear(), start.getMonth(), 1)
  const buckets: ContributionBucket[] = []
  while (cursor <= end && buckets.length < 18) {
    const monthEnd = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0)
    const from = new Date(Math.max(cursor.getTime(), start.getTime()))
    const to = new Date(Math.min(monthEnd.getTime(), end.getTime()))
    buckets.push({
      key: `${cursor.getFullYear()}-${cursor.getMonth() + 1}`,
      label: cursor.toLocaleDateString(undefined, { month: 'short' }),
      title: cursor.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }),
      from,
      to
    })
    cursor.setMonth(cursor.getMonth() + 1)
  }
  return buckets
}

function yearBuckets(start: Date, end: Date): ContributionBucket[] {
  const buckets: ContributionBucket[] = []
  for (let year = start.getFullYear(); year <= end.getFullYear() && buckets.length < 8; year++) {
    const from = new Date(Math.max(new Date(year, 0, 1).getTime(), start.getTime()))
    const to = new Date(Math.min(new Date(year, 11, 31).getTime(), end.getTime()))
    buckets.push({ key: String(year), label: String(year), title: String(year), from, to })
  }
  return buckets
}

/** Sunday-start weeks covering the recent day span, including today. */
export function contributionWeeks(now = new Date(), spanDays = RECENT_DAYS): Date[][] {
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const start = new Date(end)
  start.setDate(start.getDate() - (spanDays - 1))
  start.setDate(start.getDate() - start.getDay())
  const weeks: Date[][] = []
  const cursor = new Date(start)
  while (weeks.length < 60) {
    const week: Date[] = []
    for (let i = 0; i < 7; i++) {
      week.push(new Date(cursor))
      cursor.setDate(cursor.getDate() + 1)
    }
    weeks.push(week)
    if (week[6].getTime() >= end.getTime()) break
  }
  return weeks
}

export function monthMarks(weeks: Date[][]): (string | null)[] {
  const marks: (string | null)[] = weeks.map(() => null)
  let previous = -99
  weeks.forEach((week, index) => {
    const first = week.find((day) => day.getDate() === 1) ?? (index === 0 ? week[0] : undefined)
    if (!first || index - previous < 2) return
    previous = index
    marks[index] = first.toLocaleDateString(undefined, { month: 'short' })
  })
  return marks
}
