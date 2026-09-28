import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import type { BulkResult, RepoHealth, RepoIssue, RepoOverview, RepoSort, RepoSummary, Settings } from '../../shared/types'
import { bindDrag, clamp, catchErr, formatAgo } from './lib'

type Props = {
  recent: RepoSummary[]
  settings: Settings | null
  width: number
  onResize: (width: number) => void
  onResizeEnd: (width: number) => void
  onOpen: (path: string, name?: string) => void
  onClone: () => void
  onInit: () => void
  onAdd: () => void
  onRecent: (recent: RepoSummary[]) => void
  onSettings: (patch: Partial<Settings>) => Promise<void>
}

export function RepoHome({
  recent,
  settings,
  width,
  onResize,
  onResizeEnd,
  onOpen,
  onClone,
  onInit,
  onAdd,
  onRecent,
  onSettings
}: Props) {
  const [sel, setSel] = useState(recent[0]?.path)
  const [q, setQ] = useState('')
  const [scan, setScan] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [overviews, setOverviews] = useState<Record<string, RepoOverview>>({})
  const [analyzing, setAnalyzing] = useState<Set<string>>(() => new Set())
  const [health, setHealth] = useState<RepoHealth | null>(null)
  const [bulk, setBulk] = useState<BulkResult[] | null>(null)
  const [picked, setPicked] = useState<string[]>([])
  const [anchor, setAnchor] = useState<string | null>(null)
  const pinned = settings?.pinned ?? []
  const sort = settings?.repoSort ?? 'opened'
  const overviewGen = useRef(0)

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase()
    const list = query
      ? recent.filter((r) => r.name.toLowerCase().includes(query) || r.path.toLowerCase().includes(query))
      : recent
    return [...list].sort((a, b) => {
      const ap = pinned.includes(a.path) ? 0 : 1
      const bp = pinned.includes(b.path) ? 0 : 1
      if (ap !== bp) return ap - bp
      return compareRepos(a, b, sort, overviews)
    })
  }, [recent, q, pinned, overviews, sort])

  const current = recent.find((r) => r.path === sel)
  const overview = sel ? overviews[sel] : undefined

  const markAnalyzing = useCallback((paths: string[], on: boolean) => {
    setAnalyzing((prev) => {
      const next = new Set(prev)
      for (const path of paths) {
        if (on) next.add(path)
        else next.delete(path)
      }
      return next
    })
  }, [])

  const refreshOverviews = useCallback(async (paths = recent.map((r) => r.path)) => {
    const gen = ++overviewGen.current
    if (!paths.length) {
      if (gen === overviewGen.current) {
        setOverviews({})
        setAnalyzing(new Set())
      }
      return
    }
    markAnalyzing(paths, true)
    const chunk = 40
    for (let i = 0; i < paths.length; i += chunk) {
      if (gen !== overviewGen.current) return
      const slice = paths.slice(i, i + chunk)
      const rows = (await window.spoon.repo.overview(slice)) as RepoOverview[]
      if (gen !== overviewGen.current) return
      setOverviews((prev) => {
        const next = { ...prev }
        for (const row of rows) next[row.path] = row
        return next
      })
      markAnalyzing(slice, false)
    }
  }, [markAnalyzing, recent])

  useEffect(() => {
    void refreshOverviews()
  }, [recent.map((r) => r.path).join('\n')])

  useEffect(() => {
    const onScan = () => void scanFolders()
    document.addEventListener('spoon-scan', onScan)
    return () => document.removeEventListener('spoon-scan', onScan)
  }, [settings?.watchedRoots])

  useEffect(() => {
    if (!sel) {
      setHealth(null)
      return
    }
    let cancel = false
    void window.spoon.repo.health(sel, false).then((h) => {
      if (!cancel) setHealth(h as RepoHealth)
    })
    return () => {
      cancel = true
    }
  }, [sel, overview?.checkedAt])

  async function scanFolders() {
    const dirs = (await window.spoon.app.pickDirectories()) as string[] | null
    if (!dirs?.length) return
    setScan(`Scanning ${dirs.length} folder${dirs.length === 1 ? '' : 's'}...`)
    const off = window.spoon.app.on('scan:progress', (info) => {
      const p = info as { found?: number; looking?: string }
      setScan(`Found ${p.found ?? 0}... ${p.looking ?? ''}`)
    })
    try {
      const found = (await window.spoon.git.scan(dirs)) as { path: string; name: string }[]
      const next = (await window.spoon.app.addRepos(found)) as RepoSummary[]
      onRecent(next)
      const roots = [...new Set([...(settings?.watchedRoots ?? []), ...dirs])]
      await onSettings({ watchedRoots: roots })
      if (found[0]) setSel(found[0].path)
      setScan(
        found.length
          ? `Added ${found.length} repositor${found.length === 1 ? 'y' : 'ies'}.`
          : 'No Git repositories in those folders.'
      )
    } catch (e) {
      setScan(e instanceof Error ? e.message : String(e))
    } finally {
      off()
    }
  }

  async function rescan() {
    setBusy('rescan')
    markAnalyzing(recent.map((r) => r.path), true)
    try {
      const next = (await window.spoon.repo.rescan()) as RepoSummary[]
      onRecent(next)
      setScan(next.length ? `Watching ${next.length} repositories.` : 'Scan a folder first.')
      await refreshOverviews(next.map((r) => r.path))
    } catch (e) {
      markAnalyzing(recent.map((r) => r.path), false)
      await window.spoon.app.error(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  async function runBulk(action: 'fetch' | 'pull' | 'push' | 'refresh') {
    const paths = (picked.length ? filtered.filter((r) => picked.includes(r.path)) : filtered).map((r) => r.path)
    if (!paths.length) return
    setBusy(action)
    setBulk(null)
    if (action === 'refresh' || action === 'fetch') markAnalyzing(paths, true)
    try {
      const results = (await window.spoon.repo.bulk(action, paths)) as BulkResult[]
      setBulk(results)
      await refreshOverviews(paths)
      if (sel) {
        const h = (await window.spoon.repo.health(sel, false)) as RepoHealth
        setHealth(h)
      }
    } catch (e) {
      markAnalyzing(paths, false)
      await window.spoon.app.error(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  async function togglePin(path: string) {
    const next = pinned.includes(path) ? pinned.filter((p) => p !== path) : [path, ...pinned]
    await onSettings({ pinned: next })
  }

  async function removeRepo(path: string) {
    const ok = await window.spoon.app.confirm('Remove this repository from the list?', path)
    if (!ok) return
    const next = (await window.spoon.app.removeRecent(path)) as RepoSummary[]
    onRecent(next)
    setPicked((xs) => xs.filter((p) => p !== path))
    if (sel === path) setSel(next[0]?.path)
  }

  async function removePicked() {
    const paths = picked.length ? picked : sel ? [sel] : []
    if (!paths.length) return
    const ok = await window.spoon.app.confirm(
      `Remove ${paths.length} repositor${paths.length === 1 ? 'y' : 'ies'} from the list?`,
      'This does not delete files on disk.'
    )
    if (!ok) return
    let next = recent
    for (const path of paths) next = (await window.spoon.app.removeRecent(path)) as RepoSummary[]
    onRecent(next)
    setPicked([])
    setSel(next[0]?.path)
  }

  async function pinPicked(on: boolean) {
    const paths = picked.length ? picked : sel ? [sel] : []
    const set = new Set(pinned)
    for (const path of paths) {
      if (on) set.add(path)
      else set.delete(path)
    }
    await onSettings({ pinned: [...set] })
  }

  function clickRepo(event: MouseEvent, path: string) {
    const index = filtered.findIndex((r) => r.path === path)
    if (event.shiftKey) {
      const fromPath = anchor ?? sel ?? filtered[0]?.path
      const from = filtered.findIndex((r) => r.path === fromPath)
      if (from >= 0 && index >= 0) {
        const [a, b] = from < index ? [from, index] : [index, from]
        setPicked(filtered.slice(a, b + 1).map((r) => r.path))
      } else {
        setPicked([path])
      }
      setSel(path)
      return
    }
    setSel(path)
    setPicked([])
    setAnchor(path)
  }

  const counts = useMemo(() => summarize(overviews, recent), [overviews, recent])
  const actionCount = picked.length || filtered.length
  const actionHint = picked.length ? `${picked.length} selected` : `all ${filtered.length}`
  const many = picked.length > 1
  const unsafePicked = picked.filter((path) => overviews[path]?.unsafe)

  async function markSafe(paths: string[]) {
    const targets = paths.filter((path) => overviews[path]?.unsafe)
    if (!targets.length) return
    setBusy('safe')
    setBulk(null)
    try {
      const results: BulkResult[] = []
      for (const path of targets) {
        const name = recent.find((r) => r.path === path)?.name ?? path
        try {
          await window.spoon.repo.fix(path, 'safe-directory')
          results.push({ path, name, ok: true, message: 'Trusted' })
        } catch (e) {
          results.push({
            path,
            name,
            ok: false,
            message: e instanceof Error ? e.message.split('\n')[0] : String(e)
          })
        }
      }
      setBulk(results)
      await refreshOverviews(targets)
      if (sel) {
        setHealth((await window.spoon.repo.health(sel, false)) as RepoHealth)
      }
    } finally {
      setBusy(null)
    }
  }

  async function applyFix(path: string, id: string) {
    await catchErr(async () => {
      if (id === 'set-identity') {
        const name = window.prompt('Git user.name')
        if (!name?.trim()) return
        const email = window.prompt('Git user.email')
        if (!email?.trim()) return
        await window.spoon.repo.fix(path, id, { name: name.trim(), email: email.trim() })
      } else {
        await window.spoon.repo.fix(path, id)
      }
      await refreshOverviews([path])
      setHealth((await window.spoon.repo.health(path, false)) as RepoHealth)
    })
  }

  async function autoFix(path: string, issues: RepoIssue[]) {
    const safe = issues.filter((i) => i.fix && !i.fix.destructive && i.fix.id !== 'set-identity')
    for (const issue of safe) {
      await catchErr(async () => {
        await window.spoon.repo.fix(path, issue.fix!.id)
      })
    }
    await refreshOverviews([path])
    setHealth((await window.spoon.repo.health(path, false)) as RepoHealth)
  }

  return (
    <div className="manager">
      <div className="mgr-side" style={{ width }}>
        <div className="side-filter">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Filter repositories..."
            aria-label="Filter repositories"
          />
          <select
            className="sort-select"
            value={sort}
            aria-label="Sort repositories"
            onChange={(e) => void onSettings({ repoSort: e.target.value as RepoSort })}
          >
            <option value="opened">Last opened</option>
            <option value="name">Name</option>
            <option value="changes">With changes</option>
            <option value="behind">Behind remote</option>
            <option value="ahead">To push</option>
            <option value="status">Needs attention</option>
          </select>
        </div>
        <div className="side-sec">
          Repositories
          <span className="counter">{filtered.length}</span>
          <button
            className="ghost tiny"
            title="Select all visible"
            onClick={() => setPicked(filtered.map((r) => r.path))}
          >
            all
          </button>
          {picked.length > 0 && (
            <button className="ghost tiny" title="Clear selection" onClick={() => setPicked([])}>
              none
            </button>
          )}
        </div>
        {filtered.map((r) => {
          const o = overviews[r.path]
          const on = picked.includes(r.path)
          const checking = analyzing.has(r.path) || !o
          return (
            <div
              key={r.path}
              className={`side-item repo-row ${sel === r.path ? 'active' : ''} ${on ? 'picked' : ''}`}
              onClick={(e) => clickRepo(e, r.path)}
              onDoubleClick={() => onOpen(r.path, r.name)}
            >
              <span
                className={`dot ${dotTone(o)}${pinned.includes(r.path) ? ' pin' : ''}`}
                title={checking ? 'Analyzing...' : dotTitle(o, pinned.includes(r.path))}
              />
              <span className="label">{r.name}</span>
              <RepoBadges overview={o} compact analyzing={checking} />
            </div>
          )
        })}
        {!filtered.length && <div className="empty">{recent.length ? 'No matches.' : 'No repositories yet'}</div>}
      </div>
      <div
        className="splitbar x"
        onPointerDown={(e) =>
          bindDrag(
            e,
            'x',
            (x) => onResize(clamp(x, 180, 480)),
            (x) => onResizeEnd(clamp(x, 180, 480))
          )
        }
      />
      <div className="mgr-main">
        <div className="mgr-hero">
          <div className="spoon-mark" aria-hidden>
            <SpoonMark />
          </div>
          <div>
            <h1>Repository Manager</h1>
            <p className="hero-sub">Scan, refresh, repair, and open every Git repo on this machine.</p>
          </div>
        </div>

        <div className="stat-row">
          <span>
            <b>{counts.total}</b> repos
          </span>
          <span>
            <b>{counts.dirty}</b> dirty
          </span>
          <span>
            <b>{counts.behind}</b> behind
          </span>
          <span>
            <b>{counts.ahead}</b> to push
          </span>
          <span>
            <b>{counts.broken}</b> blocked
          </span>
        </div>

        <div className="mgr-actions">
          <button className="primary" onClick={onClone}>
            Clone
          </button>
          <button className="ghost" onClick={onAdd}>
            Add existing
          </button>
          <button className="ghost" onClick={onInit}>
            Create new
          </button>
          <button className="ghost" onClick={() => void scanFolders()}>
            Scan folders
          </button>
          <button className="ghost" disabled={!settings?.watchedRoots?.length || !!busy} onClick={() => void rescan()}>
            Rescan
          </button>
          <button className="ghost" disabled={!!busy || !actionCount} onClick={() => void runBulk('refresh')}>
            {busy === 'refresh' ? 'Refreshing...' : `Refresh ${actionHint}`}
          </button>
          <button className="ghost" disabled={!!busy || !actionCount} onClick={() => void runBulk('fetch')}>
            {busy === 'fetch' ? 'Fetching...' : `Fetch ${actionHint}`}
          </button>
          <button className="ghost" disabled={!!busy || !actionCount} onClick={() => void runBulk('pull')}>
            {busy === 'pull' ? 'Pulling...' : `Pull ${actionHint}`}
          </button>
          <button className="ghost" disabled={!!busy || !actionCount} onClick={() => void runBulk('push')}>
            {busy === 'push' ? 'Pushing...' : `Push ${actionHint}`}
          </button>
        </div>
        {scan ? (
          <p className="hint" title={scan}>
            {scan}
          </p>
        ) : null}

        {bulk && <BulkSummary results={bulk} onClear={() => setBulk(null)} />}

        {many ? (
          <div className="repo-card pop-in">
            <div className="repo-card-top">
              <div>
                <h2>{picked.length} repositories selected</h2>
                <div className="hint">Shift-click a range to fetch, pull, pin, mark as safe, or remove only those repos.</div>
              </div>
            </div>
            <div className="row-btns">
              <button className="primary" disabled={!!busy} onClick={() => void runBulk('fetch')}>
                Fetch
              </button>
              <button className="ghost" disabled={!!busy} onClick={() => void runBulk('pull')}>
                Pull
              </button>
              <button className="ghost" disabled={!!busy} onClick={() => void runBulk('push')}>
                Push
              </button>
              <button className="ghost" disabled={!!busy} onClick={() => void runBulk('refresh')}>
                Refresh
              </button>
              {unsafePicked.length > 0 && (
                <button
                  className="ghost"
                  disabled={!!busy}
                  onClick={() => void markSafe(unsafePicked)}
                >
                  {busy === 'safe'
                    ? 'Trusting...'
                    : `Mark ${unsafePicked.length} as safe`}
                </button>
              )}
              <button className="ghost" onClick={() => void pinPicked(true)}>
                Pin
              </button>
              <button className="ghost" onClick={() => void pinPicked(false)}>
                Unpin
              </button>
              <button className="ghost" onClick={() => void removePicked()}>
                Remove
              </button>
            </div>
            <ul className="picked-list">
              {picked.map((path) => {
                const repo = recent.find((r) => r.path === path)
                const checking = analyzing.has(path) || !overviews[path]
                return (
                  <li key={path}>
                    <button className="linkish" onClick={() => setSel(path)}>
                      {repo?.name ?? path}
                    </button>
                    <RepoBadges overview={overviews[path]} compact analyzing={checking} />
                  </li>
                )
              })}
            </ul>
          </div>
        ) : current ? (
          <div className="repo-card pop-in">
            <div className="repo-card-top">
              <div>
                <h2>{current.name}</h2>
                <div className="hint path">{current.path}</div>
              </div>
              <RepoBadges overview={overview} analyzing={analyzing.has(current.path) || !overview} />
            </div>
            <div className="stat-row tight">
              <span>{overview?.branch ? (overview.detached ? 'detached HEAD' : overview.branch) : '...'}</span>
              {overview?.lastCommit && <span>{overview.lastCommit.subject}</span>}
              <span>Opened {current.lastOpened ? formatAgo(current.lastOpened) : 'never'}</span>
            </div>
            {(analyzing.has(current.path) || !overview) && (
              <p className="hint">{overview ? 'Refreshing repository status...' : 'Analyzing...'}</p>
            )}
            {overview?.error && <div className="banner warn">{overview.error}</div>}
            <div className="row-btns">
              <button className="primary" onClick={() => onOpen(current.path, current.name)}>
                Open
              </button>
              <button className="ghost" onClick={() => void window.spoon.app.openIn(current.path, 'editor')}>
                Editor
              </button>
              <button className="ghost" onClick={() => void window.spoon.app.openIn(current.path, 'terminal')}>
                Terminal
              </button>
              <button className="ghost" onClick={() => void window.spoon.app.openIn(current.path, 'explorer')}>
                Explorer
              </button>
              <button className="ghost" onClick={() => void togglePin(current.path)}>
                {pinned.includes(current.path) ? 'Unpin' : 'Pin'}
              </button>
              <button className="ghost" onClick={() => void removeRepo(current.path)}>
                Remove
              </button>
            </div>
            <HealthList
              health={health}
              onFix={(id) => void applyFix(current.path, id)}
              onFixSafe={() => health && void autoFix(current.path, health.issues)}
              onDeep={async () => {
                setHealth((await window.spoon.repo.health(current.path, true)) as RepoHealth)
              }}
            />
          </div>
        ) : (
          <div className="empty-hero pop-in">
            <SpoonMark />
            <p>Clone, add, scan folders, or create a repository to get started.</p>
          </div>
        )}
      </div>
    </div>
  )
}

function HealthList({
  health,
  onFix,
  onFixSafe,
  onDeep
}: {
  health: RepoHealth | null
  onFix: (id: string) => void
  onFixSafe: () => void
  onDeep: () => void
}) {
  const issues = health?.issues ?? []
  const canAuto = issues.some((i) => i.fix && !i.fix.destructive && i.fix.id !== 'set-identity')
  return (
    <div className="health">
      <div className="health-head">
        <strong>Health</strong>
        <span className="hint">{issues.length ? `${issues.length} issue${issues.length === 1 ? '' : 's'}` : 'Looks good'}</span>
        <button className="ghost" onClick={onDeep}>
          Deep check
        </button>
        {canAuto && (
          <button className="ghost" onClick={onFixSafe}>
            Fix safe issues
          </button>
        )}
      </div>
      {!issues.length && <p className="hint">No problems detected. Deep check runs git fsck.</p>}
      {issues.map((issue) => (
        <div key={issue.id} className={`issue ${issue.severity}`}>
          <div>
            <b>{issue.title}</b>
            <p>{issue.detail}</p>
          </div>
          {issue.fix && (
            <button className={`ghost ${issue.fix.destructive ? 'danger' : ''}`} onClick={() => onFix(issue.fix!.id)}>
              {issue.fix.label}
            </button>
          )}
        </div>
      ))}
    </div>
  )
}

function BulkSummary({ results, onClear }: { results: BulkResult[]; onClear: () => void }) {
  const ok = results.filter((r) => r.ok && !r.skipped).length
  const skip = results.filter((r) => r.skipped).length
  const fail = results.filter((r) => !r.ok).length
  return (
    <div className="bulk-summary pop-in">
      <div>
        <b>
          {ok} done - {skip} skipped - {fail} failed
        </b>
      </div>
      <button className="ghost" onClick={onClear}>
        Dismiss
      </button>
      {fail > 0 && (
        <ul>
          {results
            .filter((r) => !r.ok)
            .slice(0, 8)
            .map((r) => (
              <li key={r.path}>
                {r.name}: {r.message}
              </li>
            ))}
        </ul>
      )}
    </div>
  )
}

function RepoBadges({
  overview,
  compact,
  analyzing
}: {
  overview?: RepoOverview
  compact?: boolean
  analyzing?: boolean
}) {
  if (!overview) {
    return compact ? (
      <span className="badges">
        <span className="chip">Analyzing...</span>
      </span>
    ) : (
      <span className="hint">Analyzing...</span>
    )
  }
  const bits: { key: string; label: string; cls: string }[] = []
  if (analyzing) bits.push({ key: 'scan', label: 'Analyzing...', cls: '' })
  if (overview.unsafe) bits.push({ key: 'unsafe', label: 'unsafe', cls: 'err' })
  else if (overview.error) bits.push({ key: 'err', label: 'error', cls: 'err' })
  if (overview.operation) bits.push({ key: 'op', label: overview.operation, cls: 'warn' })
  if (overview.conflicts) bits.push({ key: 'c', label: `${overview.conflicts} conflict`, cls: 'err' })
  const dirty = overview.staged + overview.unstaged + overview.untracked
  if (dirty) bits.push({ key: 'd', label: `${dirty} changed`, cls: 'warn' })
  if (overview.behind) bits.push({ key: 'b', label: `${overview.behind} behind`, cls: 'info' })
  if (overview.ahead) bits.push({ key: 'a', label: `${overview.ahead} ahead`, cls: 'info' })
  if (!bits.length && !compact) bits.push({ key: 'ok', label: 'clean', cls: 'ok' })
  if (!bits.length) return null
  return (
    <span className="badges">
      {bits.map((b) => (
        <span key={b.key} className={`chip ${b.cls}`.trim()}>
          {b.label}
        </span>
      ))}
    </span>
  )
}

function dotTone(o?: RepoOverview): string {
  if (!o) return ''
  if (o.unsafe || o.error || o.conflicts) return 'err'
  if (o.operation || o.staged + o.unstaged + o.untracked) return 'warn'
  if (o.behind || o.ahead) return 'info'
  return 'ok'
}

function dotTitle(o: RepoOverview | undefined, pinned: boolean): string {
  const bits: string[] = []
  if (pinned) bits.push('Pinned')
  if (!o) return bits.join(' · ') || 'Analyzing...'
  if (o.unsafe) bits.push('Git does not trust this folder')
  else if (o.error) bits.push(o.error)
  if (o.conflicts) bits.push(`${o.conflicts} conflict(s)`)
  const dirty = o.staged + o.unstaged + o.untracked
  if (dirty) bits.push(`${dirty} changed`)
  if (o.behind) bits.push(`${o.behind} behind`)
  if (o.ahead) bits.push(`${o.ahead} ahead`)
  if (!bits.length) bits.push('Clean')
  return bits.join(' · ')
}

function compareRepos(a: RepoSummary, b: RepoSummary, sort: RepoSort, overviews: Record<string, RepoOverview>): number {
  const ao = overviews[a.path]
  const bo = overviews[b.path]
  if (sort === 'name') return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
  if (sort === 'opened') return (b.lastOpened || 0) - (a.lastOpened || 0)
  if (sort === 'changes') return dirtyCount(bo) - dirtyCount(ao) || a.name.localeCompare(b.name)
  if (sort === 'behind') return (bo?.behind ?? -1) - (ao?.behind ?? -1) || a.name.localeCompare(b.name)
  if (sort === 'ahead') return (bo?.ahead ?? -1) - (ao?.ahead ?? -1) || a.name.localeCompare(b.name)
  return issueScore(ao) - issueScore(bo) || a.name.localeCompare(b.name)
}

function dirtyCount(o?: RepoOverview): number {
  if (!o) return -1
  return o.staged + o.unstaged + o.untracked + o.conflicts
}

function issueScore(o?: RepoOverview): number {
  if (!o) return 4
  if (o.error || o.unsafe || o.conflicts) return 0
  if (o.operation) return 1
  if (o.behind || o.ahead || o.staged + o.unstaged) return 2
  return 3
}

function summarize(overviews: Record<string, RepoOverview>, recent: RepoSummary[]) {
  let dirty = 0
  let behind = 0
  let ahead = 0
  let broken = 0
  for (const r of recent) {
    const o = overviews[r.path]
    if (!o) continue
    if (o.error || o.unsafe || o.conflicts) broken++
    if (o.staged + o.unstaged + o.untracked) dirty++
    if (o.behind) behind++
    if (o.ahead) ahead++
  }
  return { total: recent.length, dirty, behind, ahead, broken }
}

function SpoonMark() {
  return (
    <svg viewBox="0 0 24 24" className="spoon-svg" aria-hidden>
      <ellipse cx="8.2" cy="8.4" rx="4.4" ry="5.6" fill="currentColor" />
      <path
        d="M10.4 12.2c2.4 2.5 6.2 6.6 8.8 9.2"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.1"
        strokeLinecap="round"
      />
      <ellipse cx="7.4" cy="8.6" rx="2.2" ry="3.2" fill="none" stroke="var(--bg)" strokeWidth="1.4" opacity="0.55" />
    </svg>
  )
}

export function HealthDialog({
  path,
  onClose,
  onOpen
}: {
  path: string
  onClose: () => void
  onOpen?: (path: string) => void
}) {
  const [health, setHealth] = useState<RepoHealth | null>(null)

  async function load(deep = false) {
    setHealth((await window.spoon.repo.health(path, deep)) as RepoHealth)
  }

  useEffect(() => {
    void load(false)
  }, [path])

  return (
    <div className="dialog-back" onMouseDown={onClose}>
      <div className="dialog" onMouseDown={(e) => e.stopPropagation()}>
        <div className="dialog-head">
          <h2>Health check</h2>
        </div>
        <div className="dialog-body">
          <p className="hint">{path}</p>
          <HealthList
            health={health}
            onFix={async (id) => {
              await catchErr(async () => {
                if (id === 'set-identity') {
                  const name = window.prompt('Git user.name')
                  if (!name?.trim()) return
                  const email = window.prompt('Git user.email')
                  if (!email?.trim()) return
                  await window.spoon.repo.fix(path, id, { name: name.trim(), email: email.trim() })
                } else {
                  await window.spoon.repo.fix(path, id)
                }
                await load(false)
              })
            }}
            onFixSafe={async () => {
              const issues = health?.issues ?? []
              for (const issue of issues.filter((i) => i.fix && !i.fix.destructive && i.fix.id !== 'set-identity')) {
                await catchErr(async () => {
                  await window.spoon.repo.fix(path, issue.fix!.id)
                })
              }
              await load(false)
            }}
            onDeep={() => void load(true)}
          />
          <div className="dialog-foot">
            {onOpen && (
              <button className="ghost" onClick={() => onOpen(path)}>
                Open repo
              </button>
            )}
            <button className="primary" onClick={onClose}>
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
