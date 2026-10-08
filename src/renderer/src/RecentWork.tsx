import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import {
  CONTRIBUTION_SCALES,
  HISTORY_DAYS,
  contributionBuckets,
  contributionLevel,
  contributionWeeks,
  dayKey,
  monthMarks,
  scaleWindow,
  type ContributionBucket,
  type ContributionScale
} from '../../shared/activity'
import type { ActivityProgress, ActivityReport, RepoActivity, RepoOverview, RepoSummary } from '../../shared/types'
import { Button } from './Button'
import { IcoBranch, IcoClone, IcoHome } from './icons'
import { avatarColor, formatAgo, initials } from './lib'

/** Activity survives Home remounts; the main process re-validates it against each repo's state. */
const activityMemo: { rows: RepoActivity[] | null; key: string } = { rows: null, key: '' }

const DOW = ['', 'Mon', '', 'Wed', '', 'Fri', '']

type DayStat = { count: number; repos: { path: string; name: string; count: number }[] }

function prettyDay(key: string): string {
  const [year, month, day] = key.split('-').map(Number)
  return new Date(year, (month || 1) - 1, day || 1).toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric'
  })
}

function noun(count: number): string {
  return `${count.toLocaleString()} contribution${count === 1 ? '' : 's'}`
}

function statsBetween(byDay: Map<string, DayStat>, from: Date, to: Date): DayStat {
  const repos = new Map<string, { name: string; count: number }>()
  let count = 0
  const cursor = new Date(from)
  while (cursor <= to) {
    const stat = byDay.get(dayKey(cursor))
    if (stat) {
      count += stat.count
      for (const repo of stat.repos) {
        const hit = repos.get(repo.path) ?? { name: repo.name, count: 0 }
        hit.count += repo.count
        repos.set(repo.path, hit)
      }
    }
    cursor.setDate(cursor.getDate() + 1)
  }
  const list = [...repos.entries()].map(([path, repo]) => ({ path, name: repo.name, count: repo.count }))
  list.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
  return { count, repos: list }
}

function shade(count: number, max: number): 0 | 1 | 2 | 3 | 4 {
  if (count <= 0 || max <= 0) return 0
  const ratio = count / max
  if (ratio <= 0.25) return 1
  if (ratio <= 0.5) return 2
  if (ratio <= 0.75) return 3
  return 4
}

export function RecentWork({
  recent,
  overviews,
  analyzing,
  selected,
  onSelect,
  onOpen,
  onClone
}: {
  recent: RepoSummary[]
  overviews: Record<string, RepoOverview>
  analyzing?: Set<string>
  selected?: string
  onSelect?: (path: string) => void
  onOpen: (path: string, name?: string) => void
  onClone: () => void
}) {
  const today = useMemo(() => {
    const date = new Date()
    date.setHours(0, 0, 0, 0)
    return date
  }, [])
  const [scale, setScale] = useState<ContributionScale>('day')
  const period = useMemo(() => scaleWindow(scale, today), [scale, today])
  const historyStart = useMemo(() => {
    const date = new Date(today)
    date.setDate(date.getDate() - (HISTORY_DAYS - 1))
    return date
  }, [today])
  const weeks = useMemo(() => contributionWeeks(today, HISTORY_DAYS), [today])
  const sparkWeeks = useMemo(() => weeks.slice(-16), [weeks])
  const months = useMemo(() => monthMarks(weeks), [weeks])
  const buckets = useMemo(() => contributionBuckets(scale, today), [scale, today])
  const range = CONTRIBUTION_SCALES.find((item) => item.id === scale)?.range ?? 'the last 30 days'
  const opened = useMemo(
    () =>
      [...recent]
        .filter((repo) => repo.lastOpened >= period.start.getTime())
        .sort((a, b) => b.lastOpened - a.lastOpened),
    [recent, period]
  )
  const openedKey = opened.map((repo) => repo.path).join('\0')
  const [rows, setRowsState] = useState<RepoActivity[] | null>(() => activityMemo.rows)
  const setRows = (next: RepoActivity[] | null | ((prev: RepoActivity[] | null) => RepoActivity[] | null)) =>
    setRowsState((prev) => {
      const value = typeof next === 'function' ? next(prev) : next
      activityMemo.rows = value
      return value
    })
  const [pending, setPending] = useState<string[]>([])
  const [hover, setHover] = useState<string | null>(null)
  const [picked, setPicked] = useState<string | null>(null)
  const loaded = useRef({ key: '', span: 0 })
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const paths = openedKey ? openedKey.split('\0') : []
    const spanDays = Math.max(period.days, HISTORY_DAYS) + 7
    if (!paths.length) {
      setRows([])
      setPending([])
      loaded.current = { key: '', span: 0 }
      return
    }
    if (loaded.current.key === openedKey && loaded.current.span >= spanDays) return
    let cancel = false
    const requestId = `${Date.now()}-${Math.random().toString(36).slice(2)}`
    const sameRepos = loaded.current.key === openedKey || activityMemo.key === openedKey
    if (!sameRepos) setRows([])
    let settled = false
    const slow = window.setTimeout(() => {
      if (!cancel && !settled) setPending(paths)
    }, 220)
    const off = window.spoon.app.on('repo:activity-progress', (info) => {
      const event = info as ActivityProgress
      if (cancel || event.requestId !== requestId) return
      if (event.reset) {
        setRows([])
        setPending(paths)
        return
      }
      setRows((current) => {
        const next = (current ?? []).filter((row) => row.path !== event.path)
        next.push({ path: event.path, days: event.days })
        return next
      })
      setPending((current) => current.filter((path) => path !== event.path))
    })
    void window.spoon.repo
      .activity(paths, requestId, spanDays)
      .then((result) => {
        if (cancel) return
        const report = result as ActivityReport
        setRows(report.rows)
        setPending([])
        loaded.current = { key: openedKey, span: spanDays }
        activityMemo.key = openedKey
      })
      .catch(() => {
        if (!cancel) setPending([])
      })
      .finally(() => {
        settled = true
        window.clearTimeout(slow)
      })
    return () => {
      cancel = true
      window.clearTimeout(slow)
      off()
    }
  }, [openedKey, period.days])

  const names = useMemo(() => new Map(recent.map((repo) => [repo.path, repo.name])), [recent])
  const byDay = useMemo(() => {
    const map = new Map<string, DayStat>()
    const grouped = new Map<string, Map<string, number>>()
    for (const row of rows ?? []) {
      for (const [key, count] of Object.entries(row.days)) {
        if (!count) continue
        const repos = grouped.get(key) ?? new Map<string, number>()
        repos.set(row.path, (repos.get(row.path) ?? 0) + count)
        grouped.set(key, repos)
      }
    }
    for (const [key, repos] of grouped) {
      const list = [...repos.entries()].map(([path, count]) => ({
        path,
        name: names.get(path) || path.split(/[/\\]/).pop() || path,
        count
      }))
      list.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
      map.set(key, { count: list.reduce((sum, repo) => sum + repo.count, 0), repos: list })
    }
    return map
  }, [rows, names])

  const covered = useMemo(() => statsBetween(byDay, period.start, period.end), [byDay, period])
  const history = useMemo(() => statsBetween(byDay, historyStart, today), [byDay, historyStart, today])
  const daysByPath = useMemo(() => new Map((rows ?? []).map((row) => [row.path, row.days])), [rows])
  const bucketStats = useMemo(() => {
    const map = new Map<string, DayStat>()
    for (const bucket of buckets) map.set(bucket.key, statsBetween(byDay, bucket.from, bucket.to))
    return map
  }, [buckets, byDay])
  const maxBucket = Math.max(0, ...[...bucketStats.values()].map((stat) => stat.count))

  const loading = pending.length > 0
  const focusKey = hover ?? picked
  const focusStat = focusKey ? (scale === 'day' ? byDay.get(focusKey) : bucketStats.get(focusKey)) : undefined
  const focusBucket = buckets.find((bucket) => bucket.key === focusKey)
  const currentName = pending.length ? names.get(pending[0]) : undefined
  const summary = !opened.length
    ? `Open a repository and ${range} will show up here.`
    : loading
      ? `Reading ${currentName || 'repositories'}… ${opened.length - pending.length} of ${opened.length}`
      : focusKey
        ? `${noun(focusStat?.count ?? 0)} ${scale === 'day' ? `on ${prettyDay(focusKey)}` : `in ${focusBucket?.title ?? focusKey}`}`
        : scale === 'day'
          ? `${noun(history.count)} in the last year`
          : `${noun(covered.count)} in ${range}`

  const shown = useMemo(() => {
    if (!picked) return opened
    const stat = scale === 'day' ? byDay.get(picked) : bucketStats.get(picked)
    const rank = new Map((stat?.repos ?? []).map((repo, index) => [repo.path, index]))
    return opened.filter((repo) => rank.has(repo.path)).sort((a, b) => (rank.get(a.path) ?? 0) - (rank.get(b.path) ?? 0))
  }, [picked, opened, byDay, bucketStats, scale])
  const pendingSet = useMemo(() => new Set(pending), [pending])

  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = 0
  }, [openedKey])

  function chooseScale(next: ContributionScale) {
    setScale(next)
    setPicked(null)
    setHover(null)
  }

  return (
    <section className="home-card recent-work" aria-label="Recent activity" aria-busy={loading}>
      <div className="home-card-head">
        <div className="home-card-title">
          <h2>Activity</h2>
          <p className="home-card-sub" aria-live="polite">{summary}</p>
        </div>
        <div className="recent-work-tools">
          {picked && (
            <Button variant="link" className="recent-clear" onClick={() => setPicked(null)}>
              Show all
            </Button>
          )}
          <div className="home-seg span-switch" role="group" aria-label="Group contributions">
            {CONTRIBUTION_SCALES.map((item) => (
              <Button
                key={item.id}
                variant="segment"
                className={scale === item.id ? 'on' : ''}
                aria-pressed={scale === item.id}
                onClick={() => chooseScale(item.id)}
              >
                {item.label}
              </Button>
            ))}
          </div>
        </div>
      </div>
      {loading && (
        <div
          className="work-bar"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={opened.length}
          aria-valuenow={opened.length - pending.length}
        >
          <i style={{ width: `${opened.length ? ((opened.length - pending.length) / opened.length) * 100 : 0}%` }} />
        </div>
      )}
      <div className="recent-graph">
        {scale === 'day' ? (
          <DayGrid
            weeks={weeks}
            months={months}
            today={today}
            start={historyStart}
            byDay={byDay}
            picked={picked}
            onHover={setHover}
            onPick={setPicked}
          />
        ) : (
          <BucketRow
            buckets={buckets}
            stats={bucketStats}
            max={maxBucket}
            picked={picked}
            onHover={setHover}
            onPick={setPicked}
          />
        )}
        <div className="contrib-foot">
          <span className="contrib-legend" aria-hidden="true">
            <span>Less</span>
            {[0, 1, 2, 3, 4].map((level) => (
              <i key={level} className={`contrib-day lv-${level}`} />
            ))}
            <span>More</span>
          </span>
        </div>
      </div>
      {shown.length > 0 && (
        <>
          <div className="recent-list-head">
            <span>{picked ? 'Active in this period' : 'Recently opened'}</span>
            <span className="counter">{shown.length}</span>
          </div>
          <div className="recent-repos" ref={listRef} role="list">
            {shown.map((repo) => {
              const working = pendingSet.has(repo.path)
              const overview = overviews[repo.path]
              const local = !overview || overview.exists
              const branch = overview?.branch ? (overview.detached ? 'detached HEAD' : overview.branch) : ''
              return (
                <div
                  key={repo.path}
                  role="listitem"
                  className={`recent-card${working ? ' working' : ''}${selected === repo.path ? ' active' : ''}`}
                  aria-busy={working}
                  onClick={() => onSelect?.(repo.path)}
                  onDoubleClick={() => (local ? onOpen(repo.path, repo.name) : undefined)}
                >
                  <span className="repo-mark sm" aria-hidden style={{ background: avatarColor(repo.path) }}>
                    {initials(repo.name.replace(/[-_]+/g, ' '))}
                  </span>
                  <div className="recent-main">
                    <div className="repo-name-row">
                      <h3 title={repo.path}>{repo.name}</h3>
                      <RecentBadges overview={overview} analyzing={analyzing?.has(repo.path)} />
                    </div>
                    <div className="recent-meta">
                      {branch && (
                        <span className="branch-pill" title={overview?.branch}>
                          <IcoBranch />
                          {branch}
                        </span>
                      )}
                      {overview?.lastCommit && (
                        <span className="last-commit" title={overview.lastCommit.subject}>
                          {overview.lastCommit.subject}
                        </span>
                      )}
                    </div>
                  </div>
                  <DayStrip weeks={sparkWeeks} today={today} days={daysByPath.get(repo.path)} />
                  <span className="opened">{repo.lastOpened ? formatAgo(repo.lastOpened) : 'never'}</span>
                  <Button
                    variant={local ? 'secondary' : 'secondary'}
                    className="recent-go"
                    aria-label={local ? `Open ${repo.name}` : `Clone ${repo.name}`}
                    title={local ? 'Open in Spoon' : 'Clone'}
                    onClick={(event) => {
                      event.stopPropagation()
                      if (local) onOpen(repo.path, repo.name)
                      else onClone()
                    }}
                  >
                    {local ? <IcoHome /> : <IcoClone />}
                    {local ? 'Open' : 'Clone'}
                  </Button>
                </div>
              )
            })}
          </div>
        </>
      )}
      {picked && opened.length > 0 && !shown.length && !loading && (
        <p className="recent-empty">No commits in these repositories for that period.</p>
      )}
    </section>
  )
}

function DayGrid({
  weeks,
  months,
  today,
  start,
  byDay,
  picked,
  onHover,
  onPick
}: {
  weeks: Date[][]
  months: (string | null)[]
  today: Date
  start: Date
  byDay: Map<string, DayStat>
  picked: string | null
  onHover: (key: string | null) => void
  onPick: (key: string | null) => void
}) {
  const style = { '--weeks': weeks.length } as CSSProperties
  return (
    <div className="contrib-scroll">
      <div className="contrib-board" style={style} onMouseLeave={() => onHover(null)}>
        {months.map((label, index) =>
          label ? (
            <span key={index} className="contrib-month" style={{ gridColumn: index + 2 }}>
              {label}
            </span>
          ) : null
        )}
        {DOW.map((label, index) =>
          label ? (
            <span key={label} className="contrib-dow" style={{ gridRow: index + 2 }}>
              {label}
            </span>
          ) : null
        )}
        {weeks.map((week, weekIndex) =>
          week.map((date, dayIndex) => {
            const key = dayKey(date)
            const place = { gridColumn: weekIndex + 2, gridRow: dayIndex + 2 }
            if (date.getTime() > today.getTime() || date.getTime() < start.getTime()) {
              return <span key={key} className="contrib-day pad" style={place} />
            }
            const count = byDay.get(key)?.count ?? 0
            const label = `${noun(count)} on ${prettyDay(key)}`
            return (
              <button
                key={key}
                type="button"
                className={`contrib-day lv-${contributionLevel(count)}${picked === key ? ' on' : ''}`}
                style={place}
                aria-label={label}
                aria-pressed={picked === key}
                tabIndex={-1}
                title={label}
                onMouseEnter={() => onHover(key)}
                onFocus={() => onHover(key)}
                onBlur={() => onHover(null)}
                onClick={() => onPick(picked === key ? null : key)}
              />
            )
          })
        )}
      </div>
    </div>
  )
}

function DayStrip({ weeks, today, days }: { weeks: Date[][]; today: Date; days?: Record<string, number> }) {
  return (
    <div className="day-strip">
      {weeks.map((week, weekIndex) => (
        <div className="contrib-week" key={weekIndex}>
          {week.map((date) => {
            const key = dayKey(date)
            if (date.getTime() > today.getTime()) return <span key={key} className="contrib-day pad" />
            const count = days?.[key] ?? 0
            const label = `${noun(count)} on ${prettyDay(key)}`
            return <span key={key} className={`contrib-day lv-${contributionLevel(count)}`} title={label} />
          })}
        </div>
      ))}
    </div>
  )
}

function RecentBadges({ overview, analyzing }: { overview?: RepoOverview; analyzing?: boolean }) {
  if (!overview) {
    return (
      <span className="badges">
        <span className={`chip${analyzing ? ' working' : ''}`}>{analyzing ? 'Analyzing...' : 'Waiting...'}</span>
      </span>
    )
  }
  const bits: { key: string; label: string; cls: string }[] = []
  if (!overview.exists) bits.push({ key: 'miss', label: 'not local', cls: 'err' })
  else if (overview.unsafe) bits.push({ key: 'unsafe', label: 'unsafe', cls: 'err' })
  else if (overview.error) bits.push({ key: 'err', label: 'error', cls: 'err' })
  if (overview.operation) bits.push({ key: 'op', label: overview.operation, cls: 'warn' })
  if (overview.conflicts) bits.push({ key: 'c', label: `${overview.conflicts} conflict`, cls: 'err' })
  const dirty = overview.staged + overview.unstaged + overview.untracked
  if (dirty) bits.push({ key: 'd', label: `${dirty} changed`, cls: 'warn' })
  if (overview.behind) bits.push({ key: 'b', label: `${overview.behind} behind`, cls: 'info' })
  if (overview.ahead) bits.push({ key: 'a', label: `${overview.ahead} ahead`, cls: 'info' })
  if (!bits.length) bits.push({ key: 'ok', label: 'clean', cls: 'ok' })
  return (
    <span className="badges">
      {bits.map((bit) => (
        <span key={bit.key} className={`chip ${bit.cls}`}>
          {bit.label}
        </span>
      ))}
    </span>
  )
}

function BucketRow({
  buckets,
  stats,
  max,
  picked,
  onHover,
  onPick
}: {
  buckets: ContributionBucket[]
  stats: Map<string, DayStat>
  max: number
  picked: string | null
  onHover: (key: string | null) => void
  onPick: (key: string | null) => void
}) {
  return (
    <div className="contrib-buckets wide" onMouseLeave={() => onHover(null)}>
      {buckets.map((bucket) => {
        const count = stats.get(bucket.key)?.count ?? 0
        const label = `${noun(count)} in ${bucket.title}`
        return (
          <button
            key={bucket.key}
            type="button"
            className={`contrib-bucket${picked === bucket.key ? ' on' : ''}`}
            aria-label={label}
            aria-pressed={picked === bucket.key}
            title={label}
            onMouseEnter={() => onHover(bucket.key)}
            onFocus={() => onHover(bucket.key)}
            onBlur={() => onHover(null)}
            onClick={() => onPick(picked === bucket.key ? null : bucket.key)}
          >
            <i className={`lv-${shade(count, max)}`} />
            <span>{bucket.label}</span>
          </button>
        )
      })}
    </div>
  )
}
