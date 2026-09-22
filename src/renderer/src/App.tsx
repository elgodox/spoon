import { memo, useCallback, useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from 'react'
import type {
  ActivityItem,
  AiAccount,
  AiEndpointConfig,
  AiModelCatalog,
  AiModelChoice,
  AiProviderId,
  BlameLine,
  ChangeAnalysis,
  BranchInfo,
  CommitInfo,
  ConflictFile,
  DiffHunk,
  FileDiff,
  MediaPair,
  MediaSide,
  FileTreeNode,
  RebaseTodoItem,
  RepoStatus,
  RepoSummary,
  Settings,
  StashInfo,
  StatusEntry,
  TagInfo
} from '../../shared/types'
import { classifyMedia, formatBytes } from '../../shared/media'
import { AI_SITE_CATALOG, customProviderId } from '../../shared/ai-catalog'
import { ProviderIcon } from './ai-logos'
import { AI_MODELS, BUILTIN_AI_IDS, DEFAULT_AI_MODELS, defaultModelFor, listedProviderIds, PAID_AI_PROVIDERS, providerLabel } from '../../shared/models'
import {
  IcoAi,
  IcoBranch,
  IcoChanges,
  IcoConsole,
  IcoFetch,
  IcoHome,
  IcoLaunch,
  IcoOpen,
  IcoPull,
  IcoPush,
  IcoRemote,
  IcoStash,
  IcoTag,
  IcoTheme
} from './icons'
import {
  avatarColor,
  bindDrag,
  catchErr,
  clamp,
  fileName,
  formatAgo,
  formatDate,
  initials,
  joinRepoPath,
  laneColor,
  parentDir
} from './lib'

type Tab = { id: string; kind: 'manager' | 'repo'; path?: string; name: string }
type Snapshot = {
  status: RepoStatus
  commits: CommitInfo[]
  branches: BranchInfo[]
  tags: TagInfo[]
  remotes: { name: string; url: string }[]
  stashes: StashInfo[]
  submodules: { path: string; hash: string; status: string }[]
  identity: { name: string; email: string }
}
type SideSel =
  | { kind: 'changes' }
  | { kind: 'all' }
  | { kind: 'branch'; name: string }
  | { kind: 'remote'; name: string }
  | { kind: 'tag'; name: string }
  | { kind: 'stash'; selector: string }
type DraftCommit = {
  key: string
  subject: string
  body: string
  files: string[]
  rationale: string
  include: boolean
}
type Overlay =
  | null
  | { type: 'clone' }
  | { type: 'init' }
  | { type: 'branch' }
  | { type: 'rename'; from: string }
  | { type: 'tag' }
  | { type: 'remote' }
  | { type: 'remote-edit'; name: string; url: string }
  | { type: 'remote-rename'; from: string }
  | { type: 'stash' }
  | { type: 'merge'; ref: string }
  | { type: 'rebase'; ref: string }
  | { type: 'settings' }
  | { type: 'about' }
  | { type: 'blame'; file: string; rev?: string }
  | { type: 'history'; file: string }
  | { type: 'conflict'; file: string }
  | { type: 'ir' }
  | { type: 'device'; userCode: string; url: string }
  | { type: 'reflog' }

let menuUnsub: (() => void) | null = null

function openMenu(items: object[], onPick: (id: string) => void) {
  void window.spoon.app.popup(items)
  menuUnsub?.()
  menuUnsub = window.spoon.app.on('menu:item', (id) => {
    menuUnsub?.()
    menuUnsub = null
    onPick(String(id))
  })
}

async function pushHead(path: string, snap?: Snapshot) {
  if (!snap) throw new Error('Repository is still loading.')
  if (snap.status.detached) throw new Error('Detached HEAD. Checkout a branch before pushing.')
  const remote = snap.status.upstream?.split('/')[0] || snap.remotes[0]?.name
  if (!remote) throw new Error('This repository has no remote.')
  await window.spoon.git.push(path, {
    remote,
    branch: snap.status.branch,
    setUpstream: !snap.status.upstream
  })
}

export function App() {
  const [tabs, setTabs] = useState<Tab[]>([{ id: 'mgr', kind: 'manager', name: 'New Tab' }])
  const [activeId, setActiveId] = useState('mgr')
  const [settings, setSettings] = useState<Settings | null>(null)
  const settingsRef = useRef(settings)
  settingsRef.current = settings
  const [sidebarW, setSidebarW] = useState(220)
  const [catalogs, setCatalogs] = useState<Record<AiProviderId, AiModelCatalog>>({
    free: { provider: 'free', models: AI_MODELS.free, live: false },
    grok: { provider: 'grok', models: AI_MODELS.grok, live: false },
    chatgpt: { provider: 'chatgpt', models: AI_MODELS.chatgpt, live: false },
    claude: { provider: 'claude', models: AI_MODELS.claude, live: false }
  })
  const [recent, setRecent] = useState<RepoSummary[]>([])
  const [snaps, setSnaps] = useState<Record<string, Snapshot>>({})
  const [busy, setBusy] = useState(false)
  const [overlay, setOverlay] = useState<Overlay>(null)
  const [quick, setQuick] = useState(false)
  const [activityOpen, setActivityOpen] = useState(false)
  const [activity, setActivity] = useState<ActivityItem[]>([])
  const [accounts, setAccounts] = useState<AiAccount[]>([])
  const [theme, setTheme] = useState<'light' | 'dark'>('light')
  const active = tabs.find((t) => t.id === activeId) || tabs[0]

  const applyTheme = useCallback((mode: Settings['theme']) => {
    const dark =
      mode === 'dark' || (mode === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
    setTheme(dark ? 'dark' : 'light')
    document.documentElement.dataset.theme = dark ? 'dark' : 'light'
  }, [])

  const refreshModels = useCallback(async (force = false) => {
    const ids = listedProviderIds(settingsRef.current)
    const loaded = await Promise.all(
      ids.map(async (provider) => {
        try {
          return (await window.spoon.ai.models(provider, force)) as AiModelCatalog
        } catch (error) {
          return {
            provider,
            models: AI_MODELS[provider] ?? [],
            live: false,
            error: error instanceof Error ? error.message : String(error)
          }
        }
      })
    )
    const next: Record<string, AiModelCatalog> = {
      free: { provider: 'free', models: AI_MODELS.free, live: false },
      grok: { provider: 'grok', models: AI_MODELS.grok, live: false },
      chatgpt: { provider: 'chatgpt', models: AI_MODELS.chatgpt, live: false },
      claude: { provider: 'claude', models: AI_MODELS.claude, live: false }
    }
    for (const catalog of loaded) next[catalog.provider] = catalog
    setCatalogs(next)
  }, [])

  const refreshSettings = useCallback(async () => {
    const s = await window.spoon.app.settings()
    setSettings(s)
    setSidebarW(s.sidebarWidth || 220)
    applyTheme(s.theme)
    setRecent(await window.spoon.app.recent())
    setAccounts(await window.spoon.ai.accounts())
  }, [applyTheme])

  useEffect(() => {
    void refreshModels(true)
    const timer = setInterval(() => void refreshModels(true), 10 * 60 * 1000)
    return () => clearInterval(timer)
  }, [refreshModels, accounts])

  useEffect(() => {
    return window.spoon.app.on('theme:native', (dark) => {
      const mode = settingsRef.current?.theme ?? 'system'
      if (mode === 'system') {
        const isDark = Boolean(dark)
        setTheme(isDark ? 'dark' : 'light')
        document.documentElement.dataset.theme = isDark ? 'dark' : 'light'
      } else {
        applyTheme(mode)
      }
    })
  }, [applyTheme])

  const loadRepo = useCallback(async (path: string, name?: string) => {
    setBusy(true)
    try {
      const snap = (await window.spoon.git.open(path)) as Snapshot
      setSnaps((m) => ({ ...m, [path]: snap }))
      setTabs((ts) => {
        const existing = ts.find((t) => t.path === path)
        if (existing) {
          setActiveId(existing.id)
          return ts
        }
        const id = `r-${Date.now()}`
        setActiveId(id)
        const next = ts.filter((t) => !(t.kind === 'manager' && ts.length === 1))
        return [...next, { id, kind: 'repo', path, name: name || snap.status.name }]
      })
      setRecent(await window.spoon.app.recent())
    } catch (e) {
      await window.spoon.app.error(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }, [])

  const reloadTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const runRemoteRef = useRef(runRemote)
  runRemoteRef.current = runRemote
  const reload = useCallback(
    async (path?: string) => {
      const p = path || active.path
      if (!p) return
      try {
        const snap = (await window.spoon.git.snapshot(p)) as Snapshot
        setSnaps((m) => ({ ...m, [p]: snap }))
      } catch {
        /* ignore transient git lock */
      }
    },
    [active.path]
  )
  const reloadSoon = useCallback(
    (path?: string) => {
      if (reloadTimer.current) clearTimeout(reloadTimer.current)
      reloadTimer.current = setTimeout(() => void reload(path), 500)
    },
    [reload]
  )

  useEffect(() => {
    void refreshSettings()
    const offs = [
      window.spoon.app.on('menu', (action) => {
        const a = String(action)
        if (a === 'manager') openManager()
        if (a === 'clone') setOverlay({ type: 'clone' })
        if (a === 'open') void openExisting()
        if (a === 'init') setOverlay({ type: 'init' })
        if (a === 'settings') setOverlay({ type: 'settings' })
        if (a === 'quick') setQuick(true)
        if (a === 'theme') void toggleTheme()
        if (a === 'about') setOverlay({ type: 'about' })
        if (a === 'fetch') void runRemoteRef.current('fetch')
        if (a === 'pull') void runRemoteRef.current('pull')
        if (a === 'push') void runRemoteRef.current('push')
        if (a === 'branch') setOverlay({ type: 'branch' })
        if (a === 'stash') setOverlay({ type: 'stash' })
        if (a === 'commit') document.dispatchEvent(new CustomEvent('spoon-commit'))
        if (a === 'commit-push') document.dispatchEvent(new CustomEvent('spoon-commit-push'))
        if (a === 'ai-fill') document.dispatchEvent(new CustomEvent('spoon-ai-fill'))
        if (a === 'ai-commit') document.dispatchEvent(new CustomEvent('spoon-ai-commit'))
        if (a === 'ai-commit-push') document.dispatchEvent(new CustomEvent('spoon-ai-commit-push'))
        if (a === 'analyze') document.dispatchEvent(new CustomEvent('spoon-analyze'))
        if (a === 'changes') document.dispatchEvent(new CustomEvent('spoon-view', { detail: 'changes' }))
        if (a === 'commits') document.dispatchEvent(new CustomEvent('spoon-view', { detail: 'commits' }))
      }),
      window.spoon.app.on('repo:changed', (p) => reloadSoon(String(p))),
      window.spoon.app.on('activity', (items) => setActivity(items as ActivityItem[])),
      window.spoon.app.on('open-path', (p) => void loadRepo(String(p))),
      window.spoon.app.on('auto-fetch', () => {
        if (active.path) void window.spoon.git.fetch(active.path, { all: true, prune: true }).then(() => reload())
      })
    ]
    return () => offs.forEach((off) => off())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active.path, loadRepo, reload, reloadSoon])

  function openManager() {
    const id = `m-${Date.now()}`
    setTabs((t) => [...t, { id, kind: 'manager', name: 'New Tab' }])
    setActiveId(id)
  }

  async function openExisting() {
    try {
      const p = await window.spoon.app.pickRepo()
      if (p) await loadRepo(p)
    } catch (e) {
      await window.spoon.app.error(e instanceof Error ? e.message : String(e))
    }
  }

  async function toggleTheme() {
    if (!settings) return
    const next = theme === 'light' ? 'dark' : 'light'
    const s = await window.spoon.app.patchSettings({ theme: next })
    setSettings(s)
    applyTheme(s.theme)
  }

  async function runRemote(kind: 'fetch' | 'pull' | 'push') {
    if (!active.path) return
    setBusy(true)
    await catchErr(async () => {
      if (kind === 'fetch') await window.spoon.git.fetch(active.path!, { all: true, prune: true })
      if (kind === 'pull') await window.spoon.git.pull(active.path!, { rebase: false, prune: true })
      if (kind === 'push') {
        await pushHead(active.path!, snaps[active.path!])
        document.dispatchEvent(new CustomEvent('spoon-confetti'))
      }
      await reload()
    })
    setBusy(false)
  }

  function closeTab(id: string) {
    setTabs((ts) => {
      const t = ts.find((x) => x.id === id)
      if (t?.path) void window.spoon.git.close(t.path)
      const next = ts.filter((x) => x.id !== id)
      if (!next.length) {
        const nid = 'mgr'
        setActiveId(nid)
        return [{ id: nid, kind: 'manager', name: 'New Tab' }]
      }
      if (id === activeId) setActiveId(next[next.length - 1].id)
      return next
    })
  }

  const snap = active.path ? snaps[active.path] : undefined
  const glass = settings?.glass ?? 40
  const [confettiAt, setConfettiAt] = useState(0)

  useEffect(() => {
    const burst = () => setConfettiAt(Date.now())
    document.addEventListener('spoon-confetti', burst)
    return () => document.removeEventListener('spoon-confetti', burst)
  }, [])

  return (
    <div
      className={`app ${busy ? 'busy' : ''} ${glass > 0 ? 'frost' : ''}`}
      data-theme={theme}
      style={{
        ['--glass-fill' as string]: `${Math.max(20, 100 - glass * 0.7)}%`,
        ['--glass-blur' as string]: `${Math.round(glass * 0.35)}px`
      }}
    >
      <div className="toolbar">
        <div className="tb-group">
          <button className="tb-btn" onClick={() => setQuick(true)}>
            <IcoLaunch />
            <span>Quick Launch</span>
          </button>
          <button className="tb-btn" disabled={!active.path} onClick={() => void runRemote('fetch')}>
            <IcoFetch />
            <span>Fetch{snap?.status.behind ? '*' : ''}</span>
          </button>
          <button className="tb-btn" disabled={!active.path} onClick={() => void runRemote('pull')}>
            <IcoPull />
            <span>Pull{snap?.status.behind ? ` ${snap.status.behind}` : ''}</span>
          </button>
          <button className="tb-btn" disabled={!active.path} onClick={() => void runRemote('push')}>
            <IcoPush />
            <span>Push{snap?.status.ahead ? ` ${snap.status.ahead}` : ''}</span>
          </button>
          <button className="tb-btn" disabled={!active.path} onClick={() => setOverlay({ type: 'stash' })}>
            <IcoStash />
            <span>Stash</span>
          </button>
        </div>
        <div className="tb-group center">
          <div className="branch-chip">
            <div className="repo">{active.kind === 'repo' ? active.name : 'Welcome to Spoon'}</div>
            <div className="br">
              {active.kind === 'repo' ? (
                <>
                  <IcoBranch /> {snap?.status.detached ? 'detached HEAD' : snap?.status.branch || '…'}
                </>
              ) : (
                'Open a repository to start'
              )}
            </div>
          </div>
        </div>
        <div className="tb-group right">
          <button className="tb-btn" disabled={!active.path} onClick={() => setOverlay({ type: 'branch' })}>
            <IcoBranch />
            <span>New Branch</span>
          </button>
          <button
            className="tb-btn"
            disabled={!active.path}
            onClick={() => active.path && window.spoon.app.showItem(active.path)}
          >
            <IcoOpen />
            <span>Open in</span>
          </button>
          <button className="tb-btn" onClick={() => setActivityOpen((v) => !v)}>
            <IcoConsole />
            <span>Console</span>
          </button>
          <button className="tb-btn" onClick={() => void toggleTheme()}>
            <IcoTheme />
            <span>Appearance</span>
          </button>
          <button className="tb-btn" onClick={openManager}>
            <IcoHome />
            <span>Home</span>
          </button>
          <button className="tb-btn" onClick={() => setOverlay({ type: 'settings' })}>
            <IcoAi />
            <span>AI</span>
          </button>
          <div className="caption-gap" />
        </div>
      </div>

      <div className="tabs">
        {tabs.map((t) => (
          <button key={t.id} className={`tab ${t.id === activeId ? 'active' : ''}`} onClick={() => setActiveId(t.id)}>
            <span className="name">{t.name}</span>
            {t.path && snap && t.path === active.path && snap.status.unstagedCount + snap.status.stagedCount > 0
              ? '*'
              : ''}
            <span
              className="x"
              onClick={(e) => {
                e.stopPropagation()
                closeTab(t.id)
              }}
            >
              ×
            </span>
          </button>
        ))}
        <button className="tab-add" onClick={openManager}>
          +
        </button>
      </div>

      <div className="body">
        {active.kind === 'manager' || !active.path ? (
          <RepoManager
            recent={recent}
            width={sidebarW}
            onResize={setSidebarW}
            onResizeEnd={(width) => {
              setSidebarW(width)
              void window.spoon.app.patchSettings({ sidebarWidth: width }).then(setSettings)
            }}
            onOpen={(p, n) => void loadRepo(p, n)}
            onClone={() => setOverlay({ type: 'clone' })}
            onInit={() => setOverlay({ type: 'init' })}
            onAdd={() => void openExisting()}
            onRecent={setRecent}
          />
        ) : snap ? (
          <Workspace
            path={active.path}
            snap={snap}
            settings={settings}
            accounts={accounts}
            sidebarW={sidebarW}
            onSidebar={setSidebarW}
            onSidebarEnd={(width) => {
              setSidebarW(width)
              void window.spoon.app.patchSettings({ sidebarWidth: width }).then(setSettings)
            }}
            catalogs={catalogs}
            onOpen={(p, n) => void loadRepo(p, n)}
            onPatchSettings={(patch) => {
              void window.spoon.app.patchSettings(patch).then(setSettings)
            }}
            onReload={() => void reload()}
            onOverlay={setOverlay}
            onBusy={setBusy}
          />
        ) : (
          <div className="empty">Loading repository…</div>
        )}
      </div>

      {overlay && (
        <DialogHost
          overlay={overlay}
          path={active.path}
          snap={snap}
          settings={settings}
          accounts={accounts}
          catalogs={catalogs}
          onClose={() => setOverlay(null)}
          onReload={() => void reload()}
          onOpen={loadRepo}
          onSettings={async () => {
            await refreshSettings()
          }}
        />
      )}
      {quick && (
        <QuickLaunch
          tabs={tabs}
          recent={recent}
          snap={snap}
          onClose={() => setQuick(false)}
          onOpen={(p, n) => {
            setQuick(false)
            void loadRepo(p, n)
          }}
          onAction={(a) => {
            setQuick(false)
            if (a === 'fetch') void runRemote('fetch')
            if (a === 'settings') setOverlay({ type: 'settings' })
            if (a === 'branch') setOverlay({ type: 'branch' })
          }}
        />
      )}
      {activityOpen && (
        <div className="activity">
          <h3>
            Activity <button className="ghost" onClick={() => setActivityOpen(false)}>Close</button>
          </h3>
          <pre>
            {activity
              .slice(0, 12)
              .map((a) => `[${a.status}] ${a.title}\n${a.command ?? ''}\n${a.output ?? ''}`)
              .join('\n\n') || 'No activity yet.'}
          </pre>
        </div>
      )}
      <ConfettiBurst token={confettiAt} />
    </div>
  )
}

function ConfettiBurst({ token }: { token: number }) {
  const bits = useMemo(() => {
    if (!token) return []
    const colors = ['#7c3aed', '#c4b5fd', '#ffffff', '#f59e0b', '#6cb6ff', '#f472b6', '#34d399']
    return Array.from({ length: 90 }, (_, i) => ({
      x: `${Math.random() * 100}%`,
      dx: `${(Math.random() - 0.5) * 240}px`,
      delay: `${Math.random() * 0.35}s`,
      dur: `${1.35 + Math.random() * 1.1}s`,
      w: `${5 + Math.random() * 7}px`,
      c: colors[i % colors.length]
    }))
  }, [token])
  if (!token) return null
  return (
    <div className="confetti" aria-hidden>
      {bits.map((b, i) => (
        <i
          key={`${token}-${i}`}
          style={{
            ['--x' as string]: b.x,
            ['--dx' as string]: b.dx,
            ['--delay' as string]: b.delay,
            ['--dur' as string]: b.dur,
            ['--w' as string]: b.w,
            ['--c' as string]: b.c
          }}
        />
      ))}
    </div>
  )
}

function RepoManager({
  recent,
  width,
  onResize,
  onResizeEnd,
  onOpen,
  onClone,
  onInit,
  onAdd,
  onRecent
}: {
  recent: RepoSummary[]
  width: number
  onResize: (width: number) => void
  onResizeEnd: (width: number) => void
  onOpen: (path: string, name?: string) => void
  onClone: () => void
  onInit: () => void
  onAdd: () => void
  onRecent: (recent: RepoSummary[]) => void
}) {
  const [sel, setSel] = useState(recent[0]?.path)
  const [scan, setScan] = useState('')
  const current = recent.find((r) => r.path === sel)

  async function scanFolders() {
    const dirs = (await window.spoon.app.pickDirectories()) as string[] | null
    if (!dirs?.length) return
    setScan(`Scanning ${dirs.length} folder${dirs.length === 1 ? '' : 's'}…`)
    const off = window.spoon.app.on('scan:progress', (info) => {
      const p = info as { found?: number; looking?: string }
      setScan(`Found ${p.found ?? 0}… ${p.looking ?? ''}`)
    })
    try {
      const found = (await window.spoon.git.scan(dirs)) as { path: string; name: string }[]
      const next = (await window.spoon.app.addRepos(found)) as RepoSummary[]
      onRecent(next)
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

  return (
    <div className="manager">
      <div className="mgr-side" style={{ width }}>
        <div className="side-sec">Recent</div>
        {recent.map((r) => (
          <div
            key={r.path}
            className={`side-item ${sel === r.path ? 'active' : ''}`}
            onClick={() => setSel(r.path)}
            onDoubleClick={() => onOpen(r.path, r.name)}
          >
            <span className="label">{r.name}</span>
          </div>
        ))}
        {!recent.length && <div className="empty">No repositories yet</div>}
      </div>
      <div
        className="splitbar x"
        onPointerDown={(e) =>
          bindDrag(
            e,
            'x',
            (x) => onResize(clamp(x, 160, 480)),
            (x) => onResizeEnd(clamp(x, 160, 480))
          )
        }
      />
      <div className="mgr-main">
        <h1>Repository Manager</h1>
        <div className="mgr-actions">
          <button className="ghost" onClick={onClone}>Clone</button>
          <button className="ghost" onClick={onAdd}>Add existing</button>
          <button className="ghost" onClick={onInit}>Create new</button>
          <button className="ghost" onClick={() => void scanFolders()}>Scan folders</button>
        </div>
        {scan ? <p className="hint" title={scan}>{scan}</p> : null}
        {current ? (
          <>
            <h2 style={{ margin: '0 0 4px' }}>{current.name}</h2>
            <div className="hint">{current.path}</div>
            <div className="stat-row">Last opened {formatAgo(current.lastOpened)}</div>
            <button className="primary" onClick={() => onOpen(current.path, current.name)}>
              Open
            </button>
          </>
        ) : (
          <p className="empty">Clone, add, scan folders, or create a repository to get started.</p>
        )}
      </div>
    </div>
  )
}

function Workspace({
  path,
  snap,
  settings,
  accounts,
  catalogs,
  onOpen,
  sidebarW,
  onSidebar,
  onSidebarEnd,
  onPatchSettings,
  onReload,
  onOverlay,
  onBusy
}: {
  path: string
  snap: Snapshot
  settings: Settings | null
  accounts: AiAccount[]
  catalogs: Record<AiProviderId, AiModelCatalog>
  onOpen: (path: string, name?: string) => void
  sidebarW: number
  onSidebar: (width: number) => void
  onSidebarEnd: (width: number) => void
  onPatchSettings: (patch: Partial<Settings>) => void
  onReload: () => void
  onOverlay: (o: Overlay) => void
  onBusy: (b: boolean) => void
}) {
  const [sel, setSel] = useState<SideSel>({ kind: 'all' })
  const [commit, setCommit] = useState<CommitInfo | null>(snap.commits[0] ?? null)
  const [detailTab, setDetailTab] = useState<'commit' | 'changes' | 'tree'>('commit')
  const [filter, setFilter] = useState('')
  const [focusBranch, setFocusBranch] = useState<string | null>(null)
  const [pulseKey, setPulseKey] = useState(0)
  const [pulseHashes, setPulseHashes] = useState<string[]>([])
  const [search, setSearch] = useState('')
  const [file, setFile] = useState<string | null>(null)
  const [stagedFocus, setStagedFocus] = useState(false)
  const [unstagedSel, setUnstagedSel] = useState<string[]>([])
  const [stagedSel, setStagedSel] = useState<string[]>([])
  const [fileAnchor, setFileAnchor] = useState<string | null>(null)
  const [diffs, setDiffs] = useState<FileDiff[]>([])
  const [split, setSplit] = useState(settings?.diffMode === 'split')
  const [msg, setMsg] = useState('')
  const [amend, setAmend] = useState(false)
  const [aiBusy, setAiBusy] = useState(false)
  const [planBusy, setPlanBusy] = useState(false)
  const [analysis, setAnalysis] = useState<ChangeAnalysis | null>(null)
  const [drafts, setDrafts] = useState<DraftCommit[]>([])
  const [refCommits, setRefCommits] = useState<CommitInfo[] | null>(null)
  const [tree, setTree] = useState<FileTreeNode[]>([])
  const [filesW, setFilesW] = useState(settings?.changesListWidth ?? 280)
  const [splitRatio, setSplitRatio] = useState(settings?.changesSplit ?? 0.55)
  const [detailsH, setDetailsH] = useState(settings?.detailsHeight ?? 260)
  const [commitH, setCommitH] = useState(settings?.commitBoxHeight ?? 168)
  const provider = (settings?.aiProvider || 'free') as AiProviderId
  const model = defaultModelFor(provider, settings)
  const modelChoices = modelOptions(catalogs[provider], model)

  const changesCount = snap.status.stagedCount + snap.status.unstagedCount
  const showingChanges = sel.kind === 'changes'
  const scopeRef = sel.kind === 'branch' || sel.kind === 'remote' || sel.kind === 'tag' ? sel.name : ''

  useEffect(() => {
    const onView = (e: Event) => {
      const d = (e as CustomEvent).detail
      if (d === 'changes') setSel({ kind: 'changes' })
      if (d === 'commits') setSel({ kind: 'all' })
    }
    document.addEventListener('spoon-view', onView)
    return () => document.removeEventListener('spoon-view', onView)
  }, [])

  useEffect(() => {
    if (!scopeRef) {
      setRefCommits(null)
      return
    }
    let cancel = false
    setRefCommits(null)
    void window.spoon.git.commits(path, 300, [scopeRef]).then((list) => {
      if (!cancel) setRefCommits(list as CommitInfo[])
    })
    return () => {
      cancel = true
    }
  }, [path, scopeRef, snap.commits.length])

  const visibleCommits = useMemo(() => {
    const list = scopeRef ? refCommits ?? [] : snap.commits
    if (!search.trim()) return list
    const q = search.toLowerCase()
    return list.filter(
      (c) => c.subject.toLowerCase().includes(q) || c.hash.startsWith(q) || c.author.toLowerCase().includes(q)
    )
  }, [snap.commits, scopeRef, refCommits, search])

  useEffect(() => {
    if (!showingChanges) return
    const opts = file
      ? { path: file, staged: stagedFocus, ignoreWhitespace: settings?.ignoreWhitespace }
      : { staged: stagedFocus, ignoreWhitespace: settings?.ignoreWhitespace }
    void window.spoon.git.diff(path, opts).then((d) => setDiffs(d as FileDiff[]))
  }, [path, file, stagedFocus, showingChanges, snap.status.stagedCount, snap.status.unstagedCount, settings?.ignoreWhitespace])

  useEffect(() => {
    const unstaged = new Set(
      (settings?.hideUntracked ? snap.status.unstaged.filter((f) => !f.untracked) : snap.status.unstaged).map((f) => f.path)
    )
    const staged = new Set(snap.status.staged.map((f) => f.path))
    setUnstagedSel((prev) => prev.filter((p) => unstaged.has(p)))
    setStagedSel((prev) => prev.filter((p) => staged.has(p)))
  }, [snap.status.unstaged, snap.status.staged, settings?.hideUntracked])

  useEffect(() => {
    if (detailTab === 'changes' && commit) {
      void window.spoon.git.diff(path, { commit: commit.hash }).then((d) => setDiffs(d as FileDiff[]))
    }
    if (detailTab === 'tree' && commit) {
      void window.spoon.git.tree(path, commit.hash).then((t) => setTree(t as FileTreeNode[]))
    }
  }, [detailTab, commit, path])

  async function doStage(list: string[], unstage = false) {
    if (unstage) await window.spoon.git.unstage(path, list)
    else await window.spoon.git.stage(path, list)
    onReload()
  }

  async function doCommit(pushAfter: boolean) {
    if (!msg.trim() && !amend) return
    onBusy(true)
    await catchErr(async () => {
      await window.spoon.git.commit(path, { message: msg.trim() || snap.commits[0]?.subject || 'Update', amend })
      if (pushAfter) {
        await pushHead(path, snap)
        document.dispatchEvent(new CustomEvent('spoon-confetti'))
      }
      setMsg('')
      setAmend(false)
      onReload()
    })
    onBusy(false)
  }

  async function aiFill(andGo: 'fill' | 'commit' | 'commit-push') {
    setAiBusy(true)
    await catchErr(async () => {
      if (andGo !== 'fill' && !snap.status.stagedCount) await window.spoon.git.stageAll(path)
      let text = msg.trim()
      if (andGo === 'fill' || !text) {
        const stagedPatch = (await window.spoon.git.stagedPatch(path)) as string
        const patch = stagedPatch.trim() ? stagedPatch : ((await window.spoon.git.workingPatch(path)) as string)
        text = (await window.spoon.ai.generate(provider, patch, undefined, model)) as string
        setMsg(text)
      }
      if (andGo === 'fill') return
      await window.spoon.git.commit(path, { message: text, amend })
      if (andGo === 'commit-push') {
        await pushHead(path, snap)
        document.dispatchEvent(new CustomEvent('spoon-confetti'))
      }
      setMsg('')
      setAmend(false)
      onReload()
    })
    setAiBusy(false)
  }

  async function runAnalysis() {
    setSel({ kind: 'changes' })
    setPlanBusy(true)
    await catchErr(async () => {
      const result = (await window.spoon.ai.analyze(path, provider, model)) as ChangeAnalysis
      setAnalysis(result)
      setDrafts(
        result.commits.map((commit, index) => ({
          key: `${index}-${commit.subject}`,
          subject: commit.subject,
          body: commit.body,
          files: commit.files,
          rationale: commit.rationale,
          include: true
        }))
      )
    })
    setPlanBusy(false)
  }

  async function createPlannedCommits() {
    const chosen = drafts.filter((item) => item.include && item.subject.trim() && item.files.length)
    if (!chosen.length) return
    if (snap.status.merging || snap.status.rebasing || snap.status.cherryPicking) {
      await window.spoon.app.error('Finish the merge, rebase, or cherry-pick before creating commits.')
      return
    }
    const ok = await window.spoon.app.confirm(
      `Create ${chosen.length} local commit${chosen.length === 1 ? '' : 's'}?`,
      `${chosen.map((item) => item.subject).join('\n')}\n\nNothing is pushed. Each commit includes the whole file.`
    )
    if (!ok) return
    onBusy(true)
    await catchErr(async () => {
      await window.spoon.git.unstageAll(path)
      for (const item of chosen) {
        await window.spoon.git.stage(path, item.files)
        const message = item.body.trim() ? `${item.subject.trim()}\n\n${item.body.trim()}` : item.subject.trim()
        await window.spoon.git.commit(path, { message })
      }
      setAnalysis(null)
      setDrafts([])
      setMsg('')
      onReload()
    })
    onBusy(false)
  }

  useEffect(() => {
    const c = () => void doCommit(false)
    const cp = () => void doCommit(true)
    const fill = () => void aiFill('fill')
    const ai = () => void aiFill('commit')
    const aip = () => void aiFill('commit-push')
    const an = () => void runAnalysis()
    document.addEventListener('spoon-commit', c)
    document.addEventListener('spoon-commit-push', cp)
    document.addEventListener('spoon-ai-fill', fill)
    document.addEventListener('spoon-ai-commit', ai)
    document.addEventListener('spoon-ai-commit-push', aip)
    document.addEventListener('spoon-analyze', an)
    return () => {
      document.removeEventListener('spoon-commit', c)
      document.removeEventListener('spoon-commit-push', cp)
      document.removeEventListener('spoon-ai-fill', fill)
      document.removeEventListener('spoon-ai-commit', ai)
      document.removeEventListener('spoon-ai-commit-push', aip)
      document.removeEventListener('spoon-analyze', an)
    }
  }, [path, msg, amend, snap, provider, model])

  function pulsePath(hash: string, list: CommitInfo[]) {
    const byHash = new Map(list.map((c) => [c.hash, c]))
    const hashes: string[] = []
    const seen = new Set<string>()
    let h: string | undefined = hash
    while (h && !seen.has(h)) {
      seen.add(h)
      hashes.push(h)
      h = byHash.get(h)?.parents[0]
    }
    setPulseHashes(hashes)
    setPulseKey(Date.now())
  }

  function clickLocalBranch(b: BranchInfo) {
    setFocusBranch(b.name)
    pulsePath(b.hash, snap.commits)
    if (sel.kind !== 'all') setSel({ kind: 'branch', name: b.name })
  }

  function clickRemoteBranch(b: BranchInfo) {
    setFocusBranch(b.name)
    pulsePath(b.hash, snap.commits)
    if (sel.kind !== 'all') setSel({ kind: 'remote', name: b.name })
  }

  function branchCtx(b: BranchInfo) {
    openMenu(
      [
        { id: 'new', label: 'New branch…' },
        { type: 'separator' },
        { id: `co:${b.name}`, label: 'Checkout' },
        { id: `merge:${b.name}`, label: 'Merge into current' },
        { id: `rebase:${b.name}`, label: 'Rebase current onto…' },
        { type: 'separator' },
        { id: `ren:${b.name}`, label: 'Rename…' },
        { id: `del:${b.name}`, label: 'Delete…' }
      ],
      (s) => {
        void catchErr(async () => {
          if (s === 'new') onOverlay({ type: 'branch' })
          if (s.startsWith('co:')) await window.spoon.git.checkout(path, s.slice(3))
          if (s.startsWith('merge:')) onOverlay({ type: 'merge', ref: s.slice(6) })
          if (s.startsWith('rebase:')) onOverlay({ type: 'rebase', ref: s.slice(7) })
          if (s.startsWith('ren:')) onOverlay({ type: 'rename', from: s.slice(4) })
          if (s.startsWith('del:')) {
            const ok = await window.spoon.app.confirm(`Delete branch ${s.slice(4)}?`)
            if (ok) await window.spoon.git.deleteBranch(path, s.slice(4), true)
          }
          onReload()
        })
      }
    )
  }

  function remoteCtx(name: string) {
    const url = snap.remotes.find((r) => r.name === name)?.url ?? ''
    openMenu(
      [
        { id: 'add', label: 'Add remote…' },
        { id: 'edit', label: 'Edit URL…' },
        { id: 'rename', label: 'Rename…' },
        { id: 'fetch', label: 'Fetch' },
        { type: 'separator' },
        { id: 'remove', label: 'Remove remote…' }
      ],
      (s) => {
        void catchErr(async () => {
          if (s === 'add') onOverlay({ type: 'remote' })
          if (s === 'edit') onOverlay({ type: 'remote-edit', name, url })
          if (s === 'rename') onOverlay({ type: 'remote-rename', from: name })
          if (s === 'fetch') await window.spoon.git.fetch(path, { remote: name, prune: true })
          if (s === 'remove') {
            const ok = await window.spoon.app.confirm(`Remove remote ${name}?`)
            if (ok) await window.spoon.git.removeRemote(path, name)
          }
          onReload()
        })
      }
    )
  }

  function selectFiles(target: string, staged: boolean, keys: { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean }) {
    const rows = staged
      ? snap.status.staged
      : settings?.hideUntracked
        ? snap.status.unstaged.filter((f) => !f.untracked)
        : snap.status.unstaged
    const paths = rows.map((f) => f.path)
    setStagedFocus(staged)
    setFile(target)
    const apply = staged ? setStagedSel : setUnstagedSel
    if (keys.shiftKey && fileAnchor && paths.includes(fileAnchor)) {
      const a = paths.indexOf(fileAnchor)
      const b = paths.indexOf(target)
      if (a >= 0 && b >= 0) {
        const lo = Math.min(a, b)
        const hi = Math.max(a, b)
        apply(paths.slice(lo, hi + 1))
        return
      }
    }
    if (keys.ctrlKey || keys.metaKey) {
      apply((prev) => (prev.includes(target) ? prev.filter((p) => p !== target) : [...prev, target]))
      setFileAnchor(target)
      return
    }
    apply([target])
    setFileAnchor(target)
  }

  function fileMenu(entry: StatusEntry, staged: boolean) {
    const current = staged ? stagedSel : unstagedSel
    const paths = current.includes(entry.path) ? current : [entry.path]
    if (!current.includes(entry.path)) {
      if (staged) setStagedSel([entry.path])
      else setUnstagedSel([entry.path])
      setFile(entry.path)
      setStagedFocus(staged)
      setFileAnchor(entry.path)
    }
    const n = paths.length
    openMenu(
      [
        { id: 'stage', label: staged ? (n > 1 ? `Unstage ${n} files` : 'Unstage') : n > 1 ? `Stage ${n} files` : 'Stage' },
        { id: 'discard', label: n > 1 ? `Discard ${n} files…` : 'Discard changes…' },
        { type: 'separator' },
        { id: 'blame', label: 'Blame' },
        { id: 'history', label: 'History' }
      ],
      (id) => {
        void catchErr(async () => {
          if (id === 'stage') await doStage(paths, staged)
          if (id === 'discard') {
            const ok = await window.spoon.app.confirm(
              n > 1 ? `Discard changes in ${n} files?` : `Discard changes in ${entry.path}?`
            )
            if (ok) await window.spoon.git.discard(path, paths)
          }
          if (id === 'blame') onOverlay({ type: 'blame', file: entry.path })
          if (id === 'history') onOverlay({ type: 'history', file: entry.path })
          onReload()
        })
      }
    )
  }

  const local = snap.branches.filter((b) => !b.remote)
  const remotes = snap.branches.filter((b) => b.remote)
  const q = filter.toLowerCase()
  const match = (n: string) => !q || n.toLowerCase().includes(q)
  const remoteGroups = [...remotes.reduce((map, b) => {
    if (b.name.endsWith('/HEAD')) return map
    const remote = b.name.includes('/') ? b.name.slice(0, b.name.indexOf('/')) : b.name
    const list = map.get(remote) ?? []
    list.push(b)
    map.set(remote, list)
    return map
  }, new Map<string, BranchInfo[]>())]
  const groupedRemotes = new Set(remoteGroups.map(([name]) => name))
  for (const remote of snap.remotes) {
    if (!groupedRemotes.has(remote.name)) remoteGroups.push([remote.name, []])
  }

  async function openSubmodule(rel: string, status: string) {
    const dest = joinRepoPath(path, rel)
    await catchErr(async () => {
      const ready = await window.spoon.git.isRepo(dest)
      if (status === 'uninitialized' || !ready) {
        const ok = await window.spoon.app.confirm(`Initialize submodule "${rel}" and open it?`)
        if (!ok) return
        await window.spoon.git.submoduleUpdate(path, rel)
      }
      onOpen(dest, rel.split(/[\\/]/).pop())
    })
  }

  return (
    <>
      <div className="sidebar" style={{ width: sidebarW }}>
        <div className="sidebar-head">
          {snap.status.name}
          <span className="hint">{snap.identity.name}</span>
        </div>
        <div
          className={`side-item ${sel.kind === 'changes' ? 'active' : ''}`}
          onClick={() => setSel({ kind: 'changes' })}
        >
          <IcoChanges /> Changes {changesCount ? <span className="counter">({changesCount})</span> : null}
        </div>
        <div
          className={`side-item ${sel.kind === 'all' ? 'active' : ''}`}
          onClick={() => {
            setSel({ kind: 'all' })
            setFocusBranch(null)
          }}
        >
          All Commits
        </div>
        <div className="side-filter">
          <input placeholder="Filter" value={filter} onChange={(e) => setFilter(e.target.value)} />
        </div>
        <div className="side-scroll">
          <div className="side-sec">Current</div>
          {local
            .filter((b) => b.current)
            .map((b) => (
              <div
                key={b.fullName}
                className={`side-item ${(sel.kind === 'branch' && sel.name === b.name) || focusBranch === b.name ? 'active' : ''}`}
                onClick={() => clickLocalBranch(b)}
                onDoubleClick={() => void window.spoon.git.checkout(path, b.name).then(onReload)}
                onContextMenu={(e) => {
                  e.preventDefault()
                  branchCtx(b)
                }}
              >
                <span className="dot-check">✓</span>
                <span className="label">{b.name}</span>
              </div>
            ))}
          <div
            className="side-sec"
            onContextMenu={(e) => {
              e.preventDefault()
              openMenu([{ id: 'new', label: 'New branch…' }], (id) => {
                if (id === 'new') onOverlay({ type: 'branch' })
              })
            }}
          >
            Local branches
            <button className="sec-add" title="New branch" onClick={() => onOverlay({ type: 'branch' })}>
              +
            </button>
          </div>
          {local.filter((b) => match(b.name) && !b.current).map((b) => (
            <div
              key={b.fullName}
              className={`side-item ${(sel.kind === 'branch' && sel.name === b.name) || focusBranch === b.name ? 'active' : ''}`}
              onClick={() => clickLocalBranch(b)}
              onDoubleClick={() => void window.spoon.git.checkout(path, b.name).then(onReload)}
              onContextMenu={(e) => {
                e.preventDefault()
                branchCtx(b)
              }}
            >
              <IcoBranch />
              <span className="label">{b.name}</span>
              {b.ahead || b.behind ? (
                <span className="ahead">
                  {b.ahead ? `↑${b.ahead}` : ''} {b.behind ? `↓${b.behind}` : ''}
                </span>
              ) : null}
            </div>
          ))}
          {!local.filter((b) => !b.current).length && <div className="empty">No other local branches</div>}
          <div
            className="side-sec"
            onContextMenu={(e) => {
              e.preventDefault()
              openMenu([{ id: 'add', label: 'Add remote…' }], (id) => {
                if (id === 'add') onOverlay({ type: 'remote' })
              })
            }}
          >
            Remote branches
            <button className="sec-add" title="Add remote" onClick={() => onOverlay({ type: 'remote' })}>
              +
            </button>
          </div>
          {remoteGroups.length ? (
            remoteGroups.map(([remote, branches]) => (
              <div key={remote}>
                <div
                  className="side-sec sub"
                  onContextMenu={(e) => {
                    e.preventDefault()
                    remoteCtx(remote)
                  }}
                >
                  <IcoRemote /> {remote}
                </div>
                {branches.filter((b) => match(b.name)).map((b) => {
                  const short = b.name.includes('/') ? b.name.slice(b.name.indexOf('/') + 1) : b.name
                  return (
                    <div
                      key={b.fullName}
                      className={`side-item indent ${(sel.kind === 'remote' && sel.name === b.name) || focusBranch === b.name ? 'active' : ''}`}
                      onClick={() => clickRemoteBranch(b)}
                      onDoubleClick={() => void window.spoon.git.checkout(path, short, true).then(onReload)}
                      onContextMenu={(e) => {
                        e.preventDefault()
                        remoteCtx(remote)
                      }}
                    >
                      <IcoBranch />
                      <span className="label">{short}</span>
                    </div>
                  )
                })}
              </div>
            ))
          ) : (
            <div className="empty">Fetch to see remote branches</div>
          )}
          <div className="side-sec">Tags</div>
          {snap.tags.filter((t) => match(t.name)).map((t) => (
            <div key={t.name} className="side-item" onClick={() => setSel({ kind: 'tag', name: t.name })}>
              <IcoTag />
              <span className="label">{t.name}</span>
            </div>
          ))}
          <div className="side-sec">Stashes</div>
          {snap.stashes.map((s) => (
            <div
              key={s.selector}
              className="side-item"
              onClick={() => setSel({ kind: 'stash', selector: s.selector })}
              onDoubleClick={() => void window.spoon.git.stashApply(path, s.selector, false).then(onReload)}
            >
              <span className="label">{s.message}</span>
            </div>
          ))}
          <div className="side-sec">Submodules</div>
          {snap.submodules.map((s) => (
            <div
              key={s.path}
              className="side-item"
              title="Open this submodule in a tab"
              onClick={() => void openSubmodule(s.path, s.status)}
            >
              <span className="label">{s.path}</span>
              {s.status !== 'ok' && <span className="sub-st">{s.status}</span>}
            </div>
          ))}
          {!snap.submodules.length && <div className="empty">No submodules</div>}
        </div>
      </div>
      <div
        className="splitbar x"
        onPointerDown={(e) =>
          bindDrag(
            e,
            'x',
            (x) => onSidebar(clamp(x, 160, 560)),
            (x) => onSidebarEnd(clamp(x, 160, 560))
          )
        }
      />

      <div className="main">
        {snap.status.merging || snap.status.rebasing || snap.status.cherryPicking ? (
          <div className="banner">
            {snap.status.merging && 'Merge in progress'}
            {snap.status.rebasing && 'Rebase in progress'}
            {snap.status.cherryPicking && 'Cherry-pick in progress'}
            {snap.status.conflicted.length ? ` — ${snap.status.conflicted.length} conflicted file(s)` : ''}
            <button className="ghost" onClick={() => snap.status.conflicted[0] && onOverlay({ type: 'conflict', file: snap.status.conflicted[0].path })}>
              Resolve
            </button>
            <button className="ghost" onClick={() => void window.spoon.git.continueMerge(path).then(onReload)}>
              Continue
            </button>
            <button className="ghost" onClick={() => void (snap.status.rebasing ? window.spoon.git.rebaseAbort(path) : window.spoon.git.abortMerge(path)).then(onReload)}>
              Abort
            </button>
          </div>
        ) : null}

        {showingChanges ? (
          <div className="changes">
            <div className="file-cols" style={{ width: filesW }}>
              <FilePane
                title="Unstaged"
                action={unstagedSel.length > 1 ? `Stage ${unstagedSel.length}` : 'Stage'}
                onAction={() =>
                  void doStage(unstagedSel.length ? unstagedSel : snap.status.unstaged.map((f) => f.path))
                }
                files={settings?.hideUntracked ? snap.status.unstaged.filter((f) => !f.untracked) : snap.status.unstaged}
                selected={unstagedSel}
                onSelect={(p, keys) => selectFiles(p, false, keys)}
                onSelectAll={() => {
                  const rows = settings?.hideUntracked
                    ? snap.status.unstaged.filter((f) => !f.untracked)
                    : snap.status.unstaged
                  setUnstagedSel(rows.map((f) => f.path))
                  setStagedFocus(false)
                }}
                onContext={(entry) => fileMenu(entry, false)}
                flex={splitRatio}
              />
              <div
                className="splitbar y"
                onPointerDown={(e) => {
                  const parent = e.currentTarget.parentElement
                  if (!parent) return
                  const rect = parent.getBoundingClientRect()
                  bindDrag(
                    e,
                    'y',
                    (y) => setSplitRatio(clamp((y - rect.top) / rect.height, 0.18, 0.82)),
                    (y) => {
                      const next = clamp((y - rect.top) / rect.height, 0.18, 0.82)
                      setSplitRatio(next)
                      onPatchSettings({ changesSplit: next })
                    }
                  )
                }}
              />
              <FilePane
                title="Staged"
                action={stagedSel.length > 1 ? `Unstage ${stagedSel.length}` : 'Unstage'}
                onAction={() => void doStage(stagedSel.length ? stagedSel : snap.status.staged.map((f) => f.path), true)}
                files={snap.status.staged}
                selected={stagedSel}
                onSelect={(p, keys) => selectFiles(p, true, keys)}
                onSelectAll={() => {
                  setStagedSel(snap.status.staged.map((f) => f.path))
                  setStagedFocus(true)
                }}
                onContext={(entry) => fileMenu(entry, true)}
                flex={1 - splitRatio}
              />
            </div>
            <div
              className="splitbar x"
              onPointerDown={(e) => {
                const parent = e.currentTarget.parentElement
                if (!parent) return
                const rect = parent.getBoundingClientRect()
                bindDrag(
                  e,
                  'x',
                  (x) => setFilesW(clamp(x - rect.left, 180, 720)),
                  (x) => {
                    const next = clamp(x - rect.left, 180, 720)
                    setFilesW(next)
                    onPatchSettings({ changesListWidth: next })
                  }
                )
              }}
            />
            <div className="diff-col">
              <div className="diff-tools">
                <span className="diff-path">{file || 'Select a file'}</span>
                <span style={{ marginLeft: 'auto' }} />
                <button className="ghost" onClick={() => setSplit((v) => !v)}>
                  {split ? 'Unified' : 'Side by side'}
                </button>
              </div>
              <DiffView
                repo={path}
                diffs={file ? diffs.filter((d) => d.path === file || d.origPath === file) : diffs}
                split={split}
                onHunk={(h, mode) => file && void window.spoon.git.applyHunk(path, file, h, mode).then(onReload)}
              />
              {analysis && (
                <div className="analysis">
                  <div className="analysis-head">
                    <strong>Analysis</strong>
                    <span className="hint">Local commits only. Nothing is pushed.</span>
                    <button className="ghost" onClick={() => { setAnalysis(null); setDrafts([]) }}>
                      Close
                    </button>
                  </div>
                  <p className="analysis-summary">{analysis.summary}</p>
                  {drafts.map((item, index) => (
                    <div className="plan-card" key={item.key}>
                      <label className="check">
                        <input
                          type="checkbox"
                          checked={item.include}
                          onChange={(e) =>
                            setDrafts((rows) => rows.map((row, i) => (i === index ? { ...row, include: e.target.checked } : row)))
                          }
                        />
                        Commit {index + 1}
                      </label>
                      <input
                        value={item.subject}
                        onChange={(e) =>
                          setDrafts((rows) => rows.map((row, i) => (i === index ? { ...row, subject: e.target.value } : row)))
                        }
                      />
                      <textarea
                        value={item.body}
                        placeholder="Body"
                        onChange={(e) =>
                          setDrafts((rows) => rows.map((row, i) => (i === index ? { ...row, body: e.target.value } : row)))
                        }
                      />
                      <div className="hint">{item.rationale}</div>
                      <div className="plan-files">{item.files.join(', ')}</div>
                      <button className="ghost" onClick={() => setMsg(item.body.trim() ? `${item.subject}\n\n${item.body.trim()}` : item.subject)}>
                        Use message
                      </button>
                    </div>
                  ))}
                  <div className="row-btns">
                    <button className="primary" disabled={!drafts.some((item) => item.include)} onClick={() => void createPlannedCommits()}>
                      Create {drafts.filter((item) => item.include).length} commits
                    </button>
                  </div>
                </div>
              )}
              <div
                className="splitbar y"
                onPointerDown={(e) => {
                  const parent = e.currentTarget.parentElement
                  if (!parent) return
                  const rect = parent.getBoundingClientRect()
                  bindDrag(
                    e,
                    'y',
                    (y) => setCommitH(clamp(rect.bottom - y, 120, 520)),
                    (y) => {
                      const next = clamp(rect.bottom - y, 120, 520)
                      setCommitH(next)
                      onPatchSettings({ commitBoxHeight: next })
                    }
                  )
                }}
              />
              <div className="commit-box" style={{ height: commitH }}>
                <textarea
                  placeholder="Commit message"
                  value={msg}
                  onChange={(e) => setMsg(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) e.preventDefault()
                  }}
                />
                <div className="commit-bar">
                  <label className="check">
                    <input type="checkbox" checked={amend} onChange={(e) => setAmend(e.target.checked)} /> Amend
                  </label>
                  <span className="hint">{msg.split('\n')[0]?.length || 0}/72</span>
                  <select
                    className="model-select"
                    value={model}
                    title="AI model"
                    onChange={(e) =>
                      onPatchSettings({
                        aiModels: { ...(settings?.aiModels ?? DEFAULT_AI_MODELS), [provider]: e.target.value }
                      })
                    }
                  >
                    {modelChoices.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.label}
                      </option>
                    ))}
                  </select>
                  <div className="commit-actions">
                    <button className="ghost" disabled={aiBusy} onClick={() => void aiFill('fill')}>
                      {aiBusy ? 'Writing…' : 'AI message'}
                    </button>
                    <button className="ghost" disabled={planBusy} onClick={() => void runAnalysis()}>
                      {planBusy ? 'Analyzing…' : 'Analyze'}
                    </button>
                    <button className="primary" disabled={!snap.status.stagedCount && !amend} onClick={() => void doCommit(false)}>
                      Commit {snap.status.stagedCount}
                    </button>
                    <button className="primary ai" disabled={aiBusy} onClick={() => void aiFill('commit')}>
                      AI commit
                    </button>
                    <button className="ghost" onClick={() => void doCommit(true)}>
                      Commit & push
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        ) : sel.kind === 'stash' ? (
          <StashView
            stash={snap.stashes.find((s) => s.selector === sel.selector)}
            onApply={(pop) => void catchErr(async () => { await window.spoon.git.stashApply(path, sel.selector, pop); onReload() })}
            onDrop={() =>
              void catchErr(async () => {
                const current = snap.stashes.find((s) => s.selector === sel.selector)
                const ok = await window.spoon.app.confirm(`Drop stash "${current?.message ?? sel.selector}"?`)
                if (!ok) return
                await window.spoon.git.stashDrop(path, sel.selector)
                setSel({ kind: 'all' })
                onReload()
              })
            }
          />
        ) : (
          <>
            <div className="commit-search">
              <input
                placeholder={scopeRef ? `Commits in ${scopeRef}` : 'Search commits'}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <button className="ghost" onClick={() => onOverlay({ type: 'ir' })}>
                Interactive Rebase
              </button>
              <button className="ghost" onClick={() => onOverlay({ type: 'reflog' })}>
                Reflog
              </button>
            </div>
            {scopeRef && !refCommits ? (
              <div className="empty">Loading commits…</div>
            ) : (
            <VirtualCommits
              commits={visibleCommits}
              selected={commit?.hash}
              showAvatar={settings?.showAvatars !== false}
              pulseKey={pulseKey}
              pulseHashes={pulseHashes}
              onSelect={setCommit}
              onContext={(c, e) => {
                e.preventDefault()
                openMenu(
                  [
                    { id: `co:${c.hash}`, label: 'Checkout' },
                    { id: `ch:${c.hash}`, label: 'Cherry-pick' },
                    { id: `rv:${c.hash}`, label: 'Revert' },
                    { type: 'separator' },
                    { id: `rs:${c.hash}`, label: 'Reset mixed…' },
                    { id: `rh:${c.hash}`, label: 'Reset hard…' },
                    { id: `cp:${c.hash}`, label: 'Copy SHA' },
                    { id: `tg:${c.hash}`, label: 'Create tag…' }
                  ],
                  (s) => {
                    void catchErr(async () => {
                      if (s.startsWith('co:')) await window.spoon.git.checkout(path, s.slice(3))
                      if (s.startsWith('ch:')) await window.spoon.git.cherryPick(path, [s.slice(3)])
                      if (s.startsWith('rv:')) await window.spoon.git.revert(path, [s.slice(3)])
                      if (s.startsWith('rs:')) {
                        const ok = await window.spoon.app.confirm('Reset mixed to this commit?', 'Keeps your file changes and unstages them.')
                        if (ok) await window.spoon.git.reset(path, s.slice(3), 'mixed')
                      }
                      if (s.startsWith('rh:')) {
                        const ok = await window.spoon.app.confirm('Hard reset to this commit?', 'Discards uncommitted changes.')
                        if (ok) await window.spoon.git.reset(path, s.slice(3), 'hard')
                      }
                      if (s.startsWith('cp:')) await window.spoon.app.copy(s.slice(3))
                      if (s.startsWith('tg:')) onOverlay({ type: 'tag' })
                      onReload()
                    })
                  }
                )
              }}
            />
            )}
            {commit && (
              <div
                className="splitbar y"
                onPointerDown={(e) =>
                  bindDrag(
                    e,
                    'y',
                    (y) => setDetailsH(clamp(window.innerHeight - y, 140, Math.round(window.innerHeight * 0.75))),
                    (y) => {
                      const next = clamp(window.innerHeight - y, 140, Math.round(window.innerHeight * 0.75))
                      setDetailsH(next)
                      onPatchSettings({ detailsHeight: next })
                    }
                  )
                }
              />
            )}
            {commit && (
              <div className="details" style={{ height: detailsH, flex: '0 0 auto' }}>
                <div className="detail-tabs">
                  {(['commit', 'changes', 'tree'] as const).map((t) => (
                    <button key={t} className={detailTab === t ? 'active' : ''} onClick={() => setDetailTab(t)}>
                      {t === 'commit' ? 'Commit' : t === 'changes' ? 'Changes' : 'File Tree'}
                    </button>
                  ))}
                </div>
                <div className="detail-body">
                  {detailTab === 'commit' && <CommitDetails c={commit} />}
                  {detailTab === 'changes' && <DiffView repo={path} rev={commit.hash} diffs={diffs} split={split} />}
                  {detailTab === 'tree' && (
                    <FileTree
                      nodes={tree}
                      onHistory={(f) => onOverlay({ type: 'history', file: f })}
                      onBlame={(f) => onOverlay({ type: 'blame', file: f, rev: commit.hash })}
                    />
                  )}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </>
  )
}

function fileMark(f: StatusEntry): string {
  if (f.conflict) return 'U'
  if (f.untracked) return '?'
  const index = String(f.index)
  if (index !== ' ' && index !== '.') return index
  return String(f.worktree)
}

function FilePane({
  title,
  action,
  onAction,
  files,
  selected,
  onSelect,
  onSelectAll,
  onContext,
  flex = 1
}: {
  title: string
  action: string
  onAction: () => void
  files: StatusEntry[]
  selected: string[]
  onSelect: (p: string, keys: { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean }) => void
  onSelectAll?: () => void
  onContext?: (file: StatusEntry) => void
  flex?: number
}) {
  return (
    <div className="file-pane" style={{ flex: `${flex} 1 0` }}>
      <div className="file-head">
        <span className="label">
          {title}
          {selected.length > 1 ? <span className="counter">({selected.length})</span> : null}
        </span>
        <button onClick={onAction}>{action}</button>
      </div>
      <div
        className="file-list"
        tabIndex={0}
        onKeyDown={(e) => {
          if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
            e.preventDefault()
            onSelectAll?.()
          }
        }}
      >
        {files.map((f) => (
          <div
            key={f.path}
            className={`file-row ${selected.includes(f.path) ? 'sel' : ''}`}
            onClick={(e) => onSelect(f.path, e)}
            onContextMenu={(e) => {
              e.preventDefault()
              onContext?.(f)
            }}
          >
            <span className="badge">{fileMark(f)}</span>
            <span className="nm" title={f.path}>
              <span className="base">{fileName(f.path)}</span>
              {parentDir(f.path) ? <span className="dir">{parentDir(f.path)}</span> : null}
            </span>
          </div>
        ))}
        {!files.length && <div className="empty">No files</div>}
      </div>
    </div>
  )
}

function StashView({
  stash,
  onApply,
  onDrop
}: {
  stash?: StashInfo
  onApply: (pop: boolean) => void
  onDrop: () => void
}) {
  if (!stash) return <div className="empty">That stash is no longer in the list.</div>
  return (
    <div className="stash-view">
      <h2>{stash.message}</h2>
      <p className="hint">
        {stash.selector} · {formatDate(stash.date)}
      </p>
      <div className="row-btns">
        <button className="primary" onClick={() => onApply(false)}>
          Apply
        </button>
        <button className="ghost" onClick={() => onApply(true)}>
          Pop
        </button>
        <button className="ghost" onClick={onDrop}>
          Drop
        </button>
      </div>
    </div>
  )
}

function DiffView({
  repo,
  rev,
  diffs,
  split,
  onHunk
}: {
  repo?: string
  rev?: string
  diffs: FileDiff[]
  split: boolean
  onHunk?: (h: DiffHunk, mode: 'stage' | 'unstage' | 'discard') => void
}) {
  if (!diffs.length) return <div className="empty">No diff</div>
  return (
    <div className="diff-view">
      {diffs.map((d) => {
        const media = classifyMedia(d.path)
        return (
        <div key={d.path}>
          <div className="diff-tools">{d.path}</div>
          {media && repo ? (
            <MediaCompare repo={repo} file={d.path} origPath={d.origPath} rev={rev} />
          ) : d.binary ? (
            <div className="empty">Binary file. Spoon previews images, video, audio, and PDF.</div>
          ) : split ? (
            <div className="split">
              <div className="side">
                {d.hunks.flatMap((h) =>
                  h.lines
                    .filter((l) => l.type !== 'add')
                    .map((l, i) => (
                      <div key={`l${i}`} className={`diff-line ${l.type}`}>
                        <span className="n">{l.oldNo ?? ''}</span>
                        <span className="n" />
                        <span className="tx">{l.text}</span>
                      </div>
                    ))
                )}
              </div>
              <div className="side">
                {d.hunks.flatMap((h) =>
                  h.lines
                    .filter((l) => l.type !== 'del')
                    .map((l, i) => (
                      <div key={`r${i}`} className={`diff-line ${l.type}`}>
                        <span className="n" />
                        <span className="n">{l.newNo ?? ''}</span>
                        <span className="tx">{l.text}</span>
                      </div>
                    ))
                )}
              </div>
            </div>
          ) : (
            d.hunks.map((h, hi) => (
              <div key={hi}>
                {onHunk && (
                  <div style={{ display: 'flex', gap: 6, padding: '4px 8px' }}>
                    <button className="ghost" onClick={() => onHunk(h, 'stage')}>
                      Stage
                    </button>
                    <button className="ghost" onClick={() => onHunk(h, 'unstage')}>
                      Unstage
                    </button>
                    <button className="ghost" onClick={() => onHunk(h, 'discard')}>
                      Discard
                    </button>
                  </div>
                )}
                {h.lines.map((l, i) => (
                  <div key={i} className={`diff-line ${l.type}`}>
                    <span className="n">{l.oldNo ?? ''}</span>
                    <span className="n">{l.newNo ?? ''}</span>
                    <span className="tx">{l.text}</span>
                  </div>
                ))}
              </div>
            ))
          )}
        </div>
        )
      })}
    </div>
  )
}

function MediaCompare({
  repo,
  file,
  origPath,
  rev
}: {
  repo: string
  file: string
  origPath?: string
  rev?: string
}) {
  const [pair, setPair] = useState<MediaPair | null>(null)
  const [err, setErr] = useState('')
  useEffect(() => {
    let cancel = false
    setPair(null)
    setErr('')
    void window.spoon.git
      .preview(repo, file, { rev, origPath })
      .then((value) => {
        if (!cancel) setPair(value as MediaPair)
      })
      .catch((e: unknown) => {
        if (!cancel) setErr(e instanceof Error ? e.message : String(e))
      })
    return () => {
      cancel = true
    }
  }, [repo, file, origPath, rev])
  if (err) return <div className="empty">{err}</div>
  if (!pair) return <div className="empty">Loading preview…</div>
  return (
    <div className="media-preview">
      <MediaPane repo={repo} file={origPath || file} title={rev ? 'Parent' : 'HEAD'} side={pair.before} />
      <MediaPane repo={repo} file={file} title={rev ? 'This commit' : 'Working copy'} side={pair.after} />
    </div>
  )
}

function MediaPane({ repo, file, title, side }: { repo: string; file: string; title: string; side: MediaSide }) {
  const [failed, setFailed] = useState(false)
  const src = side.base64 ? `data:${side.mime};base64,${side.base64}` : ''
  return (
    <div className="media-pane">
      <div className="kv">
        {title}
        {side.bytes ? ` · ${formatBytes(side.bytes)}` : ''}
      </div>
      {side.missing ? (
        <div className="empty">Not in this version</div>
      ) : side.tooLarge || !src ? (
        <div className="empty">
          This file is too large to preview inline.
          <button className="ghost" onClick={() => void window.spoon.git.openFile(repo, file)}>
            Open
          </button>
        </div>
      ) : side.kind === 'image' ? (
        <img src={src} alt={title} />
      ) : side.kind === 'video' ? (
        <>
          <video src={src} controls onError={() => setFailed(true)} />
          {failed && <div className="hint">This video codec does not play inside Spoon. Open it externally.</div>}
        </>
      ) : side.kind === 'audio' ? (
        <audio src={src} controls onError={() => setFailed(true)} />
      ) : side.kind === 'pdf' ? (
        <iframe title={title} src={src} />
      ) : (
        <div className="empty">No preview for this file type.</div>
      )}
      {!side.missing && !side.tooLarge && (
        <button className="ghost" onClick={() => void window.spoon.git.openFile(repo, file)}>
          Open file
        </button>
      )}
    </div>
  )
}

function VirtualCommits({
  commits,
  selected,
  showAvatar,
  pulseKey,
  pulseHashes,
  onSelect,
  onContext
}: {
  commits: CommitInfo[]
  selected?: string
  showAvatar: boolean
  pulseKey: number
  pulseHashes: string[]
  onSelect: (c: CommitInfo) => void
  onContext: (c: CommitInfo, e: MouseEvent) => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [height, setHeight] = useState(400)
  const RH = 22
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(() => setHeight(el.clientHeight))
    ro.observe(el)
    setHeight(el.clientHeight)
    return () => ro.disconnect()
  }, [])
  const pad = 10
  const start = Math.max(0, Math.floor(scrollTop / RH) - pad)
  const end = Math.min(commits.length, start + Math.ceil(height / RH) + pad * 2)
  return (
    <div
      className="commit-list"
      ref={ref}
      onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
    >
      <div style={{ height: commits.length * RH, position: 'relative' }}>
        {commits.slice(start, end).map((c, i) => (
          <div key={c.hash} style={{ position: 'absolute', top: (start + i) * RH, left: 0, right: 0, height: RH }}>
            <CommitRow
              c={c}
              selected={selected === c.hash}
              showAvatar={showAvatar}
              pulse={pulseHashes.includes(c.hash)}
              pulseKey={pulseKey}
              onClick={() => onSelect(c)}
              onContext={(e) => onContext(c, e)}
            />
          </div>
        ))}
      </div>
    </div>
  )
}

const CommitRow = memo(function CommitRow({
  c,
  selected,
  showAvatar,
  pulse,
  pulseKey,
  onClick,
  onContext
}: {
  c: CommitInfo
  selected: boolean
  showAvatar: boolean
  pulse: boolean
  pulseKey: number
  onClick: () => void
  onContext: (e: MouseEvent) => void
}) {
  const laneCount = Math.min(c.maxLane, 12) + 1
  const w = Math.max(16, laneCount * 14)
  const x = (n: number) => 8 + Math.min(n, 12) * 14
  const ins = c.lanesIn?.length ? c.lanesIn : [c.lane]
  const outs = c.lanesOut?.length ? c.lanesOut : [c.lane]
  const lanes = new Set([...ins, ...outs, c.lane, ...(c.parentLanes ?? []), ...(c.mergeLanes ?? [])])
  return (
    <div className={`commit-row ${selected ? 'sel' : ''}`} onClick={onClick} onContextMenu={onContext} style={{ ['--graph-w' as string]: `${w}px` }}>
      <svg width={w} height={22} key={pulse ? pulseKey : 'g'}>
        {[...lanes].filter((n) => n <= 12).map((n) => {
          const y1 = ins.includes(n) ? 0 : 11
          const y2 = outs.includes(n) ? 22 : 11
          if (y1 === y2) return null
          return (
            <line
              key={`v${n}`}
              x1={x(n)}
              y1={y1}
              x2={x(n)}
              y2={y2}
              stroke={laneColor(n)}
              strokeWidth={pulse && n === c.lane ? 3 : 2}
              className={pulse && n === c.lane ? 'lane-pulse' : undefined}
            />
          )
        })}
        {(c.parentLanes ?? [])
          .filter((pl) => pl !== c.lane && pl <= 12)
          .map((pl) => (
            <path
              key={`p${pl}`}
              d={`M${x(c.lane)} 11 C ${x(c.lane)} 20, ${x(pl)} 2, ${x(pl)} 22`}
              fill="none"
              stroke={laneColor(pl)}
              strokeWidth="2"
              className={pulse ? 'lane-pulse' : undefined}
            />
          ))}
        {(c.mergeLanes ?? []).slice(0, 4).filter((ml) => ml <= 12).map((ml) => (
          <path
            key={`m${ml}`}
            d={`M${x(c.lane)} 11 C ${x(c.lane)} 20, ${x(ml)} 2, ${x(ml)} 22`}
            fill="none"
            stroke={laneColor(ml)}
            strokeWidth="2"
            className={pulse ? 'lane-pulse' : undefined}
          />
        ))}
        <circle
          cx={x(c.lane)}
          cy={11}
          r={4}
          fill={laneColor(c.lane)}
          stroke="#fff"
          strokeWidth="1"
          className={pulse ? 'dot-pulse' : undefined}
        />
      </svg>
      <div className="msg">
        {c.refs
          .filter((r) => r.type !== 'head')
          .slice(0, 2)
          .map((r) => (
            <span key={r.name + r.type} className={`ref-pill ${r.current ? 'current' : ''}`} style={{ borderColor: laneColor(c.lane) }}>
              {r.current ? '✓ ' : ''}
              {r.name}
            </span>
          ))}
        <span title={c.body}>{c.subject}</span>
      </div>
      <div className="meta" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        {showAvatar && (
          <span className="avatar" style={{ background: avatarColor(c.email) }} title={c.author}>
            {initials(c.author)}
          </span>
        )}
        {c.author}
      </div>
      <div className="meta">{c.shortHash}</div>
      <div className="meta">{formatDate(c.date)}</div>
    </div>
  )
})

function CommitDetails({ c }: { c: CommitInfo }) {
  return (
    <div>
      <div className="commit-meta">
        <div className="who">
          <span className="avatar big" style={{ background: avatarColor(c.email) }}>
            {initials(c.author)}
          </span>
          <div>
            <div className="kv">AUTHOR</div>
            <div>
              {c.author} &lt;{c.email}&gt;
            </div>
            <div className="hint">{formatDate(c.date)}</div>
          </div>
        </div>
        <div className="who">
          <span className="avatar big" style={{ background: avatarColor(c.committerEmail) }}>
            {initials(c.committer)}
          </span>
          <div>
            <div className="kv">COMMITTER</div>
            <div>
              {c.committer} &lt;{c.committerEmail}&gt;
            </div>
          </div>
        </div>
      </div>
      <div className="kv" style={{ marginTop: 12 }}>
        SHA <span className="hash" onClick={() => void window.spoon.app.copy(c.hash)}>{c.hash}</span>
      </div>
      <div className="kv">
        PARENTS{' '}
        {c.parents.map((p) => (
          <span key={p} className="hash">
            {p.slice(0, 7)}{' '}
          </span>
        ))}
      </div>
      <div className="subject">{c.subject}</div>
      {c.body ? <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit' }}>{c.body}</pre> : null}
    </div>
  )
}

function FileTree({
  nodes,
  onHistory,
  onBlame
}: {
  nodes: FileTreeNode[]
  onHistory: (f: string) => void
  onBlame: (f: string) => void
}) {
  const render = (n: FileTreeNode[], depth = 0): ReactNode =>
    n.map((node) => (
      <div key={node.path}>
        <div
          className="n"
          style={{ paddingLeft: 8 + depth * 12 }}
          onDoubleClick={() => node.type === 'file' && onHistory(node.path)}
          onContextMenu={(e) => {
            e.preventDefault()
            if (node.type === 'file') onBlame(node.path)
          }}
        >
          {node.type === 'dir' ? '▸' : '·'} {node.name}
        </div>
        {node.children ? render(node.children, depth + 1) : null}
      </div>
    ))
  return <div className="tree">{render(nodes)}</div>
}

function DialogHost({
  overlay,
  path,
  snap,
  settings,
  accounts,
  catalogs,
  onClose,
  onReload,
  onOpen,
  onSettings
}: {
  overlay: Overlay
  path?: string
  snap?: Snapshot
  settings: Settings | null
  accounts: AiAccount[]
  catalogs: Record<AiProviderId, AiModelCatalog>
  onClose: () => void
  onReload: () => void
  onOpen: (p: string, n?: string) => void
  onSettings: () => Promise<void>
}) {
  if (!overlay) return null
  if (overlay.type === 'settings')
    return <SettingsDialog accounts={accounts} settings={settings} catalogs={catalogs} onClose={onClose} onSaved={onSettings} />
  if (overlay.type === 'about')
    return (
      <Modal title="Spoon" onClose={onClose}>
        <p>A fast and friendly Git client for Windows.</p>
        <p>Commit messages can be written with Free AI, Grok, ChatGPT, Claude, or any OpenAI-compatible API. AI commit stays local unless you push yourself.</p>
        <div className="dialog-foot">
          <button className="primary" onClick={onClose}>
            OK
          </button>
        </div>
      </Modal>
    )
  if (overlay.type === 'clone') return <CloneDialog onClose={onClose} onOpen={onOpen} />
  if (overlay.type === 'init') return <InitDialog onClose={onClose} onOpen={onOpen} />
  if (overlay.type === 'branch' && path) return <FieldDialog title="New Branch" label="Name" onClose={onClose} onOk={async (name) => { await window.spoon.git.createBranch(path, name, true); onReload(); onClose() }} />
  if (overlay.type === 'rename' && path)
    return (
      <FieldDialog
        title={`Rename ${overlay.from}`}
        label="New name"
        initial={overlay.from}
        onClose={onClose}
        onOk={async (name) => {
          await window.spoon.git.renameBranch(path, overlay.from, name)
          onReload()
          onClose()
        }}
      />
    )
  if (overlay.type === 'tag' && path) return <FieldDialog title="Create Tag" label="Name" onClose={onClose} onOk={async (name) => { await window.spoon.git.createTag(path, name, name, snap?.commits[0]?.hash); onReload(); onClose() }} />
  if (overlay.type === 'stash' && path) return <FieldDialog title="Stash" label="Message" optional onClose={onClose} onOk={async (name) => { await window.spoon.git.stash(path, name || undefined); onReload(); onClose() }} />
  if (overlay.type === 'remote' && path)
    return (
      <RemoteDialog
        title="Add remote"
        action="Add"
        onClose={onClose}
        onOk={async (name, url) => {
          await window.spoon.git.addRemote(path, name, url)
          onReload()
          onClose()
        }}
      />
    )
  if (overlay.type === 'remote-edit' && path)
    return (
      <RemoteDialog
        title={`Edit ${overlay.name}`}
        action="Save"
        initialName={overlay.name}
        initialUrl={overlay.url}
        lockName
        onClose={onClose}
        onOk={async (_name, url) => {
          await window.spoon.git.setRemoteUrl(path, overlay.name, url)
          onReload()
          onClose()
        }}
      />
    )
  if (overlay.type === 'remote-rename' && path)
    return (
      <FieldDialog
        title={`Rename remote ${overlay.from}`}
        label="New name"
        initial={overlay.from}
        onClose={onClose}
        onOk={async (name) => {
          await window.spoon.git.renameRemote(path, overlay.from, name)
          onReload()
          onClose()
        }}
      />
    )
  if (overlay.type === 'merge' && path)
    return (
      <ConfirmOp
        title={`Merge ${overlay.ref}`}
        onClose={onClose}
        onOk={async () => {
          await window.spoon.git.merge(path, overlay.ref, true, false)
          onReload()
          onClose()
        }}
      />
    )
  if (overlay.type === 'rebase' && path)
    return (
      <ConfirmOp
        title={`Rebase onto ${overlay.ref}`}
        onClose={onClose}
        onOk={async () => {
          await window.spoon.git.rebase(path, overlay.ref)
          onReload()
          onClose()
        }}
      />
    )
  if (overlay.type === 'blame' && path) return <BlameDialog path={path} file={overlay.file} rev={overlay.rev} onClose={onClose} />
  if (overlay.type === 'history' && path) return <HistoryDialog path={path} file={overlay.file} onClose={onClose} />
  if (overlay.type === 'conflict' && path) return <ConflictDialog path={path} file={overlay.file} onClose={onClose} onReload={onReload} />
  if (overlay.type === 'ir' && path) return <RebaseDialog path={path} onClose={onClose} onReload={onReload} />
  if (overlay.type === 'reflog' && path) return <ReflogDialog path={path} onClose={onClose} />
  if (overlay.type === 'device')
    return (
      <Modal title="Sign in with Grok" onClose={onClose}>
        <p>Open the browser and enter this code:</p>
        <h2>{overlay.userCode}</h2>
        <p className="hint">{overlay.url}</p>
      </Modal>
    )
  return null
}

function Modal({
  title,
  onClose,
  children,
  wide,
  className
}: {
  title: string
  onClose: () => void
  children: ReactNode
  wide?: boolean
  className?: string
}) {
  return (
    <div className="dialog-back" onMouseDown={onClose}>
      <div className={`dialog ${wide ? 'wide' : ''} ${className ?? ''}`.trim()} onMouseDown={(e) => e.stopPropagation()}>
        <div className="dialog-head">
          <h2>{title}</h2>
        </div>
        <div className="dialog-body">{children}</div>
      </div>
    </div>
  )
}

function FieldDialog({
  title,
  label,
  optional,
  initial = '',
  onClose,
  onOk
}: {
  title: string
  label: string
  optional?: boolean
  initial?: string
  onClose: () => void
  onOk: (v: string) => Promise<void>
}) {
  const [v, setV] = useState(initial)
  return (
    <Modal title={title} onClose={onClose}>
      <label>{label}</label>
      <input autoFocus value={v} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void onOk(v)} />
      <div className="dialog-foot">
        <button className="ghost" onClick={onClose}>
          Cancel
        </button>
        <button className="primary" disabled={!optional && !v.trim()} onClick={() => void onOk(v.trim())}>
          OK
        </button>
      </div>
    </Modal>
  )
}

function ConfirmOp({ title, onClose, onOk }: { title: string; onClose: () => void; onOk: () => Promise<void> }) {
  return (
    <Modal title={title} onClose={onClose}>
      <p>Continue?</p>
      <div className="dialog-foot">
        <button className="ghost" onClick={onClose}>
          Cancel
        </button>
        <button className="primary" onClick={() => void onOk()}>
          Continue
        </button>
      </div>
    </Modal>
  )
}

function CloneDialog({ onClose, onOpen }: { onClose: () => void; onOpen: (p: string) => void }) {
  const [url, setUrl] = useState('')
  const [dir, setDir] = useState('')
  const [name, setName] = useState('')
  const [progress, setProgress] = useState('')
  useEffect(() => window.spoon.app.on('clone:progress', (l) => setProgress((p) => p + String(l))), [])
  return (
    <Modal title="Clone" onClose={onClose}>
      <label>URL</label>
      <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://github.com/org/repo.git" />
      <label>Parent directory</label>
      <div className="row-btns">
        <input value={dir} onChange={(e) => setDir(e.target.value)} />
        <button className="ghost" onClick={async () => setDir((await window.spoon.app.pickDirectory()) || dir)}>
          Browse
        </button>
      </div>
      <label>Folder name (optional)</label>
      <input value={name} onChange={(e) => setName(e.target.value)} />
      {progress && <pre className="hint">{progress.slice(-400)}</pre>}
      <div className="dialog-foot">
        <button className="ghost" onClick={onClose}>
          Cancel
        </button>
        <button
          className="primary"
          disabled={!url || !dir}
          onClick={async () => {
            const dest = (await window.spoon.git.clone({ url, directory: dir, name: name || undefined, recursive: true })) as string
            onOpen(dest)
            onClose()
          }}
        >
          Clone
        </button>
      </div>
    </Modal>
  )
}

function InitDialog({ onClose, onOpen }: { onClose: () => void; onOpen: (p: string) => void }) {
  const [dir, setDir] = useState('')
  return (
    <Modal title="Create repository" onClose={onClose}>
      <label>Directory</label>
      <div className="row-btns">
        <input value={dir} onChange={(e) => setDir(e.target.value)} />
        <button className="ghost" onClick={async () => setDir((await window.spoon.app.pickDirectory()) || dir)}>
          Browse
        </button>
      </div>
      <div className="dialog-foot">
        <button className="ghost" onClick={onClose}>
          Cancel
        </button>
        <button
          className="primary"
          disabled={!dir}
          onClick={async () => {
            const dest = (await window.spoon.git.init(dir, true)) as string
            onOpen(dest)
            onClose()
          }}
        >
          Create
        </button>
      </div>
    </Modal>
  )
}

function RemoteDialog({
  title = 'Add remote',
  action = 'Save',
  initialName = 'origin',
  initialUrl = '',
  lockName = false,
  onClose,
  onOk
}: {
  title?: string
  action?: string
  initialName?: string
  initialUrl?: string
  lockName?: boolean
  onClose: () => void
  onOk: (n: string, u: string) => Promise<void>
}) {
  const [n, setN] = useState(initialName)
  const [u, setU] = useState(initialUrl)
  return (
    <Modal title={title} onClose={onClose}>
      <label>Name</label>
      <input value={n} onChange={(e) => setN(e.target.value)} disabled={lockName} />
      <label>URL</label>
      <input value={u} onChange={(e) => setU(e.target.value)} placeholder="https://github.com/org/repo.git" />
      <div className="dialog-foot">
        <button className="ghost" onClick={onClose}>
          Cancel
        </button>
        <button className="primary" disabled={!n.trim() || !u.trim()} onClick={() => void onOk(n.trim(), u.trim())}>
          {action}
        </button>
      </div>
    </Modal>
  )
}

function BlameDialog({ path, file, rev, onClose }: { path: string; file: string; rev?: string; onClose: () => void }) {
  const [lines, setLines] = useState<BlameLine[]>([])
  useEffect(() => {
    void window.spoon.git.blame(path, file, rev).then((l) => setLines(l as BlameLine[]))
  }, [path, file, rev])
  return (
    <Modal title={`Blame — ${file}`} onClose={onClose}>
      <div className="blame" style={{ maxHeight: 480, overflow: 'auto' }}>
        {lines.map((l) => (
          <div key={l.number} className="blame-row">
            <span className="h">{l.hash.slice(0, 7)}</span>
            <span className="a">{l.author}</span>
            <span className="l">{l.line}</span>
          </div>
        ))}
      </div>
      <div className="dialog-foot">
        <button className="primary" onClick={onClose}>
          Close
        </button>
      </div>
    </Modal>
  )
}

function HistoryDialog({ path, file, onClose }: { path: string; file: string; onClose: () => void }) {
  const [commits, setCommits] = useState<CommitInfo[]>([])
  useEffect(() => {
    void window.spoon.git.history(path, file).then((c) => setCommits(c as CommitInfo[]))
  }, [path, file])
  return (
    <Modal title={`History — ${file}`} onClose={onClose}>
      <div style={{ maxHeight: 420, overflow: 'auto' }}>
        {commits.map((c) => (
          <div key={c.hash} className="commit-row" style={{ gridTemplateColumns: '1fr 120px 90px' }}>
            <span>{c.subject}</span>
            <span className="meta">{c.author}</span>
            <span className="meta">{c.shortHash}</span>
          </div>
        ))}
      </div>
      <div className="dialog-foot">
        <button className="primary" onClick={onClose}>
          Close
        </button>
      </div>
    </Modal>
  )
}

function ReflogDialog({ path, onClose }: { path: string; onClose: () => void }) {
  const [commits, setCommits] = useState<CommitInfo[]>([])
  useEffect(() => {
    void window.spoon.git.reflog(path).then((c) => setCommits(c as CommitInfo[]))
  }, [path])
  return (
    <Modal title="Reflog" onClose={onClose}>
      <div style={{ maxHeight: 420, overflow: 'auto' }}>
        {commits.map((c) => (
          <div key={c.hash + c.subject} className="commit-row" style={{ gridTemplateColumns: '1fr 90px' }}>
            <span>{c.subject}</span>
            <span className="meta">{c.shortHash}</span>
          </div>
        ))}
      </div>
      <div className="dialog-foot">
        <button className="primary" onClick={onClose}>
          Close
        </button>
      </div>
    </Modal>
  )
}

function ConflictDialog({
  path,
  file,
  onClose,
  onReload
}: {
  path: string
  file: string
  onClose: () => void
  onReload: () => void
}) {
  const [c, setC] = useState<ConflictFile | null>(null)
  const [text, setText] = useState('')
  useEffect(() => {
    void window.spoon.git.readConflict(path, file).then((x) => {
      const f = x as ConflictFile
      setC(f)
      setText(f.working)
    })
  }, [path, file])
  if (!c) return null
  return (
    <Modal title={`Merge conflict — ${file}`} onClose={onClose} wide>
      <div className="row-btns">
        <button className="ghost" onClick={() => setText(c.ours)}>
          Use ours
        </button>
        <button className="ghost" onClick={() => setText(c.theirs)}>
          Use theirs
        </button>
        <button className="ghost" onClick={() => setText(`${c.ours}\n${c.theirs}`)}>
          Use both
        </button>
      </div>
      <div className="conflict-grid">
        <textarea value={c.ours} readOnly />
        <textarea value={c.theirs} readOnly />
      </div>
      <label>Resolved</label>
      <textarea value={text} onChange={(e) => setText(e.target.value)} style={{ height: 120, fontFamily: 'var(--mono)' }} />
      <div className="dialog-foot">
        <button className="ghost" onClick={onClose}>
          Cancel
        </button>
        <button
          className="primary"
          onClick={async () => {
            await window.spoon.git.writeResolved(path, file, text)
            onReload()
            onClose()
          }}
        >
          Mark resolved
        </button>
      </div>
    </Modal>
  )
}

function RebaseDialog({
  path,
  onClose,
  onReload
}: {
  path: string
  onClose: () => void
  onReload: () => void
}) {
  const [items, setItems] = useState<RebaseTodoItem[]>([])
  const [onto, setOnto] = useState('HEAD')
  useEffect(() => {
    void window.spoon.git.commits(path, 20, ['HEAD']).then((list) => {
      const head = list as CommitInfo[]
      setItems(head.map((c) => ({ action: 'pick', hash: c.hash, subject: c.subject })))
      setOnto(head[head.length - 1]?.parents[0] || `HEAD~${Math.max(head.length, 1)}`)
    })
  }, [path])
  return (
    <Modal title="Interactive rebase" onClose={onClose}>
      {!items.length && <p className="hint">Loading the current branch…</p>}
      {items.map((it, i) => (
        <div key={it.hash} className="rebase-item">
          <select
            value={it.action}
            onChange={(e) =>
              setItems((xs) => xs.map((x, j) => (j === i ? { ...x, action: e.target.value as RebaseTodoItem['action'] } : x)))
            }
          >
            {['pick', 'reword', 'edit', 'squash', 'fixup', 'drop'].map((a) => (
              <option key={a}>{a}</option>
            ))}
          </select>
          <span className="meta">{it.hash.slice(0, 7)}</span>
          <span>{it.subject}</span>
        </div>
      ))}
      <div className="dialog-foot">
        <button className="ghost" onClick={onClose}>
          Cancel
        </button>
        <button
          className="primary"
          disabled={!items.length}
          onClick={async () => {
            await window.spoon.git.interactiveRebase(path, onto, items)
            onReload()
            onClose()
          }}
        >
          Start
        </button>
      </div>
    </Modal>
  )
}

function SettingsDialog({
  accounts,
  settings,
  catalogs,
  onClose,
  onSaved
}: {
  accounts: AiAccount[]
  settings: Settings | null
  catalogs: Record<AiProviderId, AiModelCatalog>
  onClose: () => void
  onSaved: () => Promise<void>
}) {
  const [tab, setTab] = useState<'look' | 'ai'>('ai')
  const [key, setKey] = useState('')
  const [provider, setProvider] = useState<AiProviderId>(settings?.aiProvider ?? 'free')
  const [acc, setAcc] = useState(accounts)
  const [local, setLocal] = useState<Record<string, { available: boolean; label?: string }>>({})
  const [device, setDevice] = useState<{ userCode: string; url: string } | null>(null)
  const [adding, setAdding] = useState<string | null>(null)
  const [addKey, setAddKey] = useState('')
  const [addModel, setAddModel] = useState('')
  const [customName, setCustomName] = useState('')
  const [customUrl, setCustomUrl] = useState('')
  const [customKey, setCustomKey] = useState('')
  const [customModel, setCustomModel] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)
  const endpoints = settings?.aiEndpoints ?? []
  const addedIds = new Set(endpoints.map((item) => item.id))

  useEffect(() => {
    void window.spoon.ai.local().then(setLocal)
  }, [])
  useEffect(() => {
    if (settings?.aiProvider) setProvider(settings.aiProvider)
  }, [settings?.aiProvider])
  useEffect(() => {
    setAcc(accounts)
  }, [accounts])

  async function refresh() {
    setAcc((await window.spoon.ai.accounts()) as AiAccount[])
    await onSaved()
  }

  async function selectProvider(id: AiProviderId) {
    setProvider(id)
    await window.spoon.app.patchSettings({ aiProvider: id })
    await onSaved()
  }

  async function addSite(site: AiEndpointConfig, apiKey?: string, model?: string) {
    setBusyId(site.id)
    try {
      const endpoint: AiEndpointConfig = {
        ...site,
        defaultModel: model?.trim() || site.defaultModel
      }
      const result = (await window.spoon.ai.addEndpoint(endpoint, apiKey)) as { accounts: AiAccount[] }
      setAcc(result.accounts)
      setAdding(null)
      setAddKey('')
      setAddModel('')
      setProvider(site.id)
      await onSaved()
    } catch (error) {
      await window.spoon.app.error(error instanceof Error ? error.message : String(error))
    } finally {
      setBusyId(null)
    }
  }

  async function addCustom() {
    const label = customName.trim() || 'Custom API'
    const baseUrl = customUrl.trim()
    if (!/^https?:\/\//i.test(baseUrl)) {
      await window.spoon.app.error('Base URL must start with http:// or https://')
      return
    }
    const id = customProviderId(label, [...BUILTIN_AI_IDS, ...AI_SITE_CATALOG.map((s) => s.id), ...endpoints.map((e) => e.id)])
    await addSite(
      {
        id,
        label,
        baseUrl,
        defaultModel: customModel.trim() || 'gpt-4o-mini',
        needsKey: Boolean(customKey.trim()),
        blurb: 'Custom OpenAI-compatible endpoint',
        accent: '#0b57d0'
      },
      customKey,
      customModel
    )
    setCustomName('')
    setCustomUrl('')
    setCustomKey('')
    setCustomModel('')
  }

  const yours = listedProviderIds(settings)
  const catalogLeft = AI_SITE_CATALOG.filter((site) => !addedIds.has(site.id) && !BUILTIN_AI_IDS.includes(site.id))

  return (
    <Modal title="Preferences" onClose={onClose} wide className="prefs">
      <div className="prefs-tabs" role="tablist">
        <button type="button" role="tab" className={tab === 'look' ? 'on' : ''} aria-selected={tab === 'look'} onClick={() => setTab('look')}>
          Appearance
        </button>
        <button type="button" role="tab" className={tab === 'ai' ? 'on' : ''} aria-selected={tab === 'ai'} onClick={() => setTab('ai')}>
          AI
        </button>
      </div>

      {tab === 'look' && (
        <section className="prefs-pane">
          <h3>Theme</h3>
          <div className="seg">
            {(['light', 'dark', 'system'] as const).map((t) => (
              <button
                key={t}
                className={settings?.theme === t ? 'on' : ''}
                onClick={async () => {
                  await window.spoon.app.patchSettings({ theme: t })
                  await onSaved()
                }}
              >
                {t === 'system' ? 'Match Windows' : t === 'dark' ? 'Dark' : 'Light'}
              </button>
            ))}
          </div>
          <label>Frosted glass</label>
          <input
            type="range"
            min={0}
            max={80}
            value={settings?.glass ?? 40}
            onChange={(e) => {
              const glass = Number(e.target.value)
              void window.spoon.app.patchSettings({ glass }).then(() => void onSaved())
            }}
          />
          <p className="hint">{settings?.glass ?? 40}% blur on the toolbar, tabs and branch sidebar. 0 is solid.</p>
        </section>
      )}

      {tab === 'ai' && (
        <section className="prefs-pane">
          <p className="hint">
            AI message fills the box. AI commit stays local. Analyze splits the worktree into one local commit per implementation.
          </p>

          <div className="ai-active">
            <div className="ai-active-top">
              <span className="ai-mark">
                <ProviderIcon id={provider} label={providerLabel(provider, endpoints)} />
              </span>
              <div>
                <strong>{providerLabel(provider, endpoints)}</strong>
                <p className="hint">Active provider</p>
              </div>
            </div>
            <ModelField provider={provider} settings={settings} catalog={catalogs[provider]} onSaved={onSaved} />
          </div>

          <h3>Your providers</h3>
          <div className="ai-grid">
            {yours.map((p) => {
              const a = acc.find((x) => x.provider === p)
              const endpoint = endpoints.find((item) => item.id === p)
              const connected = p === 'free' || !!a?.connected
              const selected = provider === p
              return (
                <div key={p} className={`ai-card ${selected ? 'on' : ''}`}>
                  <button type="button" className="ai-card-hit" onClick={() => void selectProvider(p)}>
                    <span className="ai-mark">
                      <ProviderIcon id={p} label={providerLabel(p, endpoints)} />
                    </span>
                    <span className="ai-card-copy">
                      <b>{providerLabel(p, endpoints)}</b>
                      <span className={connected ? 'pill-on' : 'hint'}>
                        {p === 'free' ? 'Ready · no account' : connected ? `Connected${a?.label ? ` · ${a.label}` : ''}` : 'Not connected'}
                      </span>
                    </span>
                  </button>
                  {selected && p !== 'free' && (
                    <div className="ai-card-body">
                      {BUILTIN_AI_IDS.includes(p) && (
                        <div className="row-btns">
                          {local[p]?.available && (
                            <div className="ai-local">
                              <button
                                className="ghost"
                                title={local[p].label ? `Use local session (${local[p].label})` : 'Use local session'}
                                onClick={async () => { await window.spoon.ai.importLocal(p); await refresh() }}
                              >
                                Use local session
                              </button>
                              {local[p].label && (
                                <span className="hint ai-mail" title={local[p].label}>
                                  {local[p].label}
                                </span>
                              )}
                            </div>
                          )}
                          {p === 'grok' && (
                            <button
                              className="ghost"
                              onClick={async () => {
                                try {
                                  await window.spoon.ai.grokPkce()
                                  await refresh()
                                } catch {
                                  const flow = (await window.spoon.ai.grokDevice()) as { userCode: string; verificationUrl: string }
                                  setDevice({ userCode: flow.userCode, url: flow.verificationUrl })
                                  await window.spoon.ai.grokPoll(flow)
                                  setDevice(null)
                                  await refresh()
                                }
                              }}
                            >
                              Sign in with Grok
                            </button>
                          )}
                          <button className="ghost" onClick={() => void window.spoon.ai.openConsole(p)}>
                            Get key
                          </button>
                          {a?.connected && (
                            <button className="ghost" onClick={async () => { await window.spoon.ai.disconnect(p); await refresh() }}>
                              Disconnect
                            </button>
                          )}
                        </div>
                      )}
                      {PAID_AI_PROVIDERS.includes(p) && (
                        <div className="row-btns">
                          <input type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder="Paste API key" />
                          <button
                            className="ghost"
                            onClick={async () => {
                              await window.spoon.ai.saveApiKey(p, key)
                              setKey('')
                              await refresh()
                            }}
                          >
                            Save
                          </button>
                        </div>
                      )}
                      {endpoint && (
                        <>
                          {endpoint.needsKey && (
                            <div className="row-btns">
                              <input type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder="Paste API key" />
                              <button
                                className="ghost"
                                onClick={async () => {
                                  await window.spoon.ai.saveApiKey(p, key)
                                  setKey('')
                                  await refresh()
                                }}
                              >
                                Save
                              </button>
                            </div>
                          )}
                          <div className="row-btns">
                            {endpoint.consoleUrl && (
                              <button className="ghost" onClick={() => void window.spoon.ai.openConsole(p)}>
                                Get key
                              </button>
                            )}
                            <button
                              className="ghost"
                              onClick={async () => {
                                await window.spoon.ai.removeEndpoint(p)
                                await refresh()
                              }}
                            >
                              Remove
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          <h3>Add a site</h3>
          <p className="hint">OpenRouter, Groq, Gemini, Ollama, and other OpenAI-compatible APIs. Pick a card, paste a key if it needs one.</p>
          <div className="ai-grid">
            {catalogLeft.map((site) => (
              <div key={site.id} className={`ai-card ${adding === site.id ? 'on' : ''}`}>
                <button
                  type="button"
                  className="ai-card-hit"
                  onClick={() => {
                    if (!site.needsKey) {
                      void addSite(site)
                      return
                    }
                    setAdding(adding === site.id ? null : site.id)
                    setAddKey('')
                    setAddModel(site.defaultModel)
                  }}
                >
                  <span className="ai-mark">
                    <ProviderIcon id={site.id} label={site.label} />
                  </span>
                  <span className="ai-card-copy">
                    <b>{site.label}</b>
                    <span className="hint">{site.blurb}</span>
                  </span>
                </button>
                {adding === site.id && site.needsKey && (
                  <div className="ai-card-body">
                    <label>API key</label>
                    <input type="password" value={addKey} onChange={(e) => setAddKey(e.target.value)} placeholder="Paste key" />
                    <label>Model</label>
                    <input value={addModel} spellCheck={false} onChange={(e) => setAddModel(e.target.value)} placeholder={site.defaultModel} />
                    <div className="row-btns">
                      <button className="ghost" onClick={() => void window.spoon.ai.openConsole(site.id)}>
                        Get key
                      </button>
                      <button
                        className="primary"
                        disabled={busyId === site.id || !addKey.trim()}
                        onClick={() => void addSite(site, addKey, addModel)}
                      >
                        {busyId === site.id ? 'Adding…' : 'Add'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>

          <h3>Custom endpoint</h3>
          <p className="hint">Any OpenAI-compatible base URL — LiteLLM, vLLM, a proxy, or a provider that is not listed above.</p>
          <div className="custom-grid">
            <label>
              Name
              <input value={customName} onChange={(e) => setCustomName(e.target.value)} placeholder="OpenRouter work" />
            </label>
            <label>
              Base URL
              <input value={customUrl} spellCheck={false} onChange={(e) => setCustomUrl(e.target.value)} placeholder="https://openrouter.ai/api/v1" />
            </label>
            <label>
              API key
              <input type="password" value={customKey} onChange={(e) => setCustomKey(e.target.value)} placeholder="Optional for local servers" />
            </label>
            <label>
              Model
              <input value={customModel} spellCheck={false} onChange={(e) => setCustomModel(e.target.value)} placeholder="gpt-4o-mini" />
            </label>
          </div>
          <div className="row-btns" style={{ marginTop: 10 }}>
            <button className="primary" disabled={!customUrl.trim() || !!busyId} onClick={() => void addCustom()}>
              Add custom API
            </button>
          </div>

          {device && (
            <p className="hint">
              Enter code <b>{device.userCode}</b> at {device.url}
            </p>
          )}
        </section>
      )}

      <div className="dialog-foot">
        <button className="primary" onClick={onClose}>
          Done
        </button>
      </div>
    </Modal>
  )
}

function ModelField({
  provider,
  settings,
  catalog,
  onSaved
}: {
  provider: AiProviderId
  settings: Settings | null
  catalog?: AiModelCatalog
  onSaved: () => Promise<void>
}) {
  const saved = defaultModelFor(provider, settings)
  const choices = modelOptions(catalog, saved)
  const [custom, setCustom] = useState(saved)
  useEffect(() => {
    setCustom(saved)
  }, [saved, provider])

  async function save(id: string) {
    const next = id.trim()
    if (!next) return
    await window.spoon.app.patchSettings({
      aiModels: { ...(settings?.aiModels ?? DEFAULT_AI_MODELS), [provider]: next }
    })
    await onSaved()
  }

  const name = providerLabel(provider, settings?.aiEndpoints)
  return (
    <>
      <label>Model</label>
      <select value={saved} onChange={(e) => void save(e.target.value)}>
        {choices.map((item) => (
          <option key={item.id} value={item.id}>
            {item.label}
          </option>
        ))}
      </select>
      <label>Model id</label>
      <input
        value={custom}
        spellCheck={false}
        onChange={(e) => setCustom(e.target.value)}
        onBlur={() => void save(custom)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') void save(custom)
        }}
      />
      <p className="hint">
        {provider === 'free'
          ? catalog?.live
            ? `${catalog.models.length} free models. No account required.`
            : catalog?.error || 'Free models — no account required.'
          : catalog?.live
            ? `${catalog.models.length} models from ${name}. The list refreshes on its own.`
            : catalog?.error
              ? catalog.error
              : 'Connect this provider to load every model it offers.'}
      </p>
    </>
  )
}

function modelOptions(catalog: AiModelCatalog | undefined, selected: string): AiModelChoice[] {
  const models = catalog?.models?.length ? catalog.models : []
  if (!selected || models.some((item) => item.id === selected)) return models
  return [{ id: selected, label: selected }, ...models]
}

function QuickLaunch({
  recent,
  onClose,
  onOpen,
  onAction
}: {
  tabs: Tab[]
  recent: RepoSummary[]
  snap?: Snapshot
  onClose: () => void
  onOpen: (p: string, n?: string) => void
  onAction: (a: string) => void
}) {
  const [q, setQ] = useState('')
  const items = [
    ...recent.map((r) => ({ id: r.path, label: `Open ${r.name}`, run: () => onOpen(r.path, r.name) })),
    { id: 'fetch', label: 'Fetch', run: () => onAction('fetch') },
    { id: 'branch', label: 'New branch', run: () => onAction('branch') },
    { id: 'settings', label: 'Preferences / AI', run: () => onAction('settings') }
  ].filter((i) => i.label.toLowerCase().includes(q.toLowerCase()))
  const [idx, setIdx] = useState(0)
  return (
    <div className="dialog-back" onMouseDown={onClose}>
      <div className="quick" onMouseDown={(e) => e.stopPropagation()}>
        <input
          autoFocus
          placeholder="Quick Launch"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') onClose()
            if (e.key === 'ArrowDown') setIdx((i) => Math.min(items.length - 1, i + 1))
            if (e.key === 'ArrowUp') setIdx((i) => Math.max(0, i - 1))
            if (e.key === 'Enter') items[idx]?.run()
          }}
        />
        <div className="hits">
          {items.map((it, i) => (
            <div key={it.id} className={`hit ${i === idx ? 'on' : ''}`} onClick={it.run}>
              {it.label}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

void menuUnsub
