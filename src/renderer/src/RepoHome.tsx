import { Button } from './Button'
import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from 'react'
import type { BulkResult, RepoHealth, RepoIssue, RepoOverview, RepoSort, RepoSummary, RepoWorkspace, Settings } from '../../shared/types'
import type { LauncherInfo } from '../../shared/launchers'
import {
  IcoAddRepo,
  IcoBranch,
  IcoChevron,
  IcoClone,
  IcoCode,
  IcoCreate,
  IcoDeep,
  IcoFetch,
  IcoHome,
  IcoOpen,
  IcoPin,
  IcoPull,
  IcoPush,
  IcoRefresh,
  IcoSave,
  IcoScan,
  IcoShield,
  IcoTrash,
  IcoUnpin,
  IcoWorkspaces,
  IcoWrench
} from './icons'
import { Pencil, Search, X } from 'lucide-react'
import { avatarColor, bindDrag, clamp, catchErr, formatAgo, initials, openMenu, openWithMenuItems } from './lib'
import { RecentWork } from './RecentWork'

/** Last known status per repository, kept across Home remounts so returning to Home paints instantly. */
let overviewMemo: Record<string, RepoOverview> = {}

type StatusFilter = 'all' | 'dirty' | 'behind' | 'ahead' | 'blocked'

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
  workspaces: RepoWorkspace[]
  onOpenWorkspace: (workspace: RepoWorkspace) => void
  onOpenSelection: (paths: string[]) => void
  onSaveWorkspace: (paths: string[]) => void
  onAddToWorkspace: (workspace: RepoWorkspace, paths: string[]) => void
  onDeleteWorkspace: (id: string) => void
  onEditWorkspace: (workspace: RepoWorkspace) => void
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
  workspaces,
  onOpenWorkspace,
  onOpenSelection,
  onSaveWorkspace,
  onAddToWorkspace,
  onDeleteWorkspace,
  onEditWorkspace,
  onSettings
}: Props) {
  const [sel, setSel] = useState(recent[0]?.path)
  const [q, setQ] = useState('')
  const [scan, setScan] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [overviews, setOverviewsState] = useState<Record<string, RepoOverview>>(() => ({ ...overviewMemo }))
  const setOverviews = useCallback((next: Record<string, RepoOverview> | ((prev: Record<string, RepoOverview>) => Record<string, RepoOverview>)) => {
    setOverviewsState((prev) => {
      const value = typeof next === 'function' ? next(prev) : next
      overviewMemo = value
      return value
    })
  }, [])
  const [analyzing, setAnalyzing] = useState<Set<string>>(() => new Set())
  const [health, setHealth] = useState<RepoHealth | null>(null)
  const [bulk, setBulk] = useState<BulkResult[] | null>(null)
  const [picked, setPicked] = useState<string[]>([])
  const [anchor, setAnchor] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [launchers, setLaunchers] = useState<LauncherInfo[]>([])
  const [defaultLauncher, setDefaultLauncher] = useState('cursor')
  const pinned = settings?.pinned ?? []
  const sort = settings?.repoSort ?? 'opened'

  useEffect(() => {
    void window.spoon.app.launchers().then((result: { launchers: LauncherInfo[]; defaultId: string }) => {
      setLaunchers(result.launchers)
      setDefaultLauncher(result.defaultId)
    })
  }, [settings?.defaultLauncher, settings?.editor])

  const defaultOpen = launchers.find((item) => item.id === defaultLauncher && item.available) ?? launchers.find((item) => item.available)
  const overviewGen = useRef(0)

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase()
    const list = recent.filter((r) => {
      if (query && !r.name.toLowerCase().includes(query) && !r.path.toLowerCase().includes(query)) return false
      return matchesStatus(overviews[r.path], statusFilter)
    })
    return [...list].sort((a, b) => {
      const ap = pinned.includes(a.path) ? 0 : 1
      const bp = pinned.includes(b.path) ? 0 : 1
      if (ap !== bp) return ap - bp
      return compareRepos(a, b, sort, overviews)
    })
  }, [recent, q, pinned, overviews, sort, statusFilter])

  const current = recent.find((r) => r.path === sel)
  const overview = sel ? overviews[sel] : undefined

  useEffect(() => {
    if (!recent.some((repo) => repo.path === sel)) setSel(recent[0]?.path)
  }, [recent, sel])

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

  const refreshOverviews = useCallback(async (paths = recent.map((r) => r.path), force = false) => {
    const gen = ++overviewGen.current
    if (!paths.length) {
      if (gen === overviewGen.current) {
        setOverviews({})
        setAnalyzing(new Set())
      }
      return
    }
    const slow = window.setTimeout(() => {
      if (gen === overviewGen.current) markAnalyzing(paths, true)
    }, force ? 0 : 220)
    const chunk = 40
    try {
      for (let i = 0; i < paths.length; i += chunk) {
        if (gen !== overviewGen.current) return
        const slice = paths.slice(i, i + chunk)
        const rows = (await window.spoon.repo.overview(slice, force)) as RepoOverview[]
        if (gen !== overviewGen.current) return
        setOverviews((prev) => {
          const next = { ...prev }
          for (const row of rows) next[row.path] = row
          return next
        })
        markAnalyzing(slice, false)
      }
    } finally {
      window.clearTimeout(slow)
      if (gen === overviewGen.current) markAnalyzing(paths, false)
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

  async function runBulk(action: 'fetch' | 'pull' | 'push' | 'refresh', explicit?: string[]) {
    const paths = explicit ?? (picked.length ? filtered.filter((r) => picked.includes(r.path)) : filtered).map((r) => r.path)
    if (!paths.length) return
    setBusy(action)
    setBulk(null)
    if (action === 'refresh' || action === 'fetch') markAnalyzing(paths, true)
    try {
      const results = (await window.spoon.repo.bulk(action, paths)) as BulkResult[]
      setBulk(results)
      await refreshOverviews(paths, action === 'refresh')
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

  function targetPaths(path: string): string[] {
    return picked.includes(path) && picked.length > 1 ? picked : [path]
  }

  function openRepoMenu(path: string) {
    const paths = targetPaths(path)
    if (!paths.includes(path) || paths.length === 1) {
      setSel(path)
      setAnchor(path)
      if (!picked.includes(path)) setPicked([])
    } else {
      setSel(path)
    }
    const one = paths.length === 1
    const repo = recent.find((item) => item.path === path)
    const anyPinned = paths.some((item) => pinned.includes(item))
    const allPinned = paths.every((item) => pinned.includes(item))
    const unsafe = paths.filter((item) => overviews[item]?.unsafe)
    const items: object[] = []
    if (one) {
      const openItems = openWithMenuItems(launchers, { defaultId: defaultLauncher })
      items.push(
        { id: 'open', label: 'Open in Spoon' },
        {
          label: 'Open with',
          submenu: openItems.length ? openItems : [{ label: 'No launchers found', enabled: false }]
        },
        { type: 'separator' }
      )
    }
    items.push(
      { id: 'fetch', label: 'Fetch' },
      { id: 'pull', label: 'Pull' },
      { id: 'push', label: 'Push' },
      { id: 'refresh', label: 'Refresh' },
      { type: 'separator' },
      { id: 'pin', label: 'Pin', enabled: !allPinned },
      { id: 'unpin', label: 'Unpin', enabled: anyPinned }
    )
    if (unsafe.length) items.push({ id: 'safe', label: 'Mark as safe' })
    items.push({ id: 'remove', label: 'Remove' }, { type: 'separator' })
    if (!one) items.push({ id: 'open-ws', label: 'Open workspace' })
    items.push({ id: 'new-ws', label: one ? 'New workspace' : 'Save workspace' })
    items.push({
      label: 'Add to workspace',
      submenu: workspaces.length
        ? workspaces.map((workspace) => ({
            id: `add:${workspace.id}`,
            label: workspace.name,
            enabled: paths.some((item) => !workspace.repos.some((repoPath) => repoPath.toLowerCase() === item.toLowerCase()))
          }))
        : [{ label: 'No saved workspaces', enabled: false }]
    })
    openMenu(items, (id) => {
      if (id === 'open' && repo) onOpen(repo.path, repo.name)
      if (id.startsWith('open:')) void window.spoon.app.openWith(path, id.slice(5))
      if (id === 'fetch' || id === 'pull' || id === 'push' || id === 'refresh') void runBulk(id, paths)
      if (id === 'pin') void pinPaths(paths, true)
      if (id === 'unpin') void pinPaths(paths, false)
      if (id === 'safe') void markSafe(unsafe)
      if (id === 'remove') void removePaths(paths)
      if (id === 'open-ws') onOpenSelection(paths)
      if (id === 'new-ws') onSaveWorkspace(paths)
      if (id.startsWith('add:')) {
        const workspace = workspaces.find((item) => item.id === id.slice(4))
        if (workspace) onAddToWorkspace(workspace, paths)
      }
    })
  }

  function openWithMenu(path: string) {
    const items = openWithMenuItems(launchers, { defaultId: defaultLauncher })
    if (!items.length) {
      void window.spoon.app.error('No editors, agents, or CLIs found on PATH.')
      return
    }
    openMenu(items, (id) => {
      if (id.startsWith('open:')) void window.spoon.app.openWith(path, id.slice(5))
    })
  }

  async function pinPaths(paths: string[], on: boolean) {
    const set = new Set(pinned)
    for (const path of paths) {
      if (on) set.add(path)
      else set.delete(path)
    }
    await onSettings({ pinned: [...set] })
  }

  async function removePaths(paths: string[]) {
    const ok = await window.spoon.app.confirm(
      paths.length === 1 ? 'Remove this repository from the list?' : `Remove ${paths.length} repositories from the list?`,
      paths.length === 1 ? paths[0] : 'This does not delete files on disk.'
    )
    if (!ok) return
    let next = recent
    for (const path of paths) next = (await window.spoon.app.removeRecent(path)) as RepoSummary[]
    onRecent(next)
    setPicked((xs) => xs.filter((item) => !paths.includes(item)))
    if (paths.includes(sel ?? '')) setSel(next[0]?.path)
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
    if (event.ctrlKey || event.metaKey) {
      setPicked((prev) => {
        const base = prev.length ? prev : sel && sel !== path ? [sel] : []
        return base.includes(path) ? base.filter((item) => item !== path) : [...base, path]
      })
      setSel(path)
      setAnchor(path)
      return
    }
    setSel(path)
    setPicked([])
    setAnchor(path)
  }

  function toggleFilter(id: StatusFilter) {
    setStatusFilter((prev) => (id === 'all' || prev === id ? 'all' : id))
    setPicked([])
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
      await refreshOverviews(targets, true)
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
      await refreshOverviews([path], true)
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
    await refreshOverviews([path], true)
    setHealth((await window.spoon.repo.health(path, false)) as RepoHealth)
  }

  const totalRepos = recent.length
  const greeting = homeGreeting()
  const attention = counts.broken
  const selectedPinned = current ? pinned.includes(current.path) : false

  return (
    <div className="manager home">
      <aside className="mgr-side home-side" style={{ width }} aria-label="Repositories">
        <div className="side-filter">
          <label className="home-search">
            <Search size={14} aria-hidden />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Filter repositories"
              aria-label="Filter repositories"
            />
            {q && (
              <Button variant="icon" className="home-search-clear" aria-label="Clear filter" onClick={() => setQ('')}>
                <X size={12} />
              </Button>
            )}
          </label>
          <SortMenu value={sort} onChange={(next) => void onSettings({ repoSort: next })} />
        </div>
        <div className="home-side-scroll">
          {workspaces.length > 0 && (
            <section className="home-side-group" aria-label="Workspaces">
              <div className="side-sec">
                <span>Workspaces</span>
                <span className="counter">{workspaces.length}</span>
              </div>
              {workspaces.map((workspace) => (
                <div
                  key={workspace.id}
                  className="side-item workspace-row"
                  role="button"
                  tabIndex={0}
                  title={workspace.repos.join('\n')}
                  onClick={() => onOpenWorkspace(workspace)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') onOpenWorkspace(workspace)
                  }}
                >
                  <span className="ws-dot" style={{ background: workspace.color }} />
                  <span className="label">{workspace.name}</span>
                  <span className="counter">{workspace.repos.length}</span>
                  <span className="row-tools">
                    <Button
                      variant="icon"
                      aria-label={`Edit ${workspace.name}`}
                      title="Edit workspace"
                      onClick={(event) => {
                        event.stopPropagation()
                        onEditWorkspace(workspace)
                      }}
                    >
                      <Pencil size={12} />
                    </Button>
                    <Button
                      variant="icon"
                      className="danger"
                      aria-label={`Delete ${workspace.name}`}
                      title="Delete workspace"
                      onClick={(event) => {
                        event.stopPropagation()
                        void window.spoon.app
                          .confirm(`Delete workspace “${workspace.name}”?`, 'Repositories stay on disk and in the list.')
                          .then((ok) => {
                            if (ok) onDeleteWorkspace(workspace.id)
                          })
                      }}
                    >
                      <X size={12} />
                    </Button>
                  </span>
                </div>
              ))}
            </section>
          )}
          <section className="home-side-group" aria-label="Repository list">
            <div className="side-sec">
              <span>Repositories</span>
              <span className="counter">{filtered.length}</span>
              <span className="side-sec-tools">
                {picked.length > 0 ? (
                  <Button variant="link" title="Clear selection" onClick={() => setPicked([])}>
                    Clear ({picked.length})
                  </Button>
                ) : (
                  <Button variant="link" title="Select all visible" onClick={() => setPicked(filtered.map((r) => r.path))}>
                    Select all
                  </Button>
                )}
              </span>
            </div>
            {filtered.map((r) => {
              const o = overviews[r.path]
              const on = picked.includes(r.path)
              const checking = analyzing.has(r.path) || !o
              const isPinned = pinned.includes(r.path)
              return (
                <div
                  key={r.path}
                  className={`side-item repo-row ${sel === r.path ? 'active' : ''} ${on ? 'picked' : ''} ${checking ? 'working' : ''}`}
                  title={r.path}
                  role="button"
                  tabIndex={0}
                  aria-current={sel === r.path || undefined}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault()
                      setSel(r.path)
                      setPicked([])
                    }
                  }}
                  onClick={(e) => clickRepo(e, r.path)}
                  onDoubleClick={() => onOpen(r.path, r.name)}
                  onContextMenu={(event) => {
                    event.preventDefault()
                    openRepoMenu(r.path)
                  }}
                >
                  <span className="dot-wrap" title={checking ? 'Analyzing...' : dotTitle(o, isPinned)}>
                    <span className={`dot ${dotTone(o)}`} />
                  </span>
                  <span className="label">{r.name}</span>
                  {isPinned && <IcoPin filled />}
                  <RepoMetrics overview={o} analyzing={checking} />
                </div>
              )
            })}
            {!filtered.length && (
              <div className="home-side-empty">
                {recent.length ? emptyFilterLabel(statusFilter, !!q.trim()) : 'No repositories yet'}
              </div>
            )}
          </section>
        </div>
      </aside>
      <div
        className="splitbar x"
        onPointerDown={(e) =>
          bindDrag(
            e,
            'x',
            (x) => onResize(clamp(x, 200, 480)),
            (x) => onResizeEnd(clamp(x, 200, 480))
          )
        }
      />
      <main className="mgr-main home-main">
        <div className="home-inner">
          <header className="home-head">
            <div className="home-title">
              <span className="home-eyebrow">{greeting}</span>
              <h1>Home</h1>
              <p className="home-sub">
                {totalRepos
                  ? `${totalRepos} repositor${totalRepos === 1 ? 'y' : 'ies'}${workspaces.length ? ` · ${workspaces.length} workspace${workspaces.length === 1 ? '' : 's'}` : ''}${attention ? ` · ${attention} need${attention === 1 ? 's' : ''} attention` : ''}`
                  : 'Add your first repository to get started.'}
              </p>
            </div>
            <div className="home-actions" role="toolbar" aria-label="Add repositories">
              <Button
                variant="icon"
                className="home-icon-btn"
                title="Rescan watched folders"
                aria-label="Rescan watched folders"
                aria-busy={busy === 'rescan' || undefined}
                disabled={!settings?.watchedRoots?.length || !!busy}
                onClick={() => void rescan()}
              >
                <IcoRefresh />
              </Button>
              <Button variant="secondary" title="Find every Git repo inside the folders you pick" onClick={() => void scanFolders()}>
                <IcoScan />
                Scan folders
              </Button>
              <Button variant="secondary" title="Create a new repository" onClick={onInit}>
                <IcoCreate />
                New
              </Button>
              <Button variant="secondary" title="Add a Git folder, or find every repo inside it" onClick={onAdd}>
                <IcoAddRepo />
                Add
              </Button>
              <Button variant="primary" className="primary" title="Clone from a Git URL" onClick={onClone}>
                <IcoClone />
                Clone
              </Button>
            </div>
          </header>

          {totalRepos > 0 && (
          <section className="home-overview" aria-label="Repository status">
            <div className="stat-row" role="toolbar" aria-label="Filter repositories by status">
              <StatChip id="all" count={counts.total} label="Repositories" hint="Show all repositories" active={statusFilter === 'all'} onClick={toggleFilter} />
              <StatChip id="dirty" count={counts.dirty} label="Uncommitted" tone="warn" hint="Show repositories with uncommitted changes" active={statusFilter === 'dirty'} onClick={toggleFilter} />
              <StatChip id="behind" count={counts.behind} label="Behind" tone="info" hint="Show repositories behind their remote" active={statusFilter === 'behind'} onClick={toggleFilter} />
              <StatChip id="ahead" count={counts.ahead} label="To push" tone="info" hint="Show repositories with commits to push" active={statusFilter === 'ahead'} onClick={toggleFilter} />
              <StatChip id="blocked" count={counts.broken} label="Attention" tone="err" hint="Show repositories that need attention" active={statusFilter === 'blocked'} onClick={toggleFilter} />
            </div>
            <div className="home-sync" role="toolbar" aria-label={`Sync ${actionHint}`}>
              <span className="home-sync-label">
                Sync <b>{picked.length ? `${picked.length} selected` : `${filtered.length} shown`}</b>
              </span>
              <div className="home-seg">
                <SyncBtn label="Refresh" hint={`Refresh status of ${actionHint}`} disabled={!!busy || !actionCount} busy={busy === 'refresh'} onClick={() => void runBulk('refresh')}>
                  <IcoRefresh />
                </SyncBtn>
                <SyncBtn label="Fetch" hint={`Fetch remotes for ${actionHint}`} disabled={!!busy || !actionCount} busy={busy === 'fetch'} onClick={() => void runBulk('fetch')}>
                  <IcoFetch />
                </SyncBtn>
                <SyncBtn label="Pull" hint={`Pull ${actionHint}`} disabled={!!busy || !actionCount} busy={busy === 'pull'} onClick={() => void runBulk('pull')}>
                  <IcoPull />
                </SyncBtn>
                <SyncBtn label="Push" hint={`Push ${actionHint}`} disabled={!!busy || !actionCount} busy={busy === 'push'} onClick={() => void runBulk('push')}>
                  <IcoPush />
                </SyncBtn>
              </div>
            </div>
          </section>
          )}

          {scan ? (
            <p className={`home-notice${busy || scan.endsWith('...') ? ' working' : ''}`} title={scan} role="status">
              {scan}
              <Button variant="icon" aria-label="Dismiss" onClick={() => setScan('')}>
                <X size={12} />
              </Button>
            </p>
          ) : null}

          {bulk && <BulkSummary results={bulk} onClear={() => setBulk(null)} />}

          {many ? (
            <section className="home-card repo-card pop-in" aria-label="Selected repositories">
              <div className="repo-card-top">
                <div className="repo-id">
                  <span className="repo-mark multi" aria-hidden>
                    {picked.length}
                  </span>
                  <div className="repo-id-copy">
                    <h2>{picked.length} repositories selected</h2>
                    <div className="hint">Ctrl-click to pick several · Shift-click a range</div>
                  </div>
                </div>
                <div className="repo-actions">
                  <div className="home-seg" role="toolbar" aria-label="Organize selected">
                    <IconAct bare label="Save workspace" hint="Save the selection as a workspace" onClick={() => onSaveWorkspace(picked)}>
                      <IcoSave />
                    </IconAct>
                    {unsafePicked.length > 0 && (
                      <IconAct bare label="Mark safe" hint={`Mark ${unsafePicked.length} as safe`} disabled={!!busy} busy={busy === 'safe'} onClick={() => void markSafe(unsafePicked)}>
                        <IcoShield />
                      </IconAct>
                    )}
                    <IconAct bare label="Pin" hint="Pin selected" onClick={() => void pinPicked(true)}>
                      <IcoPin filled />
                    </IconAct>
                    <IconAct bare label="Unpin" hint="Unpin selected" onClick={() => void pinPicked(false)}>
                      <IcoUnpin />
                    </IconAct>
                    <IconAct bare label="Remove" hint="Remove selected from the list" danger onClick={() => void removePicked()}>
                      <IcoTrash />
                    </IconAct>
                  </div>
                  <Button className="primary ico-text" variant="primary" onClick={() => onOpenSelection(picked)}>
                    <IcoWorkspaces />
                    Open workspace
                  </Button>
                </div>
              </div>
              <ul className="picked-list">
                {picked.map((path) => {
                  const repo = recent.find((r) => r.path === path)
                  const checking = analyzing.has(path) || !overviews[path]
                  return (
                    <li key={path} className={checking ? 'working' : undefined}>
                      <span className="repo-mark sm" aria-hidden style={{ background: avatarColor(path) }}>
                        {initials((repo?.name ?? path).replace(/[-_]+/g, ' '))}
                      </span>
                      <Button className="linkish" variant="link" onClick={() => setSel(path)}>
                        {repo?.name ?? path}
                      </Button>
                      <RepoBadges overview={overviews[path]} compact analyzing={checking} />
                    </li>
                  )
                })}
              </ul>
            </section>
          ) : recent.length ? null : (
            <section className="home-card home-empty">
              <div className="home-empty-mark" aria-hidden>
                <SpoonMark />
              </div>
              <h2>No repositories yet</h2>
              <p>Clone a remote, add a folder you already have, or scan a directory to find every Git repository inside it.</p>
              <div className="home-empty-actions">
                <Button variant="primary" className="primary" onClick={onClone}>
                  <IcoClone />
                  Clone repository
                </Button>
                <Button variant="secondary" onClick={onAdd}>
                  <IcoAddRepo />
                  Add existing
                </Button>
                <Button variant="secondary" onClick={() => void scanFolders()}>
                  <IcoScan />
                  Scan folders
                </Button>
              </div>
            </section>
          )}

          {recent.length > 0 && (
            <RecentWork
              recent={recent}
              overviews={overviews}
              selected={sel}
              onSelect={(path) => {
                setSel(path)
                setPicked([])
              }}
              onOpen={onOpen}
              onClone={onClone}
            />
          )}
        </div>
      </main>
    </div>
  )
}

function homeGreeting(): string {
  const hour = new Date().getHours()
  if (hour < 5) return 'Working late'
  if (hour < 12) return 'Good morning'
  if (hour < 19) return 'Good afternoon'
  return 'Good evening'
}

function syncLabel(o: RepoOverview): string {
  if (!o.upstream && !o.ahead && !o.behind) return o.remoteUrl ? 'Up to date' : 'Local only'
  const bits: string[] = []
  if (o.ahead) bits.push(`${o.ahead} to push`)
  if (o.behind) bits.push(`${o.behind} to pull`)
  return bits.length ? bits.join(' · ') : 'Up to date'
}

function SyncBtn({
  label,
  hint,
  children,
  onClick,
  disabled,
  busy
}: {
  label: string
  hint: string
  children: ReactNode
  onClick: () => void
  disabled?: boolean
  busy?: boolean
}) {
  return (
    <Button
      variant="segment"
      className={`home-sync-btn${busy ? ' busy' : ''}`}
      title={hint}
      aria-label={hint}
      aria-busy={busy || undefined}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
      <span>{label}</span>
    </Button>
  )
}

function RepoMetrics({ overview, analyzing }: { overview?: RepoOverview; analyzing?: boolean }) {
  if (!overview) return <span className="metrics"><span className="metric working">···</span></span>
  const items: { key: string; text: string; cls: string; title: string }[] = []
  if (overview.unsafe) items.push({ key: 'u', text: 'unsafe', cls: 'err', title: 'Git does not trust this folder' })
  else if (overview.error) items.push({ key: 'e', text: 'error', cls: 'err', title: overview.error })
  if (overview.operation) items.push({ key: 'o', text: overview.operation, cls: 'warn', title: `${overview.operation} in progress` })
  if (overview.conflicts) items.push({ key: 'c', text: `!${overview.conflicts}`, cls: 'err', title: `${overview.conflicts} conflict(s)` })
  const dirty = overview.staged + overview.unstaged + overview.untracked
  if (dirty) items.push({ key: 'd', text: `●${dirty}`, cls: 'warn', title: `${dirty} changed` })
  if (overview.behind) items.push({ key: 'b', text: `↓${overview.behind}`, cls: 'info', title: `${overview.behind} behind` })
  if (overview.ahead) items.push({ key: 'a', text: `↑${overview.ahead}`, cls: 'info', title: `${overview.ahead} ahead` })
  if (!items.length && !analyzing) return null
  return (
    <span className={`metrics${analyzing ? ' working' : ''}`}>
      {items.map((item) => (
        <span key={item.key} className={`metric ${item.cls}`} title={item.title}>
          {item.text}
        </span>
      ))}
    </span>
  )
}

function StatChip({
  id,
  count,
  label,
  tone,
  hint,
  active,
  onClick
}: {
  id: StatusFilter
  count: number
  label: string
  tone?: string
  hint: string
  active: boolean
  onClick: (id: StatusFilter) => void
}) {
  const empty = id !== 'all' && count === 0
  const toneClass = tone && (count > 0 || active) ? ` ${tone}` : ''
  return (
    <Button
      type="button"
      className={`stat-pill${toneClass}${active ? ' on' : ''}`}
      aria-pressed={active}
      title={hint}
      aria-label={`${hint} (${count})`}
      disabled={empty}
      onClick={() => onClick(id)}
    >
      <span className="stat-label">
        <i className="stat-dot" aria-hidden />
        {label}
      </span>
      <b>{count}</b>
    </Button>
  )
}

const SORT_OPTIONS: { value: RepoSort; label: string }[] = [
  { value: 'opened', label: 'Last opened' },
  { value: 'name', label: 'Name' },
  { value: 'changes', label: 'With changes' },
  { value: 'behind', label: 'Behind remote' },
  { value: 'ahead', label: 'To push' },
  { value: 'status', label: 'Needs attention' }
]

function SortMenu({ value, onChange }: { value: RepoSort; onChange: (value: RepoSort) => void }) {
  const [open, setOpen] = useState(false)
  const [hi, setHi] = useState(value)
  const wrapRef = useRef<HTMLDivElement>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const current = SORT_OPTIONS.find((o) => o.value === value) ?? SORT_OPTIONS[0]

  useEffect(() => {
    if (open) setHi(value)
  }, [open, value])

  useEffect(() => {
    if (!open) return
    const onDoc = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      setOpen(false)
      btnRef.current?.focus()
    }
    document.addEventListener('pointerdown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const pick = (next: RepoSort) => {
    onChange(next)
    setOpen(false)
    btnRef.current?.focus()
  }

  const move = (dir: 1 | -1) => {
    const i = SORT_OPTIONS.findIndex((o) => o.value === hi)
    const next = SORT_OPTIONS[(i + dir + SORT_OPTIONS.length) % SORT_OPTIONS.length]
    setHi(next.value)
  }

  return (
    <div className={`menu-select${open ? ' open' : ''}`} ref={wrapRef}>
      <Button
        ref={btnRef}
        type="button"
        className="menu-select-btn"
        aria-label="Sort repositories"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls="repo-sort-list"
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault()
            if (!open) setOpen(true)
            else move(e.key === 'ArrowDown' ? 1 : -1)
            return
          }
          if (open && (e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault()
            pick(hi)
          }
        }}
      >
        <span>{current.label}</span>
        <IcoChevron />
      </Button>
      {open && (
        <ul id="repo-sort-list" className="menu-select-list" role="listbox" aria-label="Sort repositories">
          {SORT_OPTIONS.map((o) => (
            <li key={o.value} role="presentation">
              <Button
                type="button"
                role="option"
                aria-selected={o.value === value}
                className={`menu-select-opt${o.value === value ? ' on' : ''}${o.value === hi ? ' hi' : ''}`}
                onMouseEnter={() => setHi(o.value)}
                onClick={() => pick(o.value)}
              >
                {o.label}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function IconAct({
  label,
  hint,
  children,
  onClick,
  onContextMenu,
  disabled,
  busy,
  danger,
  pressed,
  bare
}: {
  label: string
  hint?: string
  children: ReactNode
  onClick: () => void
  onContextMenu?: (event: MouseEvent<HTMLButtonElement>) => void
  disabled?: boolean
  busy?: boolean
  danger?: boolean
  pressed?: boolean
  bare?: boolean
}) {
  const name = hint ?? label
  return (
    <Button
      type="button"
      className={`ico-act${bare ? ' bare' : ''}${danger ? ' danger' : ''}${busy ? ' busy' : ''}${pressed ? ' on' : ''}`}
      title={name}
      aria-label={name}
      aria-pressed={pressed === undefined ? undefined : pressed}
      aria-busy={busy || undefined}
      disabled={disabled}
      onClick={onClick}
      onContextMenu={onContextMenu}
    >
      <span className="ico-wrap" aria-hidden>
        {children}
      </span>
      {bare ? null : <span>{label}</span>}
    </Button>
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
  const ok = !issues.length
  const canAuto = issues.some((i) => i.fix && !i.fix.destructive && i.fix.id !== 'set-identity')
  return (
    <div className={`health${ok ? ' ok' : ''}`}>
      <div className="health-head">
        <span className={`health-dot${ok ? ' ok' : ' warn'}`} aria-hidden />
        <strong>Health</strong>
        <span className="hint">{ok ? 'Looks good' : `${issues.length} issue${issues.length === 1 ? '' : 's'}`}</span>
        <div className="cluster" role="toolbar" aria-label="Health actions">
          <IconAct bare label="Deep check" hint="Run git fsck" onClick={onDeep}>
            <IcoDeep />
          </IconAct>
          {canAuto && (
            <IconAct bare label="Fix safe issues" hint="Fix safe issues automatically" onClick={onFixSafe}>
              <IcoWrench />
            </IconAct>
          )}
        </div>
      </div>
      {issues.map((issue) => (
        <div key={issue.id} className={`issue ${issue.severity}`}>
          <div>
            <b>{issue.title}</b>
            <p>{issue.detail}</p>
          </div>
          {issue.fix && (
            <Button className={`ghost ${issue.fix.destructive ? 'danger' : ''}`} onClick={() => onFix(issue.fix!.id)}>
              {issue.fix.label}
            </Button>
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
      <Button className="ghost" onClick={onClear}>
        Dismiss
      </Button>
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
        <span className="chip working">Analyzing...</span>
      </span>
    ) : (
      <span className="hint working">Analyzing...</span>
    )
  }
  const bits: { key: string; label: string; cls: string }[] = []
  if (analyzing) bits.push({ key: 'scan', label: 'Analyzing...', cls: 'working' })
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

function matchesStatus(o: RepoOverview | undefined, filter: StatusFilter): boolean {
  if (filter === 'all') return true
  if (!o) return false
  if (filter === 'dirty') return o.staged + o.unstaged + o.untracked > 0
  if (filter === 'behind') return o.behind > 0
  if (filter === 'ahead') return o.ahead > 0
  return !!(o.error || o.unsafe || o.conflicts)
}

function emptyFilterLabel(filter: StatusFilter, hasQuery: boolean): string {
  if (hasQuery) return 'No matches.'
  if (filter === 'dirty') return 'No dirty repositories.'
  if (filter === 'behind') return 'No repositories behind remote.'
  if (filter === 'ahead') return 'Nothing to push.'
  if (filter === 'blocked') return 'No blocked repositories.'
  return 'No matches.'
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
              <Button className="ghost" onClick={() => onOpen(path)}>
                Open repo
              </Button>
            )}
            <Button className="primary" onClick={onClose}>
              Close
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
