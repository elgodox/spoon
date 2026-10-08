import { Button } from './Button'
import { Fragment, memo, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { FileCode2, FolderOpen, Copy, History, ScanLine, Plus, Undo2, Trash2, Pencil } from 'lucide-react'
import { Avatar, AvatarProvider } from './Avatar'
import { ProfileSettings } from './ProfileSettings'
import { ContextMenu, type ContextState } from './ContextMenu'
import { firstChangedLine, workingLine } from '../../shared/change-location'
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
  MediaKind,
  MediaPair,
  MediaSide,
  FileTreeNode,
  RebaseTodoItem,
  RepoStatus,
  RepoSummary,
  RepoWorkspace,
  Settings,
  StashInfo,
  StatusEntry,
  TagInfo,
  UpdateState,
  AppSession,
  WorkspaceAnalysis,
  WorkspaceSuggestion
} from '../../shared/types'
import { classifyMedia, formatBytes } from '../../shared/media'
import { clusterGrouped, WORKSPACE_COLORS, workspaceColor } from '../../shared/workspaces'
import type { LauncherInfo } from '../../shared/launchers'
import { groupLaunchers, LAUNCHER_KIND_LABEL } from '../../shared/launchers'
import { AI_SITE_CATALOG, customProviderId } from '../../shared/ai-catalog'
import { ProviderIcon } from './ai-logos'
import { AI_MODELS, BUILTIN_AI_IDS, DEFAULT_AI_MODELS, defaultModelFor, fallbackAiProvider, hasConnectedAi, listedProviderIds, PAID_AI_PROVIDERS, providerLabel, resolveAiProvider } from '../../shared/models'
import {
  ACCENTS,
  ICON_COLORS,
  iconColorMap,
  resolveAccent,
  SPACEX_ICON_COLORS,
  THEME_PACKS
} from '../../shared/themes'
import type { AccentId, IconStyle, ThemePack } from '../../shared/types'

const ICO_VAR_KEYS = Array.from(new Set([...Object.keys(ICON_COLORS), ...Object.keys(SPACEX_ICON_COLORS)]))
import {
  IcoAi,
  IcoBranch,
  IcoChanges,
  IcoCheck,
  IcoChevron,
  IcoClose,
  IcoConsole,
  IcoCreate,
  IcoFetch,
  IcoHealth,
  IcoHelp,
  IcoHome,
  IcoLaunch,
  IcoOpen,
  IcoPull,
  IcoPush,
  IcoRefresh,
  IcoRemote,
  IcoSettings,
  IcoWorkspaces,
  IcoSpoon,
  IcoStash,
  IcoTag,
  IcoTheme
} from './icons'
import { AboutDialog } from './About'
import { Tour } from './Tour'
import { HealthDialog, RepoHome } from './RepoHome'
import { CommitGraph, COMMIT_ROW_HEIGHT, graphWidth } from './CommitGraph'
import {
  bindDrag,
  catchErr,
  clamp,
  fileName,
  fileType,
  formatAgo,
  formatDate,
  joinRepoPath,
  branchLeafName,
  groupByPathPrefix,
  laneColor,
  openMenu,
  openWithMenuItems,
  parentDir,
  parseReflogSubject
} from './lib'

type PrefsTab = 'look' | 'profile' | 'git' | 'open' | 'ai' | 'help'
type AiPick = { type: 'provider'; id: AiProviderId } | { type: 'add'; id: string } | { type: 'custom' }
const PREFS_TABS: { id: PrefsTab; label: string; Icon: () => ReactNode }[] = [
  { id: 'look', label: 'Appearance', Icon: IcoTheme },
  { id: 'profile', label: 'Profile', Icon: IcoSpoon },
  { id: 'git', label: 'Git', Icon: IcoBranch },
  { id: 'open', label: 'Open with', Icon: IcoOpen },
  { id: 'ai', label: 'AI', Icon: IcoAi },
  { id: 'help', label: 'Help', Icon: IcoHelp }
]
let lastPrefsTab: PrefsTab = 'look'
let lastPrefsNav = false
let lastAiNav = false

function snapThemeTransitions() {
  const style = document.createElement('style')
  style.textContent = '*,*::before,*::after{transition:none !important}'
  document.head.append(style)
  void document.body.offsetHeight
  requestAnimationFrame(() => {
    requestAnimationFrame(() => style.remove())
  })
}

type Tab = {
  id: string
  kind: 'manager' | 'repo'
  path?: string
  name: string
  workspaceId?: string
  color?: string
}
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
  | { type: 'stash'; files?: string[] }
  | { type: 'merge'; ref: string }
  | { type: 'rebase'; ref: string }
  | { type: 'settings'; tab?: PrefsTab }
  | { type: 'about' }
  | { type: 'health' }
  | { type: 'blame'; file: string; rev?: string }
  | { type: 'history'; file: string }
  | { type: 'conflict'; file: string }
  | { type: 'ir' }
  | { type: 'device'; userCode: string; url: string }
  | { type: 'reflog' }

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

/** Opening several repositories at once: a few in flight keeps Git busy without flooding it. */
const OPEN_CONCURRENCY = 4

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length)
  let next = 0
  const worker = async () => {
    while (next < items.length) {
      const index = next++
      out[index] = await fn(items[index], index)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return out
}

export function App() {
  const [tabs, setTabs] = useState<Tab[]>([{ id: 'mgr', kind: 'manager', name: 'New Tab' }])
  const [activeId, setActiveId] = useState('mgr')
  const [settings, setSettings] = useState<Settings | null>(null)
  const settingsRef = useRef(settings)
  settingsRef.current = settings
  const [sidebarW, setSidebarW] = useState(250)
  const [catalogs, setCatalogs] = useState<Record<AiProviderId, AiModelCatalog>>({
    grok: { provider: 'grok', models: AI_MODELS.grok, live: false },
    chatgpt: { provider: 'chatgpt', models: AI_MODELS.chatgpt, live: false },
    claude: { provider: 'claude', models: AI_MODELS.claude, live: false }
  })
  const [recent, setRecent] = useState<RepoSummary[]>([])
  const [workspaces, setWorkspaces] = useState<RepoWorkspace[]>([])
  const [drafts, setDrafts] = useState<RepoWorkspace[]>([])
  const [manageWs, setManageWs] = useState(false)
  const [editingWorkspace, setEditingWorkspace] = useState<RepoWorkspace | null>(null)
  const [tabMenu, setTabMenu] = useState<{ tabId: string; x: number; y: number } | null>(null)
  const [groupMenu, setGroupMenu] = useState<{
    key: string
    workspaceId?: string
    name?: string
    x: number
    y: number
    tabIds: string[]
  } | null>(null)
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({})
  const [snaps, setSnaps] = useState<Record<string, Snapshot>>({})
  const [busy, setBusy] = useState(false)
  const [overlay, setOverlay] = useState<Overlay>(null)
  const [quick, setQuick] = useState(false)
  const [activityOpen, setActivityOpen] = useState(false)
  const [activity, setActivity] = useState<ActivityItem[]>([])
  const [accounts, setAccounts] = useState<AiAccount[]>([])
  const [theme, setTheme] = useState<'light' | 'dark'>('dark')
  const [tour, setTour] = useState(false)
  const [update, setUpdate] = useState<UpdateState>({ status: 'idle' })
  const [confettiAt, setConfettiAt] = useState(0)
  const active = tabs.find((t) => t.id === activeId) || tabs[0]
  const tabsRef = useRef(tabs)
  tabsRef.current = tabs
  const activeIdRef = useRef(activeId)
  activeIdRef.current = activeId
  const collapsedGroupsRef = useRef(collapsedGroups)
  collapsedGroupsRef.current = collapsedGroups
  const sessionReadyRef = useRef(false)

  const applyAppearance = useCallback((s: Settings) => {
    const pack = s.themePack || 'spoon'
    const mode = pack === 'spacex' ? 'dark' : s.theme === 'dark' ? 'dark' : 'light'
    const icons = s.iconStyle || 'mono'
    const root = document.documentElement
    const changed =
      root.dataset.theme !== mode || root.dataset.pack !== pack || root.dataset.icons !== icons
    setTheme((prev) => {
      if (prev !== mode || changed) snapThemeTransitions()
      return mode
    })
    root.dataset.theme = mode
    root.dataset.pack = pack
    root.dataset.icons = icons
    const accentId = pack === 'spacex' && (!s.accentId || s.accentId === 'blue') ? 'red' : s.accentId
    const { accent, accent2 } = resolveAccent(accentId, mode, s.accentCustom)
    root.style.setProperty('--accent', accent)
    root.style.setProperty('--accent-2', accent2)
    const iconMap = iconColorMap(pack, icons)
    for (const key of ICO_VAR_KEYS) {
      if (iconMap?.[key]) root.style.setProperty(`--ico-${key}`, iconMap[key])
      else root.style.removeProperty(`--ico-${key}`)
    }
  }, [])

  const commitSettings = useCallback(
    async (next: Settings) => {
      // Keep ref in sync before any theme:native echo can re-apply appearance.
      settingsRef.current = next
      setSettings(next)
      applyAppearance(next)
      try {
        const chrome = (await window.spoon.app.chrome()) as { material?: string }
        if (chrome.material) document.documentElement.dataset.material = chrome.material
      } catch {
        /* ignore */
      }
    },
    [applyAppearance]
  )

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
      grok: { provider: 'grok', models: AI_MODELS.grok, live: false },
      chatgpt: { provider: 'chatgpt', models: AI_MODELS.chatgpt, live: false },
      claude: { provider: 'claude', models: AI_MODELS.claude, live: false }
    }
    for (const catalog of loaded) next[catalog.provider] = catalog
    setCatalogs(next)
  }, [])

  const refreshSettings = useCallback(async () => {
    const s = await window.spoon.app.settings()
    settingsRef.current = s
    setSettings(s)
    setSidebarW(s.sidebarWidth || 250)
    applyAppearance(s)
    if (!s.onboarded) setTour(true)
    // Independent reads: ask for all of them at once instead of one after another.
    const [recentList, workspaceList, accountList, chrome, updateState] = await Promise.all([
      window.spoon.app.recent(),
      window.spoon.app.workspaces(),
      window.spoon.ai.accounts(),
      window.spoon.app.chrome(),
      window.spoon.app.update()
    ])
    setRecent(recentList)
    setWorkspaces(workspaceList as RepoWorkspace[])
    setAccounts(accountList)
    const material = (chrome as { material?: string }).material
    if (material) document.documentElement.dataset.material = material
    setUpdate(updateState as UpdateState)
  }, [applyAppearance])

  useEffect(() => {
    void refreshModels(true)
    const timer = setInterval(() => void refreshModels(true), 10 * 60 * 1000)
    return () => clearInterval(timer)
  }, [refreshModels, accounts])

  useEffect(() => {
    return window.spoon.app.on('theme:native', () => {
      // Never invent settings here — only re-paint from the latest committed prefs.
      if (settingsRef.current) applyAppearance(settingsRef.current)
    })
  }, [applyAppearance])

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

  const openRepos = useCallback(async (paths: string[], group?: RepoWorkspace) => {
    const unique = [...new Set(paths)]
    if (!unique.length) return
    setBusy(true)
    const errors: string[] = []
    const stamp = Date.now().toString(36)
    const results = await mapLimit(unique, OPEN_CONCURRENCY, async (path) => {
      try {
        return (await window.spoon.git.open(path)) as Snapshot
      } catch (e) {
        errors.push(e instanceof Error ? e.message : String(e))
        return null
      }
    })
    const opened: { path: string; name: string; id: string; snap: Snapshot }[] = []
    results.forEach((snap, index) => {
      if (snap) opened.push({ path: unique[index], name: snap.status.name, id: `r-${stamp}-${opened.length}`, snap })
    })
    if (opened.length) {
      setSnaps((m) => {
        const next = { ...m }
        for (const row of opened) next[row.path] = row.snap
        return next
      })
      if (group?.id.startsWith('draft-')) setDrafts((ds) => [group, ...ds.filter((item) => item.id !== group.id)])
      const known = tabsRef.current
      const firstExisting = known.find((tab) => tab.path === opened[0].path)
      setTabs((ts) => {
        let next = opened.length && ts.length === 1 && ts[0].kind === 'manager' ? [] : ts
        for (const row of opened) {
          const hit = next.find((tab) => tab.path === row.path)
          if (hit) {
            if (group) {
              next = next.map((tab) =>
                tab.path === row.path ? { ...tab, name: row.name, workspaceId: group.id, color: group.color } : tab
              )
            }
            continue
          }
          next = [
            ...next,
            {
              id: row.id,
              kind: 'repo' as const,
              path: row.path,
              name: row.name,
              workspaceId: group?.id,
              color: group?.color
            }
          ]
        }
        return clusterGrouped(next)
      })
      setActiveId(firstExisting?.id ?? opened[0].id)
      setRecent(await window.spoon.app.recent())
    }
    if (errors.length) await window.spoon.app.error(errors[0])
    setBusy(false)
  }, [])

  const restoreOpenSession = useCallback(async (session: AppSession) => {
    const rows = session.tabs ?? []
    if (!rows.length) return
    setBusy(true)
    const opened: {
      id: string
      path: string
      name: string
      workspaceId?: string
      color?: string
      snap: Snapshot
    }[] = []
    const stamp = Date.now().toString(36)
    const snaps = await mapLimit(rows, OPEN_CONCURRENCY, async (row) => {
      try {
        return (await window.spoon.git.open(row.path)) as Snapshot
      } catch {
        return null // skip missing or unreadable repos
      }
    })
    rows.forEach((row, index) => {
      const snap = snaps[index]
      if (!snap) return
      opened.push({
        id: `r-${stamp}-${opened.length}`,
        path: row.path,
        name: snap.status.name || row.name,
        workspaceId: row.workspaceId,
        color: row.color,
        snap
      })
    })
    if (!opened.length) {
      setBusy(false)
      return
    }
    setSnaps((map) => {
      const next = { ...map }
      for (const row of opened) next[row.path] = row.snap
      return next
    })
    const nextTabs = clusterGrouped(
      opened.map((row) => ({
        id: row.id,
        kind: 'repo' as const,
        path: row.path,
        name: row.name,
        workspaceId: row.workspaceId,
        color: row.color
      }))
    )
    setTabs(nextTabs)
    const activePath = session.activePath
    const activeTab = activePath
      ? nextTabs.find((tab) => tab.path?.toLowerCase() === activePath.toLowerCase())
      : undefined
    setActiveId(activeTab?.id ?? nextTabs[0].id)
    if (session.collapsedGroups) setCollapsedGroups(session.collapsedGroups)
    setRecent(await window.spoon.app.recent())
    setBusy(false)
  }, [])

  function sessionSnapshot(): AppSession {
    const current = tabsRef.current
    const activeTab = current.find((tab) => tab.id === activeIdRef.current)
    return {
      tabs: current
        .filter((tab) => tab.kind === 'repo' && tab.path)
        .map((tab) => ({
          path: tab.path!,
          name: tab.name,
          workspaceId: tab.workspaceId,
          color: tab.color
        })),
      activePath: activeTab?.kind === 'repo' ? activeTab.path ?? null : null,
      collapsedGroups: collapsedGroupsRef.current
    }
  }

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
    let cancelled = false
    void (async () => {
      await refreshSettings()
      if (cancelled) return
      try {
        const session = (await window.spoon.app.session()) as AppSession
        if (!cancelled) await restoreOpenSession(session)
      } finally {
        if (!cancelled) sessionReadyRef.current = true
      }
    })()
    return () => {
      cancelled = true
    }
  }, [refreshSettings, restoreOpenSession])

  useEffect(() => {
    if (!sessionReadyRef.current) return
    const timer = setTimeout(() => {
      void window.spoon.app.saveSession(sessionSnapshot())
    }, 250)
    return () => clearTimeout(timer)
  }, [tabs, activeId, collapsedGroups])

  useEffect(() => {
    const flush = () => {
      if (!sessionReadyRef.current) return
      void window.spoon.app.saveSession(sessionSnapshot())
    }
    window.addEventListener('beforeunload', flush)
    return () => {
      window.removeEventListener('beforeunload', flush)
      flush()
    }
  }, [])

  useEffect(() => {
    void window.spoon.app.maximized().then((on) => {
      document.documentElement.dataset.maximized = on ? '1' : '0'
    })
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
        if (a === 'tour') setTour(true)
        if (a === 'confetti') document.dispatchEvent(new CustomEvent('spoon-confetti'))
        if (a === 'health') setOverlay({ type: 'health' })
        if (a === 'check-updates') void window.spoon.app.checkUpdate().then((s) => setUpdate(s as UpdateState))
        if (a === 'scan') {
          const mgr = tabsRef.current.find((t) => t.kind === 'manager')
          if (mgr) setActiveId(mgr.id)
          else openManager()
          setTimeout(() => document.dispatchEvent(new CustomEvent('spoon-scan')), 50)
        }
        if (a === 'home') {
          const mgr = tabsRef.current.find((t) => t.kind === 'manager')
          if (mgr) setActiveId(mgr.id)
          else openManager()
        }
        if (a === 'open-editor' && active.path) void window.spoon.app.openWith(active.path)
        if (a === 'open-terminal' && active.path) void window.spoon.app.openWith(active.path, 'terminal')
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
        if (a === 'ai-primary') document.dispatchEvent(new CustomEvent('spoon-ai-primary'))
        if (a === 'analyze') document.dispatchEvent(new CustomEvent('spoon-analyze'))
        if (a === 'changes') document.dispatchEvent(new CustomEvent('spoon-view', { detail: 'changes' }))
        if (a === 'commits') document.dispatchEvent(new CustomEvent('spoon-view', { detail: 'commits' }))
      }),
      window.spoon.app.on('repo:changed', (p) => reloadSoon(String(p))),
      window.spoon.app.on('activity', (items) => setActivity(items as ActivityItem[])),
      window.spoon.app.on('open-path', (p) => void loadRepo(String(p))),
      window.spoon.app.on('update', (s) => setUpdate(s as UpdateState)),
      window.spoon.app.on('chrome', (info) => {
        const material = (info as { material?: string; bar?: string; symbol?: string })?.material
        const bar = (info as { bar?: string })?.bar
        if (material) document.documentElement.dataset.material = material
        if (bar) document.documentElement.style.setProperty('--chrome-native', bar)
      }),
      window.spoon.app.on('window:maximized', (on) => {
        document.documentElement.dataset.maximized = on ? '1' : '0'
      }),
      window.spoon.app.on('auto-fetch', () => {
        if (active.path) void window.spoon.git.fetch(active.path, { all: true, prune: true }).then(() => reload())
      })
    ]
    return () => offs.forEach((off) => off())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active.path, loadRepo, reload, reloadSoon])

  function goHome() {
    const mgr = tabs.find((t) => t.kind === 'manager')
    if (mgr) setActiveId(mgr.id)
    else openManager()
  }

  function openManager() {
    const id = `m-${Date.now()}`
    setTabs((t) => [...t, { id, kind: 'manager', name: 'New Tab' }])
    setActiveId(id)
  }

  async function openExisting() {
    try {
      const picked = (await window.spoon.app.pickRepo()) as { repos?: string[] } | string | null
      if (!picked) return
      const repos = typeof picked === 'string' ? [picked] : (picked.repos ?? [])
      if (!repos.length) return
      await refreshSettings()
      if (repos.length === 1) await loadRepo(repos[0])
      else goHome()
    } catch (e) {
      await window.spoon.app.error(e instanceof Error ? e.message : String(e))
    }
  }

  async function toggleTheme() {
    if (!settings) return
    const next = theme === 'light' ? 'dark' : 'light'
    const s = await window.spoon.app.patchSettings({ theme: next })
    await commitSettings(s)
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
    closeTabs([id])
  }

  function closeTabs(ids: string[]) {
    const idSet = new Set(ids)
    if (!idSet.size) return
    setTabs((ts) => {
      const firstClosed = ts.findIndex((tab) => idSet.has(tab.id))
      for (const tab of ts) {
        if (idSet.has(tab.id) && tab.path) void window.spoon.git.close(tab.path)
      }
      const next = ts.filter((tab) => !idSet.has(tab.id))
      if (!next.length) {
        const nid = 'mgr'
        setActiveId(nid)
        return [{ id: nid, kind: 'manager', name: 'New Tab' }]
      }
      if (idSet.has(activeId)) {
        const before = firstClosed > 0 ? ts[firstClosed - 1] : undefined
        const pick =
          before && !idSet.has(before.id) ? before : next[Math.min(Math.max(firstClosed, 0), next.length - 1)]
        setActiveId(pick.id)
      }
      return clusterGrouped(next)
    })
  }

  function closeWorkspaceTabs(workspaceId: string) {
    const ids = tabsRef.current.filter((tab) => tab.workspaceId === workspaceId).map((tab) => tab.id)
    closeTabs(ids)
  }

  function openSelection(paths: string[]) {
    if (!paths.length) return
    void persistNewWorkspace(paths)
  }

  async function persistNewWorkspace(
    paths: string[],
    opts?: { name?: string; color?: string; id?: string; retagFrom?: string; open?: boolean }
  ) {
    const unique = [...new Set(paths)]
    if (!unique.length) return
    const color = opts?.color || workspaceColor(workspaces.length + drafts.length)
    const name = (opts?.name || `Workspace ${workspaces.length + drafts.length + 1}`).trim()
    try {
      const result = (await window.spoon.app.saveWorkspace({
        id: opts?.id,
        name,
        color,
        repos: unique
      })) as { workspaces: RepoWorkspace[]; saved: RepoWorkspace }
      setWorkspaces(result.workspaces)
      setDrafts((ds) => ds.filter((item) => item.id !== opts?.retagFrom && item.id !== result.saved.id))
      if (opts?.open === false) {
        setTabs((ts) =>
          clusterGrouped(
            ts.map((tab) => {
              const inSet = !!tab.path && unique.some((path) => path.toLowerCase() === tab.path!.toLowerCase())
              const inDraft = !!opts.retagFrom && tab.workspaceId === opts.retagFrom
              if (!inSet && !inDraft) return tab
              return { ...tab, workspaceId: result.saved.id, color: result.saved.color }
            })
          )
        )
        return
      }
      await openRepos(unique, result.saved)
    } catch (e) {
      await window.spoon.app.error(e instanceof Error ? e.message : String(e))
    }
  }

  function paintTab(tabId: string, color: string | null) {
    setTabMenu(null)
    if (!color) {
      setTabs((ts) =>
        clusterGrouped(ts.map((tab) => (tab.id === tabId ? { ...tab, workspaceId: undefined, color: undefined } : tab)))
      )
      return
    }
    const current = tabsRef.current
    const colorPeers = current.filter((tab) => tab.color === color && tab.path)
    const existingId = colorPeers.map((tab) => tab.workspaceId).find((id) => id && !id.startsWith('draft-'))
    const ws = existingId ? workspaces.find((item) => item.id === existingId) : undefined
    const next = clusterGrouped(
      current.map((tab) => (tab.id === tabId ? { ...tab, workspaceId: existingId, color } : tab))
    )
    setTabs(next)
    const peers = next.filter((tab) => tab.color === color && tab.path)
    if (peers.length < 2) return
    void persistNewWorkspace(
      peers.map((tab) => tab.path!),
      {
        id: ws?.id,
        color,
        name: ws?.name || `Workspace ${workspaces.length + 1}`,
        retagFrom: existingId,
        open: false
      }
    )
  }

  async function moveTabToWorkspace(tab: Tab, workspace: RepoWorkspace) {
    if (!tab.path) return
    setTabMenu(null)
    const repos = workspace.repos.some((path) => path.toLowerCase() === tab.path!.toLowerCase())
      ? workspace.repos
      : [...workspace.repos, tab.path]
    try {
      const result = (await window.spoon.app.saveWorkspace({
        id: workspace.id,
        name: workspace.name,
        color: workspace.color,
        repos
      })) as { workspaces: RepoWorkspace[]; saved: RepoWorkspace }
      setWorkspaces(result.workspaces)
      setTabs((ts) =>
        clusterGrouped(
          ts.map((item) =>
            item.id === tab.id ? { ...item, workspaceId: result.saved.id, color: result.saved.color } : item
          )
        )
      )
    } catch (e) {
      await window.spoon.app.error(e instanceof Error ? e.message : String(e))
    }
  }

  async function addReposToWorkspace(workspace: RepoWorkspace, paths: string[]) {
    const repos = [...workspace.repos]
    for (const path of paths) {
      if (!repos.some((item) => item.toLowerCase() === path.toLowerCase())) repos.push(path)
    }
    if (repos.length === workspace.repos.length) return
    try {
      const result = (await window.spoon.app.saveWorkspace({
        id: workspace.id,
        name: workspace.name,
        color: workspace.color,
        repos
      })) as { workspaces: RepoWorkspace[]; saved: RepoWorkspace }
      setWorkspaces(result.workspaces)
    } catch (e) {
      await window.spoon.app.error(e instanceof Error ? e.message : String(e))
    }
  }

  async function updateWorkspace(workspace: RepoWorkspace, patch: { name?: string; color?: string; repos?: string[] }) {
    const name = (patch.name ?? workspace.name).trim()
    if (!name) return
    const color = patch.color ?? workspace.color
    try {
      const result = (await window.spoon.app.saveWorkspace({
        id: workspace.id,
        name,
        color,
        repos: patch.repos ?? workspace.repos
      })) as { workspaces: RepoWorkspace[]; saved: RepoWorkspace }
      setWorkspaces(result.workspaces)
      setTabs((ts) =>
        clusterGrouped(ts.map((tab) => {
          if (result.saved.repos.some((path) => path.toLowerCase() === tab.path?.toLowerCase())) {
            return { ...tab, workspaceId: result.saved.id, color: result.saved.color }
          }
          return tab.workspaceId === result.saved.id ? { ...tab, workspaceId: undefined, color: undefined } : tab
        }))
      )
    } catch (e) {
      await window.spoon.app.error(e instanceof Error ? e.message : String(e))
      throw e
    }
  }

  async function removeWorkspace(id: string) {
    const current = workspaces.find((item) => item.id === id)
    const list = (await window.spoon.app.deleteWorkspace(id)) as RepoWorkspace[]
    setWorkspaces(list)
    setDrafts((ds) => ds.filter((item) => item.id !== id))
    setTabs((ts) =>
      clusterGrouped(
        ts.map((tab) =>
          tab.workspaceId === id ? { ...tab, workspaceId: undefined, color: tab.color || current?.color } : tab
        )
      )
    )
  }

  const groupById = new Map<string, RepoWorkspace>()
  for (const item of workspaces) groupById.set(item.id, item)
  for (const item of drafts) if (!groupById.has(item.id)) groupById.set(item.id, item)
  const activeGroup = active.workspaceId ? groupById.get(active.workspaceId) : undefined
  const tabRuns = tabGroups(clusterGrouped(tabs))
  const menuTab = tabMenu ? tabs.find((tab) => tab.id === tabMenu.tabId) : undefined

  const snap = active.path ? snaps[active.path] : undefined

  useEffect(() => {
    const burst = () => setConfettiAt(Date.now())
    const startTour = () => setTour(true)
    document.addEventListener('spoon-confetti', burst)
    document.addEventListener('spoon-tour', startTour)
    return () => {
      document.removeEventListener('spoon-confetti', burst)
      document.removeEventListener('spoon-tour', startTour)
    }
  }, [])

  return (
    <AvatarProvider settings={settings}>
    <div
      className={`app ${busy ? 'busy' : ''}`}
      data-theme={theme}
      data-pack={settings?.themePack ?? 'spoon'}
      data-icons={settings?.iconStyle ?? 'color'}
    >
      <div className="toolbar">
        <div className="tb-group" data-tour="sync">
          <Button className="tb-btn brand" data-ico="brand" title="About Spoon" aria-label="About Spoon" onClick={() => setOverlay({ type: 'about' })}>
            <IcoSpoon />
            <span>Spoon</span>
          </Button>
          <Button className="tb-btn" data-ico="launch" title="Quick Launch (Ctrl+P)" onClick={() => setQuick(true)}>
            <IcoLaunch />
            <span>Quick Launch</span>
          </Button>
          <Button className="tb-btn" data-ico="workspaces" title="Manage workspaces" onClick={() => setManageWs(true)}>
            <IcoWorkspaces />
            <span>Workspaces</span>
          </Button>
          <Button className="tb-btn" data-ico="fetch" title="Fetch remote changes" disabled={!active.path} onClick={() => void runRemote('fetch')}>
            <IcoFetch />
            <span>Fetch{snap?.status.behind ? '*' : ''}</span>
          </Button>
          <Button className="tb-btn" data-ico="pull" title="Pull remote changes into this branch" disabled={!active.path} onClick={() => void runRemote('pull')}>
            <IcoPull />
            <span>Pull{snap?.status.behind ? ` ${snap.status.behind}` : ''}</span>
          </Button>
          <Button className="tb-btn" data-ico="push" title="Push this branch to its remote" disabled={!active.path} onClick={() => void runRemote('push')}>
            <IcoPush />
            <span>Push{snap?.status.ahead ? ` ${snap.status.ahead}` : ''}</span>
          </Button>
          <Button className="tb-btn" data-ico="refresh" disabled={!active.path} onClick={() => void reload(active.path)} title="Refresh this repository">
            <IcoRefresh />
            <span>Refresh</span>
          </Button>
          <Button className="tb-btn" data-ico="stash" disabled={!active.path} onClick={() => setOverlay({ type: 'stash' })}>
            <IcoStash />
            <span>Stash</span>
          </Button>
        </div>
        <div className="tb-group center">
          <div className="branch-chip">
            <div className="repo">
              {active.kind === 'repo' ? active.name : 'Your code. In flow.'}
              {activeGroup ? (
                <span className="ws-pill" style={{ ['--group' as string]: activeGroup.color }}>
                  {activeGroup.name}
                </span>
              ) : null}
            </div>
            <div className="br">
              {active.kind === 'repo' ? (
                <>
                  <IcoBranch /> {snap?.status.detached ? 'detached HEAD' : snap?.status.branch || '...'}
                </>
              ) : (
                'Open a repository to start'
              )}
            </div>
          </div>
        </div>
        <div className="tb-group right">
          <Button className="tb-btn" data-ico="branch" disabled={!active.path} onClick={() => setOverlay({ type: 'branch' })}>
            <IcoBranch />
            <span>New Branch</span>
          </Button>
          <Button
            className="tb-btn"
            data-ico="terminal"
            disabled={!active.path}
            title="Open with default IDE, agent, or CLI"
            onClick={() => {
              if (!active.path) return
              void window.spoon.app.openWith(active.path)
            }}
            onContextMenu={(event) => {
              event.preventDefault()
              if (!active.path) return
              void window.spoon.app.launchers().then((result: { launchers: LauncherInfo[]; defaultId: string }) => {
                openMenu(openWithMenuItems(result.launchers, { defaultId: result.defaultId }), (id) => {
                  if (id.startsWith('open:') && active.path) void window.spoon.app.openWith(active.path, id.slice(5))
                })
              })
            }}
          >
            <IcoOpen />
            <span>Open with</span>
          </Button>
          <Button className="tb-btn" data-ico="health" disabled={!active.path} onClick={() => setOverlay({ type: 'health' })}>
            <IcoHealth />
            <span>Health</span>
          </Button>
          <Button className="tb-btn" data-ico="activity" onClick={() => setActivityOpen((v) => !v)}>
            <IcoConsole />
            <span>Console</span>
          </Button>
          <Button className="tb-btn" data-ico="home" data-tour="home" onClick={goHome}>
            <IcoHome />
            <span>Home</span>
          </Button>
          <Button
            className="tb-btn"
            data-ico="settings"
            data-tour="prefs"
            title="Appearance, AI, and Help"
            onClick={() => setOverlay({ type: 'settings' })}
          >
            <IcoSettings />
            <span>Settings</span>
          </Button>
          <div className="caption-gap" />
        </div>
      </div>

      <div className="tabs" data-tour="tabs" role="tablist">
        {tabRuns.map((run) => {
          const head = run[0]
          const ws = head.workspaceId ? groupById.get(head.workspaceId) : undefined
          const color = head.color || ws?.color
          const grouped = !!head.workspaceId || (!!head.color && run.length > 1)
          const chips = run.map((tab) => (
            <TabChip
              key={tab.id}
              tab={tab}
              active={tab.id === activeId}
              dirty={!!tab.path && !!snap && tab.path === active.path && snap.status.unstagedCount + snap.status.stagedCount > 0}
              onFocus={() => setActiveId(tab.id)}
              onClose={() => closeTab(tab.id)}
              onMenu={(x, y) => setTabMenu({ tabId: tab.id, x, y })}
            />
          ))
          if (!grouped) return <Fragment key={head.id}>{chips}</Fragment>
          const groupKey = head.workspaceId || `color-${head.color}`
          const groupTitle = ws?.name || 'Grouped by color'
          const collapsed = !!collapsedGroups[groupKey]
          const hasActive = run.some((tab) => tab.id === activeId)
          return (
            <div
              key={groupKey}
              className={`tab-group ${collapsed ? 'collapsed' : ''} ${hasActive ? 'has-active' : ''}`}
              style={{ ['--group' as string]: color }}
            >
              <Button
                type="button"
                className="tab-group-label"
                title={collapsed ? `Expand “${groupTitle}”` : `Collapse “${groupTitle}”`}
                aria-expanded={!collapsed}
                aria-label={groupTitle}
                onClick={() =>
                  setCollapsedGroups((prev) => ({ ...prev, [groupKey]: !prev[groupKey] }))
                }
                onContextMenu={(event) => {
                  event.preventDefault()
                  setTabMenu(null)
                  setGroupMenu({
                    key: groupKey,
                    workspaceId: head.workspaceId,
                    name: ws?.name,
                    x: event.clientX,
                    y: event.clientY,
                    tabIds: run.map((tab) => tab.id)
                  })
                }}
              >
                <i />
                <span className="tab-group-name">{ws?.name || 'Group'}</span>
                {collapsed ? <span className="tab-group-count">{run.length}</span> : null}
              </Button>
              <Button className="tab-group-edit" variant="icon" title={`Edit workspace “${groupTitle}”`} aria-label={`Edit workspace ${groupTitle}`} onClick={() => setEditingWorkspace(ws ?? { id: groupKey, name: groupTitle === 'Grouped by color' ? 'Workspace' : groupTitle, color: color || workspaceColor(0), repos: run.filter((tab) => tab.path).map((tab) => tab.path!) })}><Pencil size={14} /></Button>
              {!collapsed ? chips : null}
            </div>
          )
        })}
        <Button className="tab-add" onClick={openManager} aria-label="New tab">
          +
        </Button>
      </div>

      <div className="body">
        {active.kind === 'manager' || !active.path ? (
          <RepoHome
            recent={recent}
            settings={settings}
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
            workspaces={workspaces}
            onOpenWorkspace={(ws) => void openRepos(ws.repos, ws)}
            onOpenSelection={openSelection}
            onSaveWorkspace={(repos) => void persistNewWorkspace(repos)}
            onAddToWorkspace={(workspace, paths) => void addReposToWorkspace(workspace, paths)}
            onDeleteWorkspace={(id) => void removeWorkspace(id)}
            onEditWorkspace={setEditingWorkspace}
            onSettings={async (patch) => {
              const s = await window.spoon.app.patchSettings(patch)
              setSettings(s)
            }}
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
          <div className="empty loading">Loading repository...</div>
        )}
      </div>

      {manageWs && (
        <WorkspaceManager
          workspaces={workspaces}
          recent={recent}
          settings={settings}
          accounts={accounts}
          onEdit={setEditingWorkspace}
          onClose={() => setManageWs(false)}
          onOpen={(ws) => {
            setManageWs(false)
            void openRepos(ws.repos, ws)
          }}
          onDelete={(id) => void removeWorkspace(id)}
          onWorkspaces={setWorkspaces}
          onOpenAiSettings={() => {
            setManageWs(false)
            setOverlay({ type: 'settings', tab: 'ai' })
          }}
        />
      )}
      {editingWorkspace && <WorkspaceEditor
        workspace={editingWorkspace}
        recent={recent}
        onClose={() => setEditingWorkspace(null)}
        onSave={async (patch) => {
          if (editingWorkspace.id.startsWith('draft-') || editingWorkspace.id.startsWith('color-')) {
            const result = await window.spoon.app.saveWorkspace({ name: patch.name, color: patch.color, repos: patch.repos }) as { workspaces: RepoWorkspace[]; saved: RepoWorkspace }
            setWorkspaces(result.workspaces)
            setDrafts((items) => items.filter((item) => item.id !== editingWorkspace.id))
            setTabs((items) => clusterGrouped(items.map((tab) => patch.repos.some((path) => path.toLowerCase() === tab.path?.toLowerCase())
              ? { ...tab, workspaceId: result.saved.id, color: result.saved.color }
              : tab.workspaceId === editingWorkspace.id ? { ...tab, workspaceId: undefined, color: undefined } : tab)))
          } else await updateWorkspace(editingWorkspace, patch)
          setEditingWorkspace(null)
        }}
      />}
      {tabMenu && menuTab?.kind === 'repo' && (
        <TabGroupMenu
          x={tabMenu.x}
          y={tabMenu.y}
          workspaces={workspaces}
          canCloseWorkspace={!!menuTab.workspaceId}
          onClose={() => setTabMenu(null)}
          onColor={(color) => paintTab(menuTab.id, color)}
          onWorkspace={(ws) => void moveTabToWorkspace(menuTab, ws)}
          onCloseWorkspace={() => {
            if (!menuTab.workspaceId) return
            setTabMenu(null)
            closeWorkspaceTabs(menuTab.workspaceId)
          }}
        />
      )}
      {groupMenu && (
        <WorkspaceGroupMenu
          x={groupMenu.x}
          y={groupMenu.y}
          label={groupMenu.name}
          onEdit={() => {
            const paths = tabsRef.current.filter((tab) => groupMenu.tabIds.includes(tab.id) && tab.path).map((tab) => tab.path!)
            const saved = groupMenu.workspaceId ? groupById.get(groupMenu.workspaceId) : undefined
            setEditingWorkspace(saved ?? { id: groupMenu.key, name: groupMenu.name || 'Workspace', color: tabsRef.current.find((tab) => groupMenu.tabIds.includes(tab.id))?.color || workspaceColor(0), repos: paths })
            setGroupMenu(null)
          }}
          onSave={() => {
            const paths = tabsRef.current.filter((tab) => groupMenu.tabIds.includes(tab.id) && tab.path).map((tab) => tab.path!)
            const saved = groupMenu.workspaceId ? groupById.get(groupMenu.workspaceId) : undefined
            if (saved && !saved.id.startsWith('draft-')) void updateWorkspace(saved, { repos: paths }).catch(() => {})
            else setEditingWorkspace(saved ?? { id: groupMenu.key, name: groupMenu.name || 'Workspace', color: tabsRef.current.find((tab) => groupMenu.tabIds.includes(tab.id))?.color || workspaceColor(0), repos: paths })
            setGroupMenu(null)
          }}
          onClose={() => setGroupMenu(null)}
          onCloseGroup={() => {
            const ids = groupMenu.tabIds
            setGroupMenu(null)
            closeTabs(ids)
          }}
        />
      )}
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
          onHelp={() => setOverlay({ type: 'settings', tab: 'help' })}
          onAiSettings={() => setOverlay({ type: 'settings', tab: 'ai' })}
          onSettings={async (next) => {
            if (next) await commitSettings(next)
            else await refreshSettings()
          }}
        />
      )}
      {quick && (
        <QuickLaunch
          tabs={tabs}
          recent={recent}
          workspaces={workspaces}
          snap={snap}
          onClose={() => setQuick(false)}
          onOpen={(p, n) => {
            setQuick(false)
            void loadRepo(p, n)
          }}
          onOpenWorkspace={(ws) => {
            setQuick(false)
            void openRepos(ws.repos, ws)
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
            Activity <Button className="ghost" onClick={() => setActivityOpen(false)}>Close</Button>
          </h3>
          <pre>
            {activity
              .slice(0, 12)
              .map((a) => `[${a.status}] ${a.title}\n${a.command ?? ''}\n${a.output ?? ''}`)
              .join('\n\n') || 'No activity yet.'}
          </pre>
        </div>
      )}
      <UpdateBar
        state={update}
        onCheck={() => void window.spoon.app.checkUpdate().then((s) => setUpdate(s as UpdateState))}
        onInstall={() => window.spoon.app.installUpdate()}
        onDismiss={() => setUpdate({ status: 'idle' })}
      />
      <Tour
        open={tour}
        onClose={() => {
          setTour(false)
          void window.spoon.app.patchSettings({ onboarded: true }).then(setSettings)
        }}
      />
      <ConfettiBurst token={confettiAt} />
    </div>
    </AvatarProvider>
  )
}

function quietUpdateMiss(error?: string): boolean {
  if (!error) return false
  const m = error.toLowerCase()
  return (
    m.includes('cannot find latest.yml') ||
    (m.includes('latest.yml') && (m.includes('404') || m.includes('not found'))) ||
    m.includes('unable to find latest version on github')
  )
}

function UpdateBar({
  state,
  onCheck,
  onInstall,
  onDismiss
}: {
  state: UpdateState
  onCheck: () => void
  onInstall: () => void
  onDismiss: () => void
}) {
  if (state.status === 'idle' || state.status === 'disabled' || state.status === 'none' || state.status === 'checking') {
    return null
  }
  if (state.status === 'error' && quietUpdateMiss(state.error)) {
    return null
  }
  return (
    <div className={`update-bar ${state.status}`}>
      {state.status === 'available' && <span>Spoon {state.version} is available. Downloading...</span>}
      {state.status === 'downloading' && <span>Downloading Spoon {state.version}... {state.percent ?? 0}%</span>}
      {state.status === 'ready' && (
        <>
          <span>Spoon {state.version} is ready. Restart to install.</span>
          <Button className="primary" onClick={onInstall}>
            Restart and install
          </Button>
        </>
      )}
      {state.status === 'error' && (
        <>
          <span>Update failed{state.error ? `: ${state.error}` : ''}</span>
          <Button className="ghost" onClick={onCheck}>
            Retry
          </Button>
        </>
      )}
      <Button className="ghost" onClick={onDismiss}>
        Dismiss
      </Button>
    </div>
  )
}

function ConfettiBurst({ token }: { token: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    if (!token) return
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const resize = () => {
      canvas.width = Math.floor(window.innerWidth * dpr)
      canvas.height = Math.floor(window.innerHeight * dpr)
      canvas.style.width = `${window.innerWidth}px`
      canvas.style.height = `${window.innerHeight}px`
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    resize()

    const colors = ['#7c3aed', '#c4b5fd', '#ffffff', '#f59e0b', '#6cb6ff', '#f472b6', '#34d399', '#fb7185', '#a78bfa', '#22d3ee']
    type Bit = {
      x: number
      y: number
      vx: number
      vy: number
      w: number
      h: number
      rot: number
      vr: number
      color: string
      shape: 0 | 1 | 2 | 3
      drag: number
      flutter: number
      phase: number
      alive: boolean
    }

    const W = () => window.innerWidth
    const H = () => window.innerHeight
    const bits: Bit[] = Array.from({ length: 240 }, (_, i) => {
      const w = 4 + Math.random() * 9
      return {
        x: Math.random() * W(),
        y: H() + 8 + Math.random() * 40,
        vx: (Math.random() - 0.5) * 420,
        vy: -(780 + Math.random() * 920),
        w,
        h: w * (0.35 + Math.random() * 1.1),
        rot: Math.random() * Math.PI * 2,
        vr: (Math.random() - 0.5) * 14,
        color: colors[i % colors.length],
        shape: (i % 4) as 0 | 1 | 2 | 3,
        drag: 0.01 + Math.random() * 0.02,
        flutter: 40 + Math.random() * 90,
        phase: Math.random() * Math.PI * 2,
        alive: true
      }
    })

    const gravity = 1680
    let last = performance.now()
    let raf = 0
    let living = bits.length

    const tick = (now: number) => {
      const dt = Math.min(0.033, (now - last) / 1000)
      last = now
      const width = W()
      const height = H()
      ctx.clearRect(0, 0, width, height)

      living = 0
      for (const b of bits) {
        if (!b.alive) continue
        living++

        b.vy += gravity * dt
        // Light air drag + sideways flutter while falling / rising
        b.vx += Math.sin(now / 180 + b.phase) * b.flutter * dt
        b.vx *= 1 - b.drag * 60 * dt
        b.vy *= 1 - b.drag * 18 * dt
        b.x += b.vx * dt
        b.y += b.vy * dt
        b.rot += b.vr * dt
        // Spin slows near apex, picks up a bit while falling
        b.vr *= 1 - 0.35 * dt
        if (b.vy > 0) b.vr += Math.sin(now / 140 + b.phase) * 2.2 * dt

        if (b.y > height + 60 || b.x < -80 || b.x > width + 80) {
          b.alive = false
          continue
        }

        ctx.save()
        ctx.translate(b.x, b.y)
        ctx.rotate(b.rot)
        ctx.fillStyle = b.color
        if (b.shape === 1) {
          ctx.fillRect(-b.w / 2, -b.w / 2, b.w, b.w)
        } else if (b.shape === 2) {
          ctx.beginPath()
          ctx.arc(0, 0, b.w / 2, 0, Math.PI * 2)
          ctx.fill()
        } else if (b.shape === 3) {
          ctx.fillRect(-b.w * 0.14, -b.h * 0.7, b.w * 0.28, b.h * 1.4)
        } else {
          ctx.fillRect(-b.w / 2, -b.h / 2, b.w, b.h)
        }
        ctx.restore()
      }

      if (living > 0) raf = requestAnimationFrame(tick)
      else ctx.clearRect(0, 0, width, height)
    }

    raf = requestAnimationFrame(tick)
    window.addEventListener('resize', resize)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', resize)
    }
  }, [token])

  if (!token) return null
  return <canvas ref={canvasRef} className="confetti" aria-hidden />
}

function ModelMenu({
  value,
  choices,
  onChange,
  onNeedSetup
}: {
  value: string
  choices: AiModelChoice[]
  onChange: (id: string) => void
  onNeedSetup?: () => void
}) {
  const btnRef = useRef<HTMLButtonElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const listId = useId()
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [hi, setHi] = useState(value)
  const [pos, setPos] = useState({ bottom: 0, left: 0, width: 280 })
  const current = choices.find((item) => item.id === value) ?? { id: value, label: value }
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    if (!needle) return choices
    return choices.filter((item) => item.label.toLowerCase().includes(needle) || item.id.toLowerCase().includes(needle))
  }, [choices, q])

  useLayoutEffect(() => {
    if (!open || !btnRef.current) return
    const r = btnRef.current.getBoundingClientRect()
    setPos({
      bottom: Math.max(8, window.innerHeight - r.top + 6),
      left: Math.min(r.left, window.innerWidth - Math.max(r.width, 260) - 8),
      width: Math.max(r.width, 260)
    })
  }, [open, filtered.length])

  useEffect(() => {
    if (!open) return
    setHi(value)
    setQ('')
    const onDoc = (e: PointerEvent) => {
      const t = e.target as Node
      if (btnRef.current?.contains(t) || listRef.current?.contains(t)) return
      setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        setOpen(false)
        btnRef.current?.focus()
      }
    }
    document.addEventListener('pointerdown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, value])

  const move = (dir: 1 | -1) => {
    if (!filtered.length) return
    const i = Math.max(0, filtered.findIndex((item) => item.id === hi))
    setHi(filtered[(i + dir + filtered.length) % filtered.length].id)
  }

  const pick = (id: string) => {
    onChange(id)
    setOpen(false)
    btnRef.current?.focus()
  }

  return (
    <div className={`menu-select model-menu${open ? ' open' : ''}`}>
      <Button
        ref={btnRef}
        type="button"
        className="menu-select-btn model-select"
        title="AI model"
        aria-label="AI model"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => {
          if (onNeedSetup) {
            onNeedSetup()
            return
          }
          setOpen((v) => !v)
        }}
        onKeyDown={(e) => {
          if (onNeedSetup && (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault()
            onNeedSetup()
            return
          }
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault()
            if (!open) setOpen(true)
            else move(e.key === 'ArrowDown' ? 1 : -1)
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
      {open &&
        createPortal(
          <div
            ref={listRef}
            id={listId}
            className="menu-select-list model-menu-list"
            style={{ position: 'fixed', bottom: pos.bottom, left: pos.left, width: pos.width }}
          >
            {choices.length > 8 && (
              <input
                className="model-filter"
                value={q}
                placeholder="Filter models"
                aria-label="Filter models"
                autoFocus
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                    e.preventDefault()
                    move(e.key === 'ArrowDown' ? 1 : -1)
                  }
                  if (e.key === 'Enter' && filtered[0]) {
                    e.preventDefault()
                    pick(hi && filtered.some((item) => item.id === hi) ? hi : filtered[0].id)
                  }
                }}
              />
            )}
            <ul role="listbox" aria-label="AI models">
              {filtered.map((item) => (
                <li key={item.id} role="presentation">
                  <Button
                    type="button"
                    role="option"
                    aria-selected={item.id === value}
                    className={`menu-select-opt${item.id === value ? ' on' : ''}${item.id === hi ? ' hi' : ''}`}
                    onMouseEnter={() => setHi(item.id)}
                    onClick={() => pick(item.id)}
                  >
                    {item.label}
                  </Button>
                </li>
              ))}
              {!filtered.length && <li className="menu-select-empty">No models match</li>}
            </ul>
          </div>,
          document.body
        )}
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
  const historyLayout = settings?.historyLayout ?? 'bottom'
  const [filter, setFilter] = useState('')
  const [sideCollapsed, setSideCollapsed] = useState<Set<string>>(() => new Set())
  const [focusBranch, setFocusBranch] = useState<string | null>(null)
  const [pulseKey, setPulseKey] = useState(0)
  const [pulseHashes, setPulseHashes] = useState<string[]>([])
  const [search, setSearch] = useState('')
  const [file, setFile] = useState<string | null>(null)
  const [stagedFocus, setStagedFocus] = useState(false)
  const [unstagedSel, setUnstagedSel] = useState<string[]>([])
  const [stagedSel, setStagedSel] = useState<string[]>([])
  const [typeFilter, setTypeFilter] = useState<string[]>([])
  const [fileAnchor, setFileAnchor] = useState<string | null>(null)
  const [diffs, setDiffs] = useState<FileDiff[]>([])
  const [commitDiffs, setCommitDiffs] = useState<FileDiff[]>([])
  const [changeMenu, setChangeMenu] = useState<ContextState | null>(null)
  const closeChangeMenu = useCallback(() => setChangeMenu(null), [])
  const [fileEditors, setFileEditors] = useState<LauncherInfo[]>([])
  useEffect(() => {
    let alive = true
    void window.spoon.app.launchers().then(({ launchers }: { launchers: LauncherInfo[] }) => { if (alive) setFileEditors(launchers.filter((item) => item.available && item.kind === 'ide')) }).catch(() => {})
    return () => { alive = false }
  }, [])
  const [split, setSplit] = useState(settings?.diffMode === 'split')
  const [msg, setMsg] = useState('')
  const [amend, setAmend] = useState(false)
  const [aiBusy, setAiBusy] = useState(false)
  const [aiBusyText, setAiBusyText] = useState('')
  const [commitBusy, setCommitBusy] = useState(false)
  const [planBusy, setPlanBusy] = useState(false)
  const [analysis, setAnalysis] = useState<ChangeAnalysis | null>(null)
  const [drafts, setDrafts] = useState<DraftCommit[]>([])
  const [refCommits, setRefCommits] = useState<CommitInfo[] | null>(null)
  const [tree, setTree] = useState<FileTreeNode[]>([])
  const [filesW, setFilesW] = useState(settings?.changesListWidth ?? 280)
  const [splitRatio, setSplitRatio] = useState(settings?.changesSplit ?? 0.55)
  const [detailsH, setDetailsH] = useState(settings?.detailsHeight ?? 260)
  const [commitH, setCommitH] = useState(settings?.commitBoxHeight ?? 168)
  const provider = resolveAiProvider(settings, accounts)
  const aiConfigured = hasConnectedAi(accounts)
  const model = defaultModelFor(provider, settings)
  const modelChoices = modelOptions(catalogs[provider], model)
  const committingRef = useRef(false)

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

  const shownUnstaged = useMemo(
    () => (settings?.hideUntracked ? snap.status.unstaged.filter((f) => !f.untracked) : snap.status.unstaged),
    [snap.status.unstaged, settings?.hideUntracked]
  )
  // File types come from whatever is changed right now, so the choices always match the lists.
  const changeTypes = useMemo(() => {
    const counts = new Map<string, number>()
    for (const f of [...shownUnstaged, ...snap.status.staged]) {
      const type = fileType(f.path)
      counts.set(type, (counts.get(type) ?? 0) + 1)
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  }, [shownUnstaged, snap.status.staged])
  const activeTypes = useMemo(
    () => typeFilter.filter((type) => changeTypes.some(([t]) => t === type)),
    [typeFilter, changeTypes]
  )
  const visibleUnstaged = useMemo(
    () => (activeTypes.length ? shownUnstaged.filter((f) => activeTypes.includes(fileType(f.path))) : shownUnstaged),
    [shownUnstaged, activeTypes]
  )
  const visibleStaged = useMemo(
    () => (activeTypes.length ? snap.status.staged.filter((f) => activeTypes.includes(fileType(f.path))) : snap.status.staged),
    [snap.status.staged, activeTypes]
  )

  useEffect(() => {
    const unstaged = new Set(shownUnstaged.map((f) => f.path))
    const staged = new Set(snap.status.staged.map((f) => f.path))
    const unstagedShown = new Set(visibleUnstaged.map((f) => f.path))
    const stagedShown = new Set(visibleStaged.map((f) => f.path))
    // Selecting a file and then filtering it away must not leave it selected out of sight.
    setUnstagedSel((prev) => prev.filter((p) => unstagedShown.has(p)))
    setStagedSel((prev) => prev.filter((p) => stagedShown.has(p)))
    // A stashed, discarded, or committed file has nothing left to show.
    setFile((prev) => (prev && !unstaged.has(prev) && !staged.has(prev) ? null : prev))
  }, [shownUnstaged, visibleUnstaged, visibleStaged, snap.status.staged])

  useEffect(() => {
    let current = true
    setCommitDiffs([]); setTree([])
    if ((detailTab === 'changes' || historyLayout === 'columns') && commit) {
      void window.spoon.git.diff(path, { commit: commit.hash }).then((d) => { if (current) setCommitDiffs(d as FileDiff[]) }).catch((reason) => { if (current) void window.spoon.app.error(String(reason)) })
    }
    if ((detailTab === 'tree' || historyLayout === 'columns') && commit) {
      void window.spoon.git.tree(path, commit.hash).then((t) => { if (current) setTree(t as FileTreeNode[]) }).catch((reason) => { if (current) void window.spoon.app.error(String(reason)) })
    }
    return () => { current = false }
  }, [detailTab, commit, path, historyLayout])

  async function doStage(list: string[], unstage = false) {
    if (unstage) await window.spoon.git.unstage(path, list)
    else await window.spoon.git.stage(path, list)
    onReload()
  }

  async function doCommit(pushAfter: boolean) {
    if (committingRef.current) return
    if (!msg.trim() && !amend) return
    committingRef.current = true
    setCommitBusy(true)
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
    committingRef.current = false
    setCommitBusy(false)
  }

  function openAiSettings() {
    onOverlay({ type: 'settings', tab: 'ai' })
  }

  function requireAi(): boolean {
    if (aiConfigured) return true
    openAiSettings()
    return false
  }

  async function aiFill(andGo: 'fill' | 'commit' | 'commit-push' = settings?.aiCommitMode ?? 'commit') {
    if (!requireAi()) return
    if (andGo !== 'fill' && !amend) {
      await aiSplitCommit(andGo === 'commit-push')
      return
    }
    setAiBusy(true)
    setAiBusyText('Writing...')
    await catchErr(async () => {
      if (andGo !== 'fill' && !snap.status.stagedCount) {
        if (settings?.aiStageAll === false) {
          await window.spoon.app.error('Stage changes first, or enable “Stage all when empty” in Settings → AI.')
          return
        }
        await window.spoon.git.stageAll(path)
      }
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
    setAiBusyText('')
  }

  async function aiSplitCommit(pushAfter: boolean) {
    if (committingRef.current) return
    if (snap.status.merging || snap.status.rebasing || snap.status.cherryPicking) {
      await window.spoon.app.error('Finish the merge, rebase, or cherry-pick before creating commits.')
      return
    }
    const staged = snap.status.stagedCount
    const dirty = staged + snap.status.unstagedCount
    if (!dirty) {
      await window.spoon.app.error('Nothing to commit.')
      return
    }
    if (!staged && settings?.aiStageAll === false) {
      await window.spoon.app.error('Stage changes first, or enable “Stage all when empty” in Settings → AI.')
      return
    }
    committingRef.current = true
    setAiBusy(true)
    setAiBusyText('Analyzing...')
    onBusy(true)
    let made = 0
    await catchErr(async () => {
      const result = (await window.spoon.ai.analyze(path, provider, model, staged ? 'staged' : 'all')) as ChangeAnalysis
      const chosen = result.commits.filter((item) => item.subject.trim() && item.files.length)
      if (!chosen.length) throw new Error('The analysis did not name any commits.')
      setAiBusyText(chosen.length > 1 ? `Committing ${chosen.length}...` : 'Committing...')
      await window.spoon.git.unstageAll(path)
      for (const item of chosen) {
        await window.spoon.git.stage(path, item.files)
        const message = item.body.trim() ? `${item.subject.trim()}\n\n${item.body.trim()}` : item.subject.trim()
        await window.spoon.git.commit(path, { message })
        made++
      }
      if (pushAfter) {
        await pushHead(path, snap)
        document.dispatchEvent(new CustomEvent('spoon-confetti'))
      }
    })
    if (made) {
      setMsg('')
      setAmend(false)
      setAnalysis(null)
      setDrafts([])
      onReload()
    }
    onBusy(false)
    committingRef.current = false
    setAiBusy(false)
    setAiBusyText('')
  }

  async function runAnalysis() {
    if (!requireAi()) return
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
      `${chosen.map((item) => item.subject).join('\n')}\n\nNothing is pushed. Each commit includes the whole file, in an order that keeps the previous commit valid.`
    )
    if (!ok) return
    onBusy(true)
    let made = 0
    await catchErr(async () => {
      await window.spoon.git.unstageAll(path)
      for (const item of chosen) {
        await window.spoon.git.stage(path, item.files)
        const message = item.body.trim() ? `${item.subject.trim()}\n\n${item.body.trim()}` : item.subject.trim()
        await window.spoon.git.commit(path, { message })
        made++
      }
    })
    if (made) {
      setAnalysis(null)
      setDrafts([])
      setMsg('')
      onReload()
    }
    onBusy(false)
  }

  useEffect(() => {
    const c = () => void doCommit(false)
    const cp = () => void doCommit(true)
    const fill = () => void aiFill('fill')
    const ai = () => void aiFill('commit')
    const aip = () => void aiFill('commit-push')
    const primary = () => void aiFill()
    const an = () => void runAnalysis()
    document.addEventListener('spoon-commit', c)
    document.addEventListener('spoon-commit-push', cp)
    document.addEventListener('spoon-ai-fill', fill)
    document.addEventListener('spoon-ai-commit', ai)
    document.addEventListener('spoon-ai-commit-push', aip)
    document.addEventListener('spoon-ai-primary', primary)
    document.addEventListener('spoon-analyze', an)
    return () => {
      document.removeEventListener('spoon-commit', c)
      document.removeEventListener('spoon-commit-push', cp)
      document.removeEventListener('spoon-ai-fill', fill)
      document.removeEventListener('spoon-ai-commit', ai)
      document.removeEventListener('spoon-ai-commit-push', aip)
      document.removeEventListener('spoon-ai-primary', primary)
      document.removeEventListener('spoon-analyze', an)
    }
  }, [path, msg, amend, snap, provider, model, aiConfigured, settings?.aiCommitMode, settings?.aiStageAll])

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
        { id: 'new', label: 'New branch...' },
        { type: 'separator' },
        { id: `co:${b.name}`, label: 'Checkout' },
        { id: `merge:${b.name}`, label: 'Merge into current' },
        { id: `rebase:${b.name}`, label: 'Rebase current onto...' },
        { type: 'separator' },
        { id: `ren:${b.name}`, label: 'Rename...' },
        { id: `del:${b.name}`, label: 'Delete...' }
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
        { id: 'add', label: 'Add remote...' },
        { id: 'edit', label: 'Edit URL...' },
        { id: 'rename', label: 'Rename...' },
        { id: 'fetch', label: 'Fetch' },
        { type: 'separator' },
        { id: 'remove', label: 'Remove remote...' }
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
    const rows = staged ? visibleStaged : visibleUnstaged
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

  function fileMenu(entry: StatusEntry, staged: boolean, event: MouseEvent, exactLine?: number) {
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
    const run = (fn: () => Promise<unknown>) => () => void catchErr(async () => { await fn() })
    const deleted = (staged ? entry.index : entry.worktree) === 'D'
    const openAt = async (editor?: string) => {
      const fresh = await window.spoon.git.diff(path, { path: entry.path, staged }) as FileDiff[]
      await window.spoon.git.openFileAt(path, entry.path, exactLine ?? firstChangedLine(fresh.find((d) => d.path === entry.path)), editor, staged)
    }
    const box = event.currentTarget.getBoundingClientRect()
    const menu: ContextState = { x: event.clientX || box.left + 20, y: event.clientY || box.bottom, title: `${entry.path}${exactLine ? `:${exactLine}` : ''}`, items: [
      { label: exactLine ? `Open in editor · line ${exactLine}` : 'Open in editor at change', icon: <FileCode2 />, disabled: deleted, run: run(() => openAt()) },
      ...(fileEditors.length > 1 ? fileEditors.map((editor) => ({ label: `Open with ${editor.label}`, icon: <FileCode2 />, disabled: deleted, run: run(() => openAt(editor.id)) })) : []),
      { label: 'Show in Windows Explorer', icon: <FolderOpen />, run: run(() => window.spoon.git.revealFile(path, entry.path)) },
      {},
      { label: staged ? (n > 1 ? `Unstage ${n} files` : 'Unstage') : n > 1 ? `Stage ${n} files` : 'Stage', icon: staged ? <Undo2 /> : <Plus />, run: run(() => doStage(paths, staged)) },
      { label: n > 1 ? `Stash ${n} files…` : 'Stash this file…', icon: <IcoStash />, run: () => onOverlay({ type: 'stash', files: paths }) },
      { label: n > 1 ? `Discard ${n} files…` : 'Discard changes…', icon: <Trash2 />, danger: true, run: run(async () => { if (await window.spoon.app.confirm(n > 1 ? `Discard changes in ${n} files?` : `Discard changes in ${entry.path}?`)) { await window.spoon.git.discard(path, paths); onReload() } }) },
      {},
      { label: n > 1 ? 'Copy relative paths' : 'Copy relative path', icon: <Copy />, run: run(() => window.spoon.app.copy(paths.join('\n'))) },
      { label: n > 1 ? 'Copy full paths' : 'Copy full path', icon: <Copy />, run: run(() => window.spoon.app.copy(paths.map((p) => joinRepoPath(path, p)).join('\n'))) },
      { label: 'Copy patch', icon: <Copy />, disabled: entry.untracked, run: run(async () => { const parts = await Promise.all(paths.map((p) => window.spoon.git.diff(path, { path: p, staged }))); await window.spoon.app.copy((parts.flat() as FileDiff[]).map((d) => d.patch).join('\n')) }) },
      {},
      { label: 'Blame', icon: <ScanLine />, disabled: entry.untracked, run: () => onOverlay({ type: 'blame', file: entry.path }) },
      { label: 'File history', icon: <History />, disabled: entry.untracked, run: () => onOverlay({ type: 'history', file: entry.path }) }
    ] }
    setChangeMenu(menu)
  }

  const local = snap.branches
    .filter((b) => !b.remote)
    .slice()
    .sort((a, b) => Number(b.current) - Number(a.current) || a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
  const remotes = snap.branches.filter((b) => b.remote)
  const q = filter.toLowerCase()
  const match = (n: string) => !q || n.toLowerCase().includes(q)
  const isRemoteHead = (b: BranchInfo) =>
    b.fullName.endsWith('/HEAD') || /(^|\/)HEAD$/.test(b.name)
  const remoteGroups = [...remotes.reduce((map, b) => {
    if (isRemoteHead(b)) return map
    const remote = b.name.includes('/') ? b.name.slice(0, b.name.indexOf('/')) : b.name
    const list = map.get(remote) ?? []
    list.push(b)
    map.set(remote, list)
    return map
  }, new Map<string, BranchInfo[]>())].sort((a, b) => a[0].localeCompare(b[0], undefined, { sensitivity: 'base' }))
  const groupedRemotes = new Set(remoteGroups.map(([name]) => name))
  for (const remote of snap.remotes) {
    if (!groupedRemotes.has(remote.name)) remoteGroups.push([remote.name, []])
  }
  const filtering = !!q
  const sideOpen = (id: string) => filtering || !sideCollapsed.has(id)
  const toggleSide = (id: string) => {
    if (filtering) return
    setSideCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }
  const localVisible = local.filter((b) => match(b.name))
  const branchLanes = useMemo(() => new Map(snap.commits.map((c) => [c.hash, c.lane])), [snap.commits])
  const localTree = groupByPathPrefix(localVisible, (b) => b.name)
  const sortBranches = (list: BranchInfo[]) =>
    list.slice().sort((a, b) => Number(b.current) - Number(a.current) || a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))

  function renderLocalBranch(b: BranchInfo, deep = false) {
    return (
      <div
        key={b.fullName}
        className={`side-item branch-row ${b.current ? 'is-current' : ''} ${deep ? 'deep' : ''} ${(sel.kind === 'branch' && sel.name === b.name) || focusBranch === b.name ? 'active' : ''}`}
        style={{ ['--lane-color' as string]: laneColor(branchLanes.get(b.hash) ?? 0) }}
        title={`${b.name}${b.upstream ? ` · tracks ${b.upstream}` : ''} · Double-click to checkout`}
        role="button" tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); clickLocalBranch(b) } }}
        onClick={() => clickLocalBranch(b)}
        onDoubleClick={() => void window.spoon.git.checkout(path, b.name).then(onReload)}
        onContextMenu={(e) => {
          e.preventDefault()
          branchCtx(b)
        }}
      >
        <IcoBranch />
        <span className="label">{deep ? branchLeafName(b.name) : b.name}</span>
        {b.current && <span className="head-badge">HEAD</span>}
        {b.ahead || b.behind ? (
          <span className="ahead">
            {b.ahead ? `↑${b.ahead}` : ''}
            {b.ahead && b.behind ? ' ' : ''}
            {b.behind ? `↓${b.behind}` : ''}
          </span>
        ) : null}
      </div>
    )
  }

  function renderRemoteBranch(b: BranchInfo, remote: string, short: string, deep = false) {
    const leaf = deep ? branchLeafName(short) : short
    return (
      <div
        key={b.fullName}
        className={`side-item branch-row indent ${deep ? 'deep' : ''} ${(sel.kind === 'remote' && sel.name === b.name) || focusBranch === b.name ? 'active' : ''}`}
        style={{ ['--lane-color' as string]: laneColor(branchLanes.get(b.hash) ?? 1) }}
        title={`${b.name} · Double-click to checkout`}
        role="button" tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); clickRemoteBranch(b) } }}
        onClick={() => clickRemoteBranch(b)}
        onDoubleClick={() => void window.spoon.git.checkout(path, short, true).then(onReload)}
        onContextMenu={(e) => {
          e.preventDefault()
          remoteCtx(remote)
        }}
      >
        <IcoBranch />
        <span className="label">{leaf}</span>
      </div>
    )
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
      {changeMenu && <ContextMenu menu={changeMenu} onClose={closeChangeMenu} />}
      <div className="sidebar" style={{ width: sidebarW }}>
        <div className="sidebar-head">
          {snap.status.name}
          <span className="hint">{snap.identity.name}</span>
        </div>
        <div
          className={`side-item ${sel.kind === 'changes' ? 'active' : ''}`}
          role="button" tabIndex={0}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSel({ kind: 'changes' }) } }}
          onClick={() => setSel({ kind: 'changes' })}
        >
          <IcoChanges /> Changes {changesCount ? <span className="counter">({changesCount})</span> : null}
        </div>
        <div
          className={`side-item ${sel.kind === 'all' ? 'active' : ''}`}
          role="button" tabIndex={0}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSel({ kind: 'all' }); setFocusBranch(null) } }}
          onClick={() => {
            setSel({ kind: 'all' })
            setFocusBranch(null)
            setPulseHashes([])
          }}
        >
          <IcoBranch /> History
        </div>
        <div className="side-filter">
          <input placeholder="Find a branch or tag…" aria-label="Filter branches and tags" value={filter} onChange={(e) => setFilter(e.target.value)} />
        </div>
        <div className="side-scroll">
          {snap.status.detached && (
            <>
              <div className="side-sec">Current</div>
              <div className="side-item">
                <span className="dot-check">*</span>
                <span className="label">detached HEAD</span>
              </div>
            </>
          )}
          <div
            className={`side-sec toggle ${sideOpen('local') ? 'open' : ''}`}
            onClick={() => toggleSide('local')}
            onContextMenu={(e) => {
              e.preventDefault()
              openMenu([{ id: 'new', label: 'New branch...' }], (id) => {
                if (id === 'new') onOverlay({ type: 'branch' })
              })
            }}
          >
            <span className="ico chev" aria-hidden>
              <IcoChevron />
            </span>
            Local
            <span className="sec-count">{localVisible.length}</span>
            <Button
              className="sec-add"
              title="New branch"
              onClick={(e) => {
                e.stopPropagation()
                onOverlay({ type: 'branch' })
              }}
            >
              +
            </Button>
          </div>
          {sideOpen('local') && (
            <>
              {sortBranches(localTree.roots).map((b) => renderLocalBranch(b))}
              {localTree.folders.map((folder) => {
                const fid = `local:${folder.key}`
                const items = sortBranches(folder.items)
                return (
                  <Fragment key={fid}>
                    <div
                      className={`side-folder ${sideOpen(fid) ? 'open' : ''}`}
                      onClick={() => toggleSide(fid)}
                    >
                      <span className="ico chev" aria-hidden>
                        <IcoChevron />
                      </span>
                      <span className="label">{folder.key}</span>
                      <span className="sec-count">{items.length}</span>
                    </div>
                    {sideOpen(fid) && items.map((b) => renderLocalBranch(b, true))}
                  </Fragment>
                )
              })}
              {!localVisible.length && (
                <div className="side-empty">{filtering ? 'No matching branches' : 'No local branches'}</div>
              )}
            </>
          )}
          <div
            className={`side-sec toggle ${sideOpen('remotes') ? 'open' : ''}`}
            onClick={() => toggleSide('remotes')}
            onContextMenu={(e) => {
              e.preventDefault()
              openMenu([{ id: 'add', label: 'Add remote...' }], (id) => {
                if (id === 'add') onOverlay({ type: 'remote' })
              })
            }}
          >
            <span className="ico chev" aria-hidden>
              <IcoChevron />
            </span>
            Remotes
            <span className="sec-count">
              {remoteGroups.reduce((n, [, branches]) => n + branches.filter((b) => match(b.name)).length, 0)}
            </span>
            <Button
              className="sec-add"
              title="Add remote"
              onClick={(e) => {
                e.stopPropagation()
                onOverlay({ type: 'remote' })
              }}
            >
              +
            </Button>
          </div>
          {sideOpen('remotes') &&
            (remoteGroups.length ? (
              remoteGroups.map(([remote, branches]) => {
                const visible = branches
                  .filter((b) => match(b.name))
                  .slice()
                  .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
                if (filtering && !visible.length) return null
                const rid = `remote:${remote}`
                const shortOf = (b: BranchInfo) => (b.name.includes('/') ? b.name.slice(b.name.indexOf('/') + 1) : b.name)
                const tree = groupByPathPrefix(visible, shortOf)
                return (
                  <div key={remote} className="side-remote-block">
                    <div
                      className={`side-sec sub toggle ${sideOpen(rid) ? 'open' : ''}`}
                      onClick={() => toggleSide(rid)}
                      onContextMenu={(e) => {
                        e.preventDefault()
                        remoteCtx(remote)
                      }}
                    >
                      <span className="ico chev" aria-hidden>
                        <IcoChevron />
                      </span>
                      <IcoRemote />
                      <span className="label">{remote}</span>
                      <span className="sec-count">{visible.length}</span>
                    </div>
                    {sideOpen(rid) && (
                      <>
                        {tree.roots.map((b) => renderRemoteBranch(b, remote, shortOf(b)))}
                        {tree.folders.map((folder) => {
                          const fid = `${rid}:${folder.key}`
                          return (
                            <Fragment key={fid}>
                              <div
                                className={`side-folder indent ${sideOpen(fid) ? 'open' : ''}`}
                                onClick={() => toggleSide(fid)}
                              >
                                <span className="ico chev" aria-hidden>
                                  <IcoChevron />
                                </span>
                                <span className="label">{folder.key}</span>
                                <span className="sec-count">{folder.items.length}</span>
                              </div>
                              {sideOpen(fid) &&
                                folder.items.map((b) => renderRemoteBranch(b, remote, shortOf(b), true))}
                            </Fragment>
                          )
                        })}
                        {!visible.length && <div className="side-empty">No branches yet</div>}
                      </>
                    )}
                  </div>
                )
              })
            ) : (
              <div className="side-empty">Fetch to see remote branches</div>
            ))}
          <div
            className={`side-sec toggle ${sideOpen('tags') ? 'open' : ''}`}
            onClick={() => toggleSide('tags')}
          >
            <span className="ico chev" aria-hidden>
              <IcoChevron />
            </span>
            Tags
            <span className="sec-count">{snap.tags.filter((t) => match(t.name)).length}</span>
          </div>
          {sideOpen('tags') &&
            snap.tags.filter((t) => match(t.name)).map((t) => (
              <div key={t.name} className="side-item" onClick={() => setSel({ kind: 'tag', name: t.name })}>
                <IcoTag />
                <span className="label">{t.name}</span>
              </div>
            ))}
          {sideOpen('tags') && !snap.tags.filter((t) => match(t.name)).length && (
            <div className="side-empty">No tags</div>
          )}
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
            {snap.status.conflicted.length ? `  -  ${snap.status.conflicted.length} conflicted file(s)` : ''}
            <Button className="ghost" onClick={() => snap.status.conflicted[0] && onOverlay({ type: 'conflict', file: snap.status.conflicted[0].path })}>
              Resolve
            </Button>
            <Button className="ghost" onClick={() => void window.spoon.git.continueMerge(path).then(onReload)}>
              Continue
            </Button>
            <Button className="ghost" onClick={() => void (snap.status.rebasing ? window.spoon.git.rebaseAbort(path) : window.spoon.git.abortMerge(path)).then(onReload)}>
              Abort
            </Button>
          </div>
        ) : null}

        {showingChanges ? (
          <div className="changes-page">
            <div className="history-heading changes-heading"><div><span className="eyebrow">REPOSITORY</span><h2>Working changes <span>{snap.status.unstagedCount + snap.status.stagedCount}</span></h2></div><div className="history-context"><Avatar email={snap.identity.email} name={snap.identity.name} /><span className="branch-pill"><IcoBranch /> {snap.status.branch}</span></div></div>
          <div className="changes">
            <div className="file-cols" style={{ width: filesW }}>
              {changeTypes.length > 1 && (
                <div className="type-filter" role="group" aria-label="Filter changes by file type">
                  <button
                    type="button"
                    className={`type-chip${activeTypes.length ? '' : ' on'}`}
                    aria-pressed={!activeTypes.length}
                    onClick={() => setTypeFilter([])}
                  >
                    All
                  </button>
                  {changeTypes.map(([type, count]) => (
                    <button
                      type="button"
                      key={type}
                      className={`type-chip${activeTypes.includes(type) ? ' on' : ''}`}
                      aria-pressed={activeTypes.includes(type)}
                      title={`Show only ${type} files`}
                      onClick={() =>
                        setTypeFilter(activeTypes.includes(type) ? activeTypes.filter((t) => t !== type) : [...activeTypes, type])
                      }
                    >
                      {type} <span>{count}</span>
                    </button>
                  ))}
                </div>
              )}
              <FilePane
                title="Unstaged"
                action={unstagedSel.length > 1 ? `Stage ${unstagedSel.length}` : activeTypes.length ? 'Stage shown' : 'Stage'}
                onAction={() =>
                  void doStage(unstagedSel.length ? unstagedSel : visibleUnstaged.map((f) => f.path))
                }
                files={visibleUnstaged}
                selected={unstagedSel}
                onSelect={(p, keys) => selectFiles(p, false, keys)}
                onSelectAll={() => {
                  setUnstagedSel(visibleUnstaged.map((f) => f.path))
                  setStagedFocus(false)
                }}
                onContext={(entry, event) => fileMenu(entry, false, event)}
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
                action={stagedSel.length > 1 ? `Unstage ${stagedSel.length}` : activeTypes.length ? 'Unstage shown' : 'Unstage'}
                onAction={() => void doStage(stagedSel.length ? stagedSel : visibleStaged.map((f) => f.path), true)}
                files={visibleStaged}
                selected={stagedSel}
                onSelect={(p, keys) => selectFiles(p, true, keys)}
                onSelectAll={() => {
                  setStagedSel(visibleStaged.map((f) => f.path))
                  setStagedFocus(true)
                }}
                onContext={(entry, event) => fileMenu(entry, true, event)}
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
                <Button className="ghost" disabled={planBusy} title="Split changes into planned commits (Ctrl+Alt+A)" onClick={() => void runAnalysis()}>
                  {planBusy ? 'Analyzing...' : 'Analyze'}
                </Button>
                <Button className="ghost" onClick={() => setSplit((v) => !v)}>
                  {split ? 'Unified' : 'Side by side'}
                </Button>
              </div>
              <DiffView
                repo={path}
                onLineContext={(diff, line, event) => {
                  const entry = (stagedFocus ? snap.status.staged : snap.status.unstaged).find((item) => item.path === diff.path)
                  if (entry) { event.preventDefault(); fileMenu(entry, stagedFocus, event, line) }
                }}
                diffs={file ? diffs.filter((d) => d.path === file || d.origPath === file) : diffs}
                split={split}
                staged={stagedFocus}
                onHunk={(h, mode) => file && void window.spoon.git.applyHunk(path, file, h, mode).then(onReload)}
              />
              {analysis && (
                <div className="analysis">
                  <div className="analysis-head">
                    <strong>Analysis</strong>
                    <span className="hint">Local commits only. Ordered so each one still works after the previous. Nothing is pushed.</span>
                    <Button className="ghost" onClick={() => { setAnalysis(null); setDrafts([]) }}>
                      Close
                    </Button>
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
                      <Button className="ghost" onClick={() => setMsg(item.body.trim() ? `${item.subject}\n\n${item.body.trim()}` : item.subject)}>
                        Use message
                      </Button>
                    </div>
                  ))}
                  <div className="row-btns">
                    <Button className="primary" disabled={!drafts.some((item) => item.include)} onClick={() => void createPlannedCommits()}>
                      Create {drafts.filter((item) => item.include).length} commits
                    </Button>
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
              <div className="commit-box">
                <textarea
                  placeholder="Commit message · Ctrl+Enter to commit"
                  value={msg}
                  style={{ height: Math.max(64, commitH - 80) }}
                  onChange={(e) => setMsg(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key !== 'Enter' || !(e.ctrlKey || e.metaKey)) return
                    e.preventDefault()
                    void doCommit(e.shiftKey)
                  }}
                />
                <div className="commit-bar">
                  <label className="check">
                    <input type="checkbox" checked={amend} onChange={(e) => setAmend(e.target.checked)} /> Amend
                  </label>
                  <span className="hint">{msg.split('\n')[0]?.length || 0}/72</span>
                  <ModelMenu
                    value={model}
                    choices={modelChoices}
                    onNeedSetup={aiConfigured ? undefined : openAiSettings}
                    onChange={(id) =>
                      onPatchSettings({
                        aiModels: { ...(settings?.aiModels ?? DEFAULT_AI_MODELS), [provider]: id }
                      })
                    }
                  />
                  <div className="commit-actions">
                    <Button
                      className="primary ico-text"
                      disabled={aiBusy || commitBusy || (!msg.trim() && !amend)}
                      title="Commit the message above (Ctrl+Enter)"
                      onClick={() => void doCommit(false)}
                    >
                      <IcoCheck />
                      <span>{commitBusy ? 'Committing...' : 'Commit'}</span>
                    </Button>
                    <Button
                      className="ghost ico-text"
                      disabled={aiBusy || commitBusy || (!msg.trim() && !amend)}
                      title="Commit the message above and push (Ctrl+Shift+Enter)"
                      onClick={() => void doCommit(true)}
                    >
                      <IcoPush />
                      <span>Commit & push</span>
                    </Button>
                    <Button
                      className="primary ai ico-text"
                      disabled={aiBusy || commitBusy}
                      title={
                        (settings?.aiCommitMode ?? 'commit') === 'fill'
                          ? 'Write a commit message from the changes'
                          : 'Analyze the changes, split them into commits that stay valid in order, and create them all at once'
                      }
                      onClick={() => void aiFill()}
                    >
                      <IcoAi />
                      <span>
                        {aiBusy
                          ? aiBusyText || 'Working...'
                          : (settings?.aiCommitMode ?? 'commit') === 'fill'
                            ? 'AI message'
                            : (settings?.aiCommitMode ?? 'commit') === 'commit-push'
                              ? 'AI commit & push'
                              : 'AI commits'}
                      </span>
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          </div>
          </div>
        ) : sel.kind === 'stash' ? (
          <StashView
            repo={path}
            split={split}
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
            <div className="history-heading">
              <div><span className="eyebrow">REPOSITORY</span><h2>Commit history <span>{visibleCommits.length}</span></h2></div>
              <div className="history-context">
                <div className="history-layout-buttons" role="group" aria-label="History layout">
                  {(['bottom', 'side', 'columns'] as const).map((layout) => <Button key={layout} variant="segment" aria-pressed={historyLayout === layout} title={layout === 'bottom' ? 'Details below history' : layout === 'side' ? 'Details beside history' : 'History, Commit, Changes and File Tree in columns'} onClick={() => onPatchSettings({ historyLayout: layout })}>{layout === 'bottom' ? 'Bottom' : layout === 'side' ? 'Side' : 'Columns'}</Button>)}
                </div>
                <span className="branch-pill" title={focusBranch || scopeRef || snap.status.branch}><IcoBranch /> {focusBranch || scopeRef || snap.status.branch}</span>
                {focusBranch && <Button className="ghost tiny" onClick={() => { setFocusBranch(null); setPulseHashes([]); setSel({ kind: 'all' }) }}>Show all</Button>}
              </div>
            </div>
            <div className="commit-search">
              <input
                placeholder={scopeRef ? `Commits in ${scopeRef}` : 'Search commits'}
                aria-label="Search commits by message, author or hash"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <Button className="ghost" onClick={() => onOverlay({ type: 'ir' })}>
                Interactive Rebase
              </Button>
              <Button className="ghost" onClick={() => onOverlay({ type: 'reflog' })}>
                Reflog
              </Button>
            </div>
            <div className={`history-content history-${historyLayout}`}>
            <div className="history-list-pane">
            {scopeRef && !refCommits ? (
              <div className="empty loading">Loading commits...</div>
            ) : (
            <VirtualCommits
              commits={visibleCommits}
              selected={commit?.hash}
              showAvatar={settings?.showAvatars !== false}
              pulseKey={pulseKey}
              pulseHashes={pulseHashes}
              connected={!search.trim()}
              onSelect={setCommit}
              onContext={(c, e) => {
                e.preventDefault()
                openMenu(
                  [
                    { id: `co:${c.hash}`, label: 'Checkout' },
                    { id: `ch:${c.hash}`, label: 'Cherry-pick' },
                    { id: `rv:${c.hash}`, label: 'Revert' },
                    { type: 'separator' },
                    { id: `rs:${c.hash}`, label: 'Reset mixed...' },
                    { id: `rh:${c.hash}`, label: 'Reset hard...' },
                    { id: `cp:${c.hash}`, label: 'Copy SHA' },
                    { id: `tg:${c.hash}`, label: 'Create tag...' }
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
            </div>
            {commit && historyLayout === 'bottom' && (
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
            {commit && historyLayout !== 'columns' && (
              <div className="details" style={historyLayout === 'bottom' ? { height: detailsH, flex: '0 0 auto' } : undefined}>
                <div className="detail-tabs">
                  {(['commit', 'changes', 'tree'] as const).map((t) => (
                    <Button variant="tab" key={t} className={detailTab === t ? 'active' : ''} onClick={() => setDetailTab(t)}>
                      {t === 'commit' ? 'Commit' : t === 'changes' ? 'Changes' : 'File Tree'}
                    </Button>
                  ))}
                </div>
                <div className="detail-body">
                  {detailTab === 'commit' && <CommitDetails c={commit} />}
                  {detailTab === 'changes' && <DiffView repo={path} rev={commit.hash} diffs={commitDiffs} split={split} />}
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
            {commit && historyLayout === 'columns' && <>
              <section className="history-column"><h3>Commit</h3><div className="detail-body"><CommitDetails c={commit} /></div></section>
              <section className="history-column history-diff-column"><h3>Changes</h3><div className="detail-body"><DiffView repo={path} rev={commit.hash} diffs={commitDiffs} split={split} /></div></section>
              <section className="history-column"><h3>File Tree</h3><div className="detail-body"><FileTree nodes={tree} onHistory={(f) => onOverlay({ type: 'history', file: f })} onBlame={(f) => onOverlay({ type: 'blame', file: f, rev: commit.hash })} /></div></section>
            </>}
            </div>
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
  onContext?: (file: StatusEntry, event: MouseEvent) => void
  flex?: number
}) {
  return (
    <div className="file-pane" style={{ flex: `${flex} 1 0` }}>
      <div className="file-head">
        <span className="label">
          {title}
          {selected.length > 1 ? <span className="counter">({selected.length})</span> : null}
        </span>
        <Button className="ghost" onClick={onAction}>{action}</Button>
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
            role="button" tabIndex={0} aria-pressed={selected.includes(f.path)}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(f.path, e) } }}
            onClick={(e) => onSelect(f.path, e)}
            onContextMenu={(e) => {
              e.preventDefault()
              onContext?.(f, e)
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
  repo,
  split,
  stash,
  onApply,
  onDrop
}: {
  repo: string
  split: boolean
  stash?: StashInfo
  onApply: (pop: boolean) => void
  onDrop: () => void
}) {
  const [diffs, setDiffs] = useState<FileDiff[] | null>(null)
  const [err, setErr] = useState('')
  const selector = stash?.selector
  const hash = stash?.hash
  useEffect(() => {
    let current = true
    setDiffs(null)
    setErr('')
    if (!selector) return
    window.spoon.git
      .diff(repo, { stash: selector })
      .then((d) => { if (current) setDiffs(d as FileDiff[]) })
      .catch((reason: unknown) => { if (current) setErr(reason instanceof Error ? reason.message : String(reason)) })
    return () => { current = false }
  }, [repo, selector, hash])
  if (!stash) return <div className="empty">That stash is no longer in the list.</div>
  return (
    <div className="stash-view">
      <h2>{stash.message}</h2>
      <p className="hint">
        {stash.selector} - {formatDate(stash.date)}
      </p>
      <div className="row-btns">
        <Button className="primary" onClick={() => onApply(false)}>
          Apply
        </Button>
        <Button className="ghost" onClick={() => onApply(true)}>
          Pop
        </Button>
        <Button className="ghost" onClick={onDrop}>
          Drop
        </Button>
      </div>
      <div className="stash-files">
        {err ? <div className="empty">{err}</div> : !diffs ? <div className="empty loading">Loading stash...</div> : <DiffView repo={repo} rev={stash.selector} diffs={diffs} split={split} />}
      </div>
    </div>
  )
}

type LineContext = (diff: FileDiff, line: number, event: MouseEvent) => void
function SplitHunks({ diff, onLineContext }: { diff: FileDiff; onLineContext?: LineContext }) {
  return (
    <div className="split">
      <div className="side">
        {diff.hunks.flatMap((h) =>
          h.lines
            .filter((l) => l.type !== 'add')
            .map((l, i) => (
              <div key={`l${h.oldStart}-${i}`} className={`diff-line ${l.type}`} onContextMenu={(e) => onLineContext?.(diff, workingLine(h, l), e)}>
                <span className="n">{l.oldNo ?? ''}</span>
                <span className="n" />
                <span className="tx">{l.text}</span>
              </div>
            ))
        )}
      </div>
      <div className="side">
        {diff.hunks.flatMap((h) =>
          h.lines
            .filter((l) => l.type !== 'del')
            .map((l, i) => (
              <div key={`r${h.newStart}-${i}`} className={`diff-line ${l.type}`} onContextMenu={(e) => onLineContext?.(diff, workingLine(h, l), e)}>
                <span className="n" />
                <span className="n">{l.newNo ?? ''}</span>
                <span className="tx">{l.text}</span>
              </div>
            ))
        )}
      </div>
    </div>
  )
}

function UnifiedHunks({
  diff,
  onHunk,
  onLineContext
}: {
  diff: FileDiff
  onLineContext?: LineContext
  onHunk?: (h: DiffHunk, mode: 'stage' | 'unstage' | 'discard') => void
}) {
  return (
    <>
      {diff.hunks.map((h, hi) => (
        <div key={hi}>
          {onHunk && (
            <div className="hunk-actions">
              <Button className="ghost" onClick={() => onHunk(h, 'stage')}>
                Stage
              </Button>
              <Button className="ghost" onClick={() => onHunk(h, 'unstage')}>
                Unstage
              </Button>
              <Button className="ghost" onClick={() => onHunk(h, 'discard')}>
                Discard
              </Button>
            </div>
          )}
          {h.lines.map((l, i) => (
            <div key={i} className={`diff-line ${l.type}`} onContextMenu={(e) => onLineContext?.(diff, workingLine(h, l), e)}>
              <span className="n">{l.oldNo ?? ''}</span>
              <span className="n">{l.newNo ?? ''}</span>
              <span className="tx">{l.text}</span>
            </div>
          ))}
        </div>
      ))}
    </>
  )
}

function DiffView({
  repo,
  rev,
  diffs,
  split,
  staged,
  onHunk,
  onLineContext
}: {
  repo?: string
  rev?: string
  diffs: FileDiff[]
  split: boolean
  staged?: boolean
  onLineContext?: LineContext
  onHunk?: (h: DiffHunk, mode: 'stage' | 'unstage' | 'discard') => void
}) {
  if (!diffs.length) return <div className="empty">No diff</div>
  return (
    <div className="diff-view">
      {diffs.map((d) => {
        const media = classifyMedia(d.path)
        const showText = !d.binary && d.hunks.length > 0
        const hunkAction = d.untracked ? undefined : onHunk
        return (
        <div key={d.path} className="diff-file">
          <div className="diff-tools" onContextMenu={(e) => onLineContext?.(d, firstChangedLine(d), e)}>{d.path}</div>
          {media && repo ? (
            <MediaCompare repo={repo} file={d.path} origPath={d.origPath} rev={rev} staged={staged} kind={media.kind} mime={media.mime} />
          ) : d.binary ? (
            <div className="empty">Binary file. Spoon previews images, video, audio, and PDF.</div>
          ) : !d.hunks.length ? (
            <div className="empty">{d.untracked ? 'Empty new file.' : 'No text changes (mode or rename only).'}</div>
          ) : null}
          {media && showText ? (
            <details className="media-code">
              <summary>Text diff</summary>
              {split ? <SplitHunks diff={d} onLineContext={onLineContext} /> : <UnifiedHunks diff={d} onHunk={hunkAction} onLineContext={onLineContext} />}
            </details>
          ) : !media && !d.binary ? (
            split ? <SplitHunks diff={d} onLineContext={onLineContext} /> : <UnifiedHunks diff={d} onHunk={hunkAction} onLineContext={onLineContext} />
          ) : null}
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
  rev,
  staged,
  kind,
  mime
}: {
  repo: string
  file: string
  origPath?: string
  rev?: string
  staged?: boolean
  kind: MediaKind
  mime: string
}) {
  const [pair, setPair] = useState<MediaPair | null>(null)
  const [err, setErr] = useState('')
  useEffect(() => {
    let cancel = false
    setPair(null)
    setErr('')
    void window.spoon.git
      .preview(repo, file, { rev, origPath, staged })
      .then((value) => {
        if (!cancel) setPair(value as MediaPair)
      })
      .catch((e: unknown) => {
        if (!cancel) setErr(e instanceof Error ? e.message : String(e))
      })
    return () => {
      cancel = true
    }
  }, [repo, file, origPath, rev, staged])
  if (err) return <div className="empty">{err}</div>
  if (!pair) return <div className="empty loading">Loading preview...</div>
  const stash = rev?.startsWith('stash@{')
  const titles = stash ? ['Before stash', 'Stashed'] : rev ? ['Parent', 'This commit'] : staged ? ['HEAD', 'Staged'] : ['Before', 'Working copy']
  return (
    <div className={`media-preview${kind === 'image' ? ' images' : ''}`}>
      <MediaPane repo={repo} file={origPath || file} title={titles[0]} side={pair.before} fallback={{ kind, mime }} />
      <MediaPane repo={repo} file={file} title={titles[1]} side={pair.after} fallback={{ kind, mime }} />
    </div>
  )
}

function useObjectUrl(base64?: string, mime?: string) {
  const [url, setUrl] = useState('')
  useEffect(() => {
    if (!base64 || !mime) {
      setUrl('')
      return
    }
    let objectUrl = ''
    try {
      const bin = atob(base64)
      const bytes = new Uint8Array(bin.length)
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
      const type = mime === 'image/svg+xml' ? 'image/svg+xml;charset=utf-8' : mime
      objectUrl = URL.createObjectURL(new Blob([bytes], { type }))
      setUrl(objectUrl)
    } catch {
      setUrl(`data:${mime};base64,${base64}`)
    }
    return () => {
      if (objectUrl.startsWith('blob:')) URL.revokeObjectURL(objectUrl)
    }
  }, [base64, mime])
  return url
}

function MediaPane({
  repo,
  file,
  title,
  side,
  fallback
}: {
  repo: string
  file: string
  title: string
  side: MediaSide
  fallback: { kind: MediaKind; mime: string }
}) {
  const [failed, setFailed] = useState(false)
  const [size, setSize] = useState('')
  const kind = side.kind === 'binary' ? fallback.kind : side.kind
  const mime = side.mime === 'application/octet-stream' ? fallback.mime : side.mime
  const src = useObjectUrl(side.base64, mime)
  const svg = mime.includes('svg')
  useEffect(() => {
    setFailed(false)
    setSize('')
  }, [src])
  return (
    <div className="media-pane">
      <div className="kv">
        {title}
        {side.bytes ? ` · ${formatBytes(side.bytes)}` : ''}
        {size ? ` · ${size}` : ''}
      </div>
      {side.missing ? (
        <div className="media-frame empty-frame">Not in this version</div>
      ) : side.tooLarge || !src ? (
        <div className="media-frame empty-frame">
          This file is too large to preview inline.
          <Button className="ghost" onClick={() => void window.spoon.git.openFile(repo, file)}>
            Open
          </Button>
        </div>
      ) : failed ? (
        <div className="media-frame empty-frame">
          Could not render this {svg ? 'SVG' : kind}.
          <Button className="ghost" onClick={() => void window.spoon.git.openFile(repo, file)}>
            Open
          </Button>
        </div>
      ) : kind === 'image' ? (
        <div className="media-frame">
          <img
            src={src}
            alt={title}
            onError={() => setFailed(true)}
            onLoad={(e) => {
              const el = e.currentTarget
              if (el.naturalWidth) setSize(`${el.naturalWidth}×${el.naturalHeight}`)
            }}
          />
        </div>
      ) : kind === 'video' ? (
        <div className="media-frame">
          <video src={src} controls onError={() => setFailed(true)} />
        </div>
      ) : kind === 'audio' ? (
        <audio src={src} controls onError={() => setFailed(true)} />
      ) : kind === 'pdf' ? (
        <iframe title={title} src={src} />
      ) : (
        <div className="media-frame empty-frame">No preview for this file type.</div>
      )}
      {!side.missing && !side.tooLarge && (
        <Button className="ghost" onClick={() => void window.spoon.git.openFile(repo, file)}>
          Open file
        </Button>
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
  connected,
  onSelect,
  onContext
}: {
  commits: CommitInfo[]
  selected?: string
  showAvatar: boolean
  pulseKey: number
  pulseHashes: string[]
  connected: boolean
  onSelect: (c: CommitInfo) => void
  onContext: (c: CommitInfo, e: MouseEvent) => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [height, setHeight] = useState(400)
  const RH = COMMIT_ROW_HEIGHT
  const width = useMemo(() => graphWidth(Math.max(0, ...commits.map((c) => c.maxLane))), [commits])
  useEffect(() => {
    if (ref.current && scrollTop >= commits.length * RH) { ref.current.scrollTop = 0; setScrollTop(0) }
  }, [commits.length, scrollTop])
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
      aria-label="Commit history"
      style={{ ['--graph-w' as string]: `${width}px`, ['--commit-min-w' as string]: `${width + 650}px` }}
      ref={ref}
      onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
    >
      <div className="commit-columns" aria-hidden="true"><span>Graph</span><span>Commit message</span><span>Author</span><span>SHA</span><span>Date</span></div>
      {!commits.length && <div className="history-empty"><IcoBranch /><strong>No commits to show</strong><span>Try a different search or select another branch.</span></div>}
      <div style={{ height: commits.length * RH, position: 'relative' }}>
        {commits.slice(start, end).map((c, i) => (
          <div key={c.hash} style={{ position: 'absolute', top: (start + i) * RH, left: 0, right: 0, height: RH }}>
            <CommitRow
              c={c}
              selected={selected === c.hash}
              showAvatar={showAvatar}
              pulse={pulseHashes.includes(c.hash)}
              pulseKey={pulseKey}
              width={width}
              connected={connected}
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
  width,
  connected,
  onClick,
  onContext
}: {
  c: CommitInfo
  selected: boolean
  showAvatar: boolean
  pulse: boolean
  pulseKey: number
  width: number
  connected: boolean
  onClick: () => void
  onContext: (e: MouseEvent) => void
}) {
  const refs = c.refs.filter((r) => r.type !== 'head').sort((a, b) => Number(b.current) - Number(a.current))
  return (
    <div className={`commit-row ${selected ? 'sel' : ''}`} role="button" tabIndex={0}
      aria-pressed={selected} aria-label={`${c.subject}, ${c.shortHash}, ${c.author}`}
      onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onClick() } }}
      onClick={onClick} onContextMenu={onContext}>
      <CommitGraph commit={c} width={width} focused={pulse} pulseKey={pulseKey} connected={connected} />
      <div className="msg">
        {refs
          .slice(0, 2)
          .map((r) => (
            <span key={r.name + r.type} title={`${r.current ? 'Current branch · ' : ''}${r.name}`} className={`ref-pill ${r.current ? 'current' : ''}`} style={{ ['--lane-color' as string]: laneColor(c.lane) }}>
              {r.type === 'tag' ? <IcoTag /> : <IcoBranch />}
              <span>{r.name}</span>
              {r.current && <b>HEAD</b>}
            </span>
          ))}
        {refs.length > 2 && <span className="ref-more" title={refs.slice(2).map((ref) => ref.name).join('\n')}>+{refs.length - 2}</span>}
        <span title={`${c.subject}${c.body ? `\n${c.body}` : ''}`}>{c.subject}</span>
      </div>
      <div className="meta" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        {showAvatar && (
          <Avatar email={c.email} name={c.author} />
        )}
        {c.author}
      </div>
      <div className="meta commit-sha" title={c.hash}>{c.shortHash}</div>
      <div className="meta" title={formatDate(c.date)}>{formatAgo(c.date)}</div>
    </div>
  )
})

function CommitDetails({ c }: { c: CommitInfo }) {
  return (
    <div>
      <div className="commit-meta">
        <div className="who">
          <Avatar email={c.email} name={c.author} big />
          <div>
            <div className="kv">AUTHOR</div>
            <div>
              {c.author} &lt;{c.email}&gt;
            </div>
            <div className="hint">{formatDate(c.date)}</div>
          </div>
        </div>
        <div className="who">
          <Avatar email={c.committerEmail} name={c.committer} big />
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
          {node.type === 'dir' ? '>' : '-'} {node.name}
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
  onHelp,
  onAiSettings,
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
  onHelp: () => void
  onAiSettings: () => void
  onSettings: (next?: Settings) => Promise<void>
}) {
  if (!overlay) return null
  if (overlay.type === 'about') return <AboutDialog onClose={onClose} onHelp={onHelp} />
  if (overlay.type === 'settings')
    return (
      <SettingsDialog
        repo={path ?? undefined}
        initialTab={overlay.tab}
        accounts={accounts}
        settings={settings}
        catalogs={catalogs}
        onClose={onClose}
        onSaved={onSettings}
      />
    )
  if (overlay.type === 'health' && path)
    return <HealthDialog path={path} onClose={onClose} />
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
  if (overlay.type === 'stash' && path)
    return <StashDialog path={path} files={overlay.files} settings={settings} accounts={accounts} onClose={onClose} onReload={onReload} onAiSettings={onAiSettings} />
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
          <Button variant="icon" aria-label="Close" title="Close" onClick={onClose}><IcoClose /></Button>
        </div>
        <div className="dialog-body">{children}</div>
      </div>
    </div>
  )
}

function StashDialog({
  path,
  files,
  settings,
  accounts,
  onClose,
  onReload,
  onAiSettings
}: {
  path: string
  files?: string[]
  settings: Settings | null
  accounts: AiAccount[]
  onClose: () => void
  onReload: () => void
  onAiSettings: () => void
}) {
  const [message, setMessage] = useState('')
  const [aiBusy, setAiBusy] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const provider = resolveAiProvider(settings, accounts)
  const model = defaultModelFor(provider, settings)
  const aiConnected = hasConnectedAi(accounts)
  const count = files?.length ?? 0

  async function writeWithAi(): Promise<string | null> {
    if (!aiConnected) {
      onAiSettings()
      return null
    }
    setAiBusy(true)
    setError('')
    try {
      const text = (await window.spoon.ai.stashMessage(path, provider, model, files)) as string
      setMessage(text)
      return text
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
      return null
    } finally {
      setAiBusy(false)
    }
  }

  async function save(text: string) {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      await window.spoon.git.stash(path, text.trim() || undefined, files)
      onReload()
      onClose()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
      setBusy(false)
    }
  }

  return (
    <Modal title={count ? `Stash ${count === 1 ? fileName(files![0]) : `${count} files`}` : 'Stash changes'} onClose={onClose}>
      <label>Message</label>
      <div className="row-btns stash-message">
        <input
          autoFocus
          value={message}
          placeholder={aiBusy ? 'Writing...' : 'Optional'}
          disabled={aiBusy}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void save(message)}
        />
        <Button className="ghost ico-text" disabled={aiBusy || busy} title={aiConnected ? 'Write the stash message from the changes' : 'Connect an AI provider'} onClick={() => void writeWithAi()}>
          <IcoAi />
          <span>{aiBusy ? 'Writing...' : aiConnected ? 'Write with AI' : 'Connect AI'}</span>
        </Button>
      </div>
      <p className="hint">{count ? 'Only the selected files are stashed, including new ones.' : 'All changes are stashed, including new files.'}</p>
      {error && <p className="hint danger-text">{error}</p>}
      <div className="dialog-foot">
        <Button className="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button
          className="ghost ico-text"
          disabled={aiBusy || busy || !aiConnected}
          title="Write the message with AI and stash right away"
          onClick={() => void writeWithAi().then((text) => { if (text != null) void save(text) })}
        >
          <IcoAi />
          <span>AI stash</span>
        </Button>
        <Button className="primary" disabled={aiBusy || busy} onClick={() => void save(message)}>
          {busy ? 'Stashing...' : 'Stash'}
        </Button>
      </div>
    </Modal>
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
        <Button className="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button className="primary" disabled={!optional && !v.trim()} onClick={() => void onOk(v.trim())}>
          OK
        </Button>
      </div>
    </Modal>
  )
}

function ConfirmOp({ title, onClose, onOk }: { title: string; onClose: () => void; onOk: () => Promise<void> }) {
  return (
    <Modal title={title} onClose={onClose}>
      <p>Continue?</p>
      <div className="dialog-foot">
        <Button className="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button className="primary" onClick={() => void onOk()}>
          Continue
        </Button>
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
        <Button className="ghost" onClick={async () => setDir((await window.spoon.app.pickDirectory()) || dir)}>
          Browse
        </Button>
      </div>
      <label>Folder name (optional)</label>
      <input value={name} onChange={(e) => setName(e.target.value)} />
      {progress && <pre className="hint">{progress.slice(-400)}</pre>}
      <div className="dialog-foot">
        <Button className="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button
          className="primary"
          disabled={!url || !dir}
          onClick={async () => {
            const dest = (await window.spoon.git.clone({ url, directory: dir, name: name || undefined, recursive: true })) as string
            onOpen(dest)
            onClose()
          }}
        >
          Clone
        </Button>
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
        <Button className="ghost" onClick={async () => setDir((await window.spoon.app.pickDirectory()) || dir)}>
          Browse
        </Button>
      </div>
      <div className="dialog-foot">
        <Button className="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button
          className="primary"
          disabled={!dir}
          onClick={async () => {
            const dest = (await window.spoon.git.init(dir, true)) as string
            onOpen(dest)
            onClose()
          }}
        >
          Create
        </Button>
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
        <Button className="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button className="primary" disabled={!n.trim() || !u.trim()} onClick={() => void onOk(n.trim(), u.trim())}>
          {action}
        </Button>
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
    <Modal title={`Blame  -  ${file}`} onClose={onClose}>
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
        <Button className="primary" onClick={onClose}>
          Close
        </Button>
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
    <Modal title={`History  -  ${file}`} onClose={onClose}>
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
        <Button className="primary" onClick={onClose}>
          Close
        </Button>
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
    <Modal title="Reflog" wide onClose={onClose}>
      <div className="reflog-list">
        {commits.length === 0 && <div className="side-empty">No reflog entries</div>}
        {commits.map((c, i) => {
          const p = parseReflogSubject(c.subject)
          return (
            <div key={`${c.hash}-${i}`} className="reflog-row" title={c.subject}>
              <span className="reflog-sel">{p.selector || `HEAD@{${i}}`}</span>
              <span className={`reflog-act ${p.action ? '' : 'empty'}`.trim()}>{p.action || '—'}</span>
              <span className="reflog-msg">{p.detail || c.subject}</span>
              <span className="reflog-hash" title={c.hash}>
                {c.shortHash}
              </span>
            </div>
          )
        })}
      </div>
      <div className="dialog-foot">
        <Button className="primary" onClick={onClose}>
          Close
        </Button>
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
    <Modal title={`Merge conflict  -  ${file}`} onClose={onClose} wide>
      <div className="row-btns">
        <Button className="ghost" onClick={() => setText(c.ours)}>
          Use ours
        </Button>
        <Button className="ghost" onClick={() => setText(c.theirs)}>
          Use theirs
        </Button>
        <Button className="ghost" onClick={() => setText(`${c.ours}\n${c.theirs}`)}>
          Use both
        </Button>
      </div>
      <div className="conflict-grid">
        <textarea value={c.ours} readOnly />
        <textarea value={c.theirs} readOnly />
      </div>
      <label>Resolved</label>
      <textarea value={text} onChange={(e) => setText(e.target.value)} style={{ height: 120, fontFamily: 'var(--mono)' }} />
      <div className="dialog-foot">
        <Button className="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button
          className="primary"
          onClick={async () => {
            await window.spoon.git.writeResolved(path, file, text)
            onReload()
            onClose()
          }}
        >
          Mark resolved
        </Button>
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
      {!items.length && <p className="hint working">Loading the current branch...</p>}
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
        <Button className="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button
          className="primary"
          disabled={!items.length}
          onClick={async () => {
            await window.spoon.git.interactiveRebase(path, onto, items)
            onReload()
            onClose()
          }}
        >
          Start
        </Button>
      </div>
    </Modal>
  )
}

function LauncherPrefs({
  settings,
  onPersist
}: {
  settings: Settings | null
  onPersist: (patch: Partial<Settings>) => void
}) {
  const [launchers, setLaunchers] = useState<LauncherInfo[]>([])
  const [defaultId, setDefaultId] = useState(settings?.defaultLauncher || 'cursor')
  const [busy, setBusy] = useState(false)

  const reload = useCallback(async (force = false) => {
    setBusy(true)
    try {
      const result = (await window.spoon.app.launchers(force)) as { launchers: LauncherInfo[]; defaultId: string }
      setLaunchers(result.launchers)
      setDefaultId(result.defaultId)
    } finally {
      setBusy(false)
    }
  }, [])

  useEffect(() => {
    void reload()
  }, [reload, settings?.defaultLauncher])

  async function pickDefault(id: string) {
    setDefaultId(id)
    const result = (await window.spoon.app.setDefaultLauncher(id)) as { settings: Settings; defaultId: string }
    onPersist({
      defaultLauncher: result.defaultId,
      editor: result.settings.editor
    })
    setDefaultId(result.defaultId)
  }

  const groups = groupLaunchers(launchers)

  return (
    <div className="launcher-prefs">
      <div className="launcher-prefs-head">
        <span className="hint">
          Default: <strong>{launchers.find((item) => item.id === defaultId)?.label || defaultId}</strong>
        </span>
        <Button type="button" className="ghost tiny" disabled={busy} onClick={() => void reload(true)}>
          {busy ? 'Scanning…' : 'Rescan PATH'}
        </Button>
      </div>
      {groups.map((group) => (
        <div key={group.kind} className="launcher-group">
          <div className="launcher-kind">{LAUNCHER_KIND_LABEL[group.kind]}</div>
          <ul className="launcher-list">
            {group.items.map((item) => (
              <li key={item.id} className={item.available ? '' : 'off'}>
                <div className="launcher-copy">
                  <strong>{item.label}</strong>
                  <div className="hint">{item.available ? item.blurb : `Not found on PATH (${item.bins.join(' / ') || 'system'})`}</div>
                </div>
                <Button
                  type="button"
                  className={`ghost ${defaultId === item.id ? 'on' : ''}`}
                  disabled={!item.available}
                  onClick={() => void pickDefault(item.id)}
                >
                  {defaultId === item.id ? 'Default' : 'Make default'}
                </Button>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  )
}

function SettingsDialog({
  repo,
  accounts,
  settings,
  catalogs,
  initialTab,
  onClose,
  onSaved
}: {
  repo?: string
  accounts: AiAccount[]
  settings: Settings | null
  catalogs: Record<AiProviderId, AiModelCatalog>
  initialTab?: PrefsTab
  onClose: () => void
  onSaved: (next?: Settings) => Promise<void>
}) {
  const [tab, setTab] = useState<PrefsTab>(initialTab ?? lastPrefsTab)
  const [navCollapsed, setNavCollapsed] = useState(lastPrefsNav)
  const [aiNavCollapsed, setAiNavCollapsed] = useState(lastAiNav)
  const [aiPick, setAiPick] = useState<AiPick>({ type: 'provider', id: fallbackAiProvider(settings?.aiProvider) })
  const [version, setVersion] = useState('')
  const [key, setKey] = useState('')
  const [provider, setProvider] = useState<AiProviderId>(fallbackAiProvider(settings?.aiProvider))
  const [acc, setAcc] = useState(accounts)
  const [local, setLocal] = useState<Record<string, { available: boolean; label?: string }>>({})
  const [device, setDevice] = useState<{ userCode: string; url: string } | null>(null)
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
    void window.spoon.app.version().then(setVersion)
  }, [])
  useEffect(() => {
    lastPrefsTab = tab
  }, [tab])
  useEffect(() => {
    lastPrefsNav = navCollapsed
  }, [navCollapsed])
  useEffect(() => {
    lastAiNav = aiNavCollapsed
  }, [aiNavCollapsed])
  useEffect(() => {
    if (settings?.aiProvider) {
      setProvider(fallbackAiProvider(settings.aiProvider))
      setAiPick((prev) => (prev.type === 'provider' ? { type: 'provider', id: fallbackAiProvider(settings.aiProvider) } : prev))
    }
  }, [settings?.aiProvider])
  useEffect(() => {
    setAcc(accounts)
  }, [accounts])

  async function refresh() {
    setAcc((await window.spoon.ai.accounts()) as AiAccount[])
    await onSaved()
  }

  async function persist(patch: Partial<Settings>) {
    // Paint immediately so theme:native echoes cannot flash the previous pack.
    if (settings) await onSaved({ ...settings, ...patch })
    const next = await window.spoon.app.patchSettings(patch)
    await onSaved(next)
    return next
  }

  async function selectProvider(id: AiProviderId) {
    setProvider(id)
    setAiPick({ type: 'provider', id })
    await persist({ aiProvider: id })
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
      setAddKey('')
      setAddModel('')
      setProvider(site.id)
      setAiPick({ type: 'provider', id: site.id })
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
  const siteAdding = aiPick.type === 'add' ? catalogLeft.find((s) => s.id === aiPick.id) : undefined

  function providerStatus(p: AiProviderId) {
    const a = acc.find((x) => x.provider === p)
    if (a?.connected) return { connected: true, text: `Connected${a.label ? ` - ${a.label}` : ''}` }
    return { connected: false, text: 'Not connected' }
  }

  return (
    <div className="dialog-back" onMouseDown={onClose}>
      <div className="dialog wide prefs" onMouseDown={(e) => e.stopPropagation()}>
        <div className={`prefs-layout ${navCollapsed ? 'collapsed' : ''}`}>
          <nav
            className="rail"
            aria-label="Preferences"
            onKeyDown={(e) => {
              if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
              e.preventDefault()
              const i = PREFS_TABS.findIndex((item) => item.id === tab)
              const next = e.key === 'ArrowDown' ? (i + 1) % PREFS_TABS.length : (i - 1 + PREFS_TABS.length) % PREFS_TABS.length
              setTab(PREFS_TABS[next].id)
            }}
          >
            <Button
              type="button"
              className="rail-toggle"
              aria-expanded={!navCollapsed}
              aria-label={navCollapsed ? 'Expand menu' : 'Collapse menu'}
              title={navCollapsed ? 'Expand menu' : 'Collapse menu'}
              onClick={() => setNavCollapsed((v) => !v)}
            >
              <span className={`rail-chevron ${navCollapsed ? 'flip' : ''}`} aria-hidden="true">
                <IcoChevron />
              </span>
              <span className="rail-label">Menu</span>
            </Button>
            {PREFS_TABS.map((item) => (
              <Button
                key={item.id}
                type="button"
                className={`rail-item ${tab === item.id ? 'on' : ''}`}
                aria-current={tab === item.id ? 'page' : undefined}
                title={item.label}
                onClick={() => setTab(item.id)}
              >
                <span className="rail-ico" aria-hidden="true">
                  <item.Icon />
                </span>
                <span className="rail-label">{item.label}</span>
              </Button>
            ))}
          </nav>
          <div className="prefs-col">
            <div className="dialog-head">
              <h2>Preferences</h2>
              <Button variant="icon" aria-label="Close preferences" title="Close" onClick={onClose}><IcoClose /></Button>
            </div>
            <div className="prefs-main">
      {tab === 'profile' && <ProfileSettings settings={settings} repo={repo} onPersist={persist} />}

      {tab === 'look' && (
        <section className="prefs-pane" role="tabpanel" id="prefs-panel-look" aria-labelledby="prefs-tab-look">
          <h3>Look</h3>
          <div className="theme-pack-grid">
            {THEME_PACKS.map((pack) => {
              const on = (settings?.themePack ?? 'spoon') === pack.id
              return (
                <Button
                  key={pack.id}
                  type="button"
                  className={`theme-pack-card ${on ? 'on' : ''} pack-${pack.id}`}
                  aria-pressed={on}
                  onClick={() => {
                    const patch: Partial<Settings> = {
                      themePack: pack.id,
                      iconStyle: pack.preferIcons ?? 'mono',
                      accentId: pack.preferAccent ?? 'blue'
                    }
                    if (pack.preferDark) patch.theme = 'dark'
                    void persist(patch)
                  }}
                >
                  <span className="theme-pack-swatches" aria-hidden="true">
                    {pack.preview.map((c) => (
                      <span key={c} style={{ background: c }} />
                    ))}
                  </span>
                  <strong>{pack.label}</strong>
                  <span className="hint">{pack.blurb}</span>
                </Button>
              )
            })}
          </div>

          <h3>Mode</h3>
          <div className="theme-pack-grid mode-grid">
            {(
              [
                {
                  id: 'light' as const,
                  label: 'Light',
                  blurb: 'Bright chrome and paper panels.',
                  preview: settings?.themePack === 'spoon' ? ['#f1ecfb', '#faf8ff', '#7834da'] : ['#f3f3f3', '#ffffff', '#0b57d0']
                },
                {
                  id: 'dark' as const,
                  label: 'Dark',
                  blurb: 'Dim chrome with soft contrast.',
                  preview: settings?.themePack === 'spoon' ? ['#17112d', '#110c24', '#8339e3'] : ['#2d2d2d', '#1e1e1e', '#6cb6ff']
                }
              ] as const
            ).map((item) => {
              const locked = settings?.themePack === 'spacex' && item.id === 'light'
              const on = (settings?.theme ?? 'dark') === item.id
              return (
                <Button
                  key={item.id}
                  type="button"
                  className={`theme-pack-card ${on ? 'on' : ''} mode-${item.id}`}
                  aria-pressed={on}
                  disabled={locked}
                  title={locked ? 'SpaceX stays dark' : undefined}
                  onClick={() => void persist({ theme: item.id })}
                >
                  <span className={`theme-preview-surface mode-${item.id}`} aria-hidden="true">
                    <span className="theme-preview-bar" style={{ background: item.preview[0] }} />
                    <span className="theme-preview-body" style={{ background: item.preview[1] }}>
                      <span className="theme-preview-accent" style={{ background: item.preview[2] }} />
                    </span>
                  </span>
                  <strong>{item.label}</strong>
                  <span className="hint">{item.blurb}</span>
                </Button>
              )
            })}
          </div>

          <h3>Icons</h3>
          <div className="theme-pack-grid mode-grid">
            {(
              [
                {
                  id: 'mono' as const,
                  label: 'Mono',
                  blurb: 'Toolbar icons inherit the text color.',
                  tones: ['#9a9a9a', '#9a9a9a', '#9a9a9a', '#9a9a9a']
                },
                {
                  id: 'color' as const,
                  label: 'Color',
                  blurb: 'Fetch, Pull, Push and friends get tint.',
                  tones: ['#60a5fa', '#34d399', '#fbbf24', '#e81828']
                }
              ] as const
            ).map((item) => {
              const on = (settings?.iconStyle ?? 'mono') === item.id
              return (
                <Button
                  key={item.id}
                  type="button"
                  className={`theme-pack-card ${on ? 'on' : ''} icons-${item.id}`}
                  aria-pressed={on}
                  onClick={() => void persist({ iconStyle: item.id as IconStyle })}
                >
                  <span className="theme-preview-icons" aria-hidden="true">
                    {(
                      [
                        [item.tones[0], IcoFetch],
                        [item.tones[1], IcoPull],
                        [item.tones[2], IcoPush],
                        [item.tones[3], IcoRefresh]
                      ] as const
                    ).map(([tone, Icon], i) => (
                      <span key={`${item.id}-${i}`} className="theme-preview-ico" style={{ color: tone }}>
                        <Icon />
                      </span>
                    ))}
                  </span>
                  <strong>{item.label}</strong>
                  <span className="hint">{item.blurb}</span>
                </Button>
              )
            })}
          </div>
          <p className="hint">Color tints toolbar actions. Mono keeps everything in the text color.</p>

          <h3>Accent</h3>
          <div className="accent-row">
            {ACCENTS.filter((a) => a.id !== 'custom').map((a) => (
              <Button
                key={a.id}
                type="button"
                className={`accent-swatch ${(settings?.accentId ?? 'blue') === a.id ? 'on' : ''}`}
                style={{ ['--swatch' as string]: a.swatch }}
                title={a.label}
                aria-label={a.label}
                onClick={() => void persist({ accentId: a.id as AccentId })}
              />
            ))}
            <label className={`accent-swatch custom ${(settings?.accentId ?? 'blue') === 'custom' ? 'on' : ''}`} title="Custom">
              <input
                type="color"
                value={settings?.accentCustom ?? '#6cb6ff'}
                onChange={(e) => void persist({ accentId: 'custom', accentCustom: e.target.value })}
              />
            </label>
          </div>
        </section>
      )}

      {tab === 'git' && (
        <section className="prefs-pane" role="tabpanel" id="prefs-panel-git" aria-labelledby="prefs-tab-git">
          <h3>Automatic fetch</h3>
          <label className="check">
            <input
              type="checkbox"
              checked={settings?.autoFetch !== false}
              onChange={(e) => void persist({ autoFetch: e.target.checked })}
            />
            Fetch the open repository on a timer
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={!!settings?.autoFetchAll}
              onChange={(e) => void persist({ autoFetchAll: e.target.checked })}
            />
            Also fetch pinned and recently opened repos
          </label>
          <label>Interval (minutes)</label>
          <input
            type="number"
            min={1}
            max={120}
            value={settings?.fetchIntervalMin ?? 10}
            onChange={(e) => void persist({ fetchIntervalMin: Math.max(1, Number(e.target.value) || 10) })}
          />
          <h3>Updates</h3>
          <label className="check">
            <input
              type="checkbox"
              checked={settings?.autoUpdate !== false}
              onChange={(e) => void persist({ autoUpdate: e.target.checked })}
            />
            Download updates automatically
          </label>
          <p className="hint">Spoon checks GitHub releases a few seconds after launch, then every four hours.</p>
        </section>
      )}

      {tab === 'open' && (
        <section className="prefs-pane" role="tabpanel" id="prefs-panel-open" aria-labelledby="prefs-tab-open">
          <h3>Open with</h3>
          <p className="hint">
            Detected IDEs, agent apps, and coding CLIs on PATH. Pick a default for the quick button; use the menu to choose
            another.
          </p>
          <LauncherPrefs settings={settings} onPersist={(patch) => void persist(patch)} />
        </section>
      )}

      {tab === 'ai' && (
        <section className="prefs-pane ai-pane" id="prefs-panel-ai">
          <div className="ai-pane-head">
            <div className="ai-commit-card">
              <div className="ai-commit-copy">
                <h3>AI button</h3>
                <p className="hint">
                  Split changes into several commits, ordered so each one still works after the previous. Commit and Commit
                  &amp; push use the message in the box. Ctrl+Enter commits. Ctrl+Shift+Enter commits and pushes.
                </p>
              </div>
              <div className="seg ai-commit-seg">
                {(
                  [
                    ['fill', 'Write message'],
                    ['commit', 'Split & commit'],
                    ['commit-push', 'Split & push']
                  ] as const
                ).map(([id, label]) => (
                  <Button
                    variant="segment"
                    key={id}
                    className={(settings?.aiCommitMode ?? 'commit') === id ? 'on' : ''}
                    onClick={() => void persist({ aiCommitMode: id })}
                  >
                    {label}
                  </Button>
                ))}
              </div>
              <label className="check ai-stage-check">
                <input
                  type="checkbox"
                  checked={settings?.aiStageAll !== false}
                  onChange={(e) => void persist({ aiStageAll: e.target.checked })}
                />
                Stage all changes when nothing is staged
              </label>
            </div>
          </div>
          <div className={`ai-layout ${aiNavCollapsed ? 'collapsed' : ''}`}>
            <nav className="rail ai-rail" aria-label="AI providers">
              <Button
                type="button"
                className="rail-toggle"
                aria-expanded={!aiNavCollapsed}
                aria-label={aiNavCollapsed ? 'Expand providers' : 'Collapse providers'}
                title={aiNavCollapsed ? 'Expand providers' : 'Collapse providers'}
                onClick={() => setAiNavCollapsed((v) => !v)}
              >
                <span className={`rail-chevron ${aiNavCollapsed ? 'flip' : ''}`} aria-hidden="true">
                  <IcoChevron />
                </span>
                <span className="rail-label">Providers</span>
              </Button>
              <div className="ai-rail-scroll">
              <div className="rail-kicker">Yours</div>
              {yours.map((p) => {
                const st = providerStatus(p)
                const selected = aiPick.type === 'provider' && aiPick.id === p
                return (
                  <Button
                    key={p}
                    type="button"
                    className={`rail-item ${selected ? 'on' : ''}`}
                    title={providerLabel(p, endpoints)}
                    onClick={() => void selectProvider(p)}
                  >
                    <span className="ai-mark sm">
                      <ProviderIcon id={p} label={providerLabel(p, endpoints)} />
                    </span>
                    <span className="rail-copy">
                      <span className="rail-label">{providerLabel(p, endpoints)}</span>
                      <span className={st.connected ? 'pill-on' : 'hint'}>{st.text}</span>
                    </span>
                  </Button>
                )
              })}
              <div className="rail-kicker">Add</div>
              {catalogLeft.map((site) => (
                <Button
                  key={site.id}
                  type="button"
                  className={`rail-item ${aiPick.type === 'add' && aiPick.id === site.id ? 'on' : ''}`}
                  title={site.label}
                  onClick={() => {
                    setAddKey('')
                    setAddModel(site.defaultModel)
                    setAiPick({ type: 'add', id: site.id })
                  }}
                >
                  <span className="ai-mark sm">
                    <ProviderIcon id={site.id} label={site.label} />
                  </span>
                  <span className="rail-copy">
                    <span className="rail-label">{site.label}</span>
                    <span className="hint">{site.blurb}</span>
                  </span>
                </Button>
              ))}
              <Button
                type="button"
                className={`rail-item ${aiPick.type === 'custom' ? 'on' : ''}`}
                title="Custom endpoint"
                onClick={() => setAiPick({ type: 'custom' })}
              >
                <span className="rail-ico" aria-hidden="true">
                  <IcoCreate />
                </span>
                <span className="rail-label">Custom endpoint</span>
              </Button>
              </div>
            </nav>
            <div className="ai-detail">
              {aiPick.type === 'provider' && (() => {
                const p = aiPick.id
                const a = acc.find((x) => x.provider === p)
                const endpoint = endpoints.find((item) => item.id === p)
                const st = providerStatus(p)
                return (
                  <div className="ai-active">
                    <div className="ai-active-top">
                      <span className="ai-mark">
                        <ProviderIcon id={p} label={providerLabel(p, endpoints)} />
                      </span>
                      <div className="ai-active-copy">
                        <strong>{providerLabel(p, endpoints)}</strong>
                        <p className={st.connected ? 'pill-on' : 'hint'}>{st.text}</p>
                      </div>
                    </div>
                    <div className="ai-fields">
                      <ModelField provider={p} settings={settings} catalog={catalogs[p]} onSaved={onSaved} />
                    </div>
                    {BUILTIN_AI_IDS.includes(p) && (
                      <div className="ai-actions">
                        {local[p]?.available && (
                          <div className="ai-local">
                            <Button
                              className="ghost"
                              title={local[p].label ? `Use local session (${local[p].label})` : 'Use local session'}
                              onClick={async () => {
                                await window.spoon.ai.importLocal(p)
                                await refresh()
                              }}
                            >
                              Use local session
                            </Button>
                            {local[p].label && (
                              <span className="hint ai-mail" title={local[p].label}>
                                {local[p].label}
                              </span>
                            )}
                          </div>
                        )}
                        {p === 'grok' && (
                          <Button
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
                          </Button>
                        )}
                        <Button className="ghost" onClick={() => void window.spoon.ai.openConsole(p)}>
                          Get key
                        </Button>
                        {a?.connected && (
                          <Button
                            className="ghost"
                            onClick={async () => {
                              await window.spoon.ai.disconnect(p)
                              await refresh()
                            }}
                          >
                            Disconnect
                          </Button>
                        )}
                      </div>
                    )}
                    {PAID_AI_PROVIDERS.includes(p) && (
                      <div className="ai-key-row">
                        <input type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder="Paste API key" />
                        <Button
                          className="primary"
                          onClick={async () => {
                            await window.spoon.ai.saveApiKey(p, key)
                            setKey('')
                            await refresh()
                          }}
                        >
                          Save
                        </Button>
                      </div>
                    )}
                    {endpoint && (
                      <>
                        {endpoint.needsKey && (
                          <div className="ai-key-row">
                            <input type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder="Paste API key" />
                            <Button
                              className="primary"
                              onClick={async () => {
                                await window.spoon.ai.saveApiKey(p, key)
                                setKey('')
                                await refresh()
                              }}
                            >
                              Save
                            </Button>
                          </div>
                        )}
                        <div className="ai-actions">
                          {endpoint.consoleUrl && (
                            <Button className="ghost" onClick={() => void window.spoon.ai.openConsole(p)}>
                              Get key
                            </Button>
                          )}
                          <Button
                            className="ghost"
                            onClick={async () => {
                              await window.spoon.ai.removeEndpoint(p)
                              setAiPick({ type: 'provider', id: 'grok' })
                              await refresh()
                            }}
                          >
                            Remove
                          </Button>
                        </div>
                      </>
                    )}
                  </div>
                )
              })()}
              {aiPick.type === 'add' && siteAdding && (
                <div className="ai-active">
                  <div className="ai-active-top">
                    <span className="ai-mark">
                      <ProviderIcon id={siteAdding.id} label={siteAdding.label} />
                    </span>
                    <div className="ai-active-copy">
                      <strong>{siteAdding.label}</strong>
                      <p className="hint">{siteAdding.blurb}</p>
                    </div>
                  </div>
                  {siteAdding.needsKey && (
                    <div className="ai-fields">
                      <label>API key</label>
                      <input type="password" value={addKey} onChange={(e) => setAddKey(e.target.value)} placeholder="Paste key" />
                      <label>Model</label>
                      <input value={addModel} spellCheck={false} onChange={(e) => setAddModel(e.target.value)} placeholder={siteAdding.defaultModel} />
                    </div>
                  )}
                  <div className="ai-actions">
                    {siteAdding.consoleUrl && (
                      <Button className="ghost" onClick={() => void window.spoon.ai.openConsole(siteAdding.id)}>
                        Get key
                      </Button>
                    )}
                    <Button
                      className="primary"
                      disabled={busyId === siteAdding.id || (siteAdding.needsKey && !addKey.trim())}
                      onClick={() => void addSite(siteAdding, addKey, addModel)}
                    >
                      {busyId === siteAdding.id ? 'Adding...' : 'Add'}
                    </Button>
                  </div>
                </div>
              )}
              {aiPick.type === 'custom' && (
                <div className="ai-active">
                  <div className="ai-active-copy">
                    <strong>Custom endpoint</strong>
                    <p className="hint">Any OpenAI-compatible base URL — LiteLLM, vLLM, a proxy, or a provider that is not listed.</p>
                  </div>
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
                  <div className="ai-actions">
                    <Button className="primary" disabled={!customUrl.trim() || !!busyId} onClick={() => void addCustom()}>
                      Add custom API
                    </Button>
                  </div>
                </div>
              )}
              {device && (
                <p className="hint">
                  Enter code <b>{device.userCode}</b> at {device.url}
                </p>
              )}
            </div>
          </div>
        </section>
      )}

      {tab === 'help' && (
        <section className="prefs-pane" role="tabpanel" id="prefs-panel-help" aria-labelledby="prefs-tab-help">
          <h3>Spoon{version ? ` ${version}` : ''}</h3>
          <p>Spoon is a Git client for Windows. Scan or clone repositories from Home, then fetch, pull, and commit from the toolbar.</p>
          <p>
            One AI button writes the message and, depending on Settings → AI, may also commit or push. Ctrl+Enter commits with your
            message; Ctrl+Shift+Enter commits and pushes. If no provider is connected, the AI button opens Settings → AI.
          </p>
          <p className="hint">Celebrate a successful push with confetti: press Ctrl+Shift+. anytime, or use the button below.</p>
          <h3>Guides</h3>
          <div className="row-btns" style={{ marginTop: 4 }}>
            <Button
              className="ghost"
              onClick={() => {
                document.dispatchEvent(new CustomEvent('spoon-confetti'))
              }}
            >
              Confetti (Ctrl+Shift+.)
            </Button>
            <Button
              className="ghost"
              onClick={() => {
                onClose()
                window.setTimeout(() => document.dispatchEvent(new CustomEvent('spoon-tour')), 50)
              }}
            >
              Take the tour
            </Button>
            <Button
              className="ghost"
              onClick={() => {
                void window.spoon.app.checkUpdate()
                onClose()
              }}
            >
              Check for updates
            </Button>
            <Button className="ghost" onClick={() => void window.spoon.app.openExternal('https://github.com/elgodox/spoon')}>
              GitHub
            </Button>
            <Button className="ghost" onClick={() => void window.spoon.app.openExternal('https://github.com/elgodox/spoon/issues')}>
              Report an issue
            </Button>
          </div>
        </section>
      )}

            </div>
            <div className="dialog-foot">
              <Button className="primary" onClick={onClose}>
                Done
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
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
  onSaved: (next?: Settings) => Promise<void>
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
    const s = await window.spoon.app.patchSettings({
      aiModels: { ...(settings?.aiModels ?? DEFAULT_AI_MODELS), [provider]: next }
    })
    await onSaved(s)
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
        {catalog?.live
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

function tabGroups(tabs: Tab[]): Tab[][] {
  const runs: Tab[][] = []
  for (const tab of tabs) {
    const key = tab.workspaceId ? `ws:${tab.workspaceId}` : tab.color ? `color:${tab.color}` : ''
    const prev = runs[runs.length - 1]
    const prevTab = prev?.[0]
    const prevKey = prevTab?.workspaceId ? `ws:${prevTab.workspaceId}` : prevTab?.color ? `color:${prevTab.color}` : ''
    if (key && prev && prevKey === key) prev.push(tab)
    else runs.push([tab])
  }
  return runs
}

function TabChip({
  tab,
  active,
  dirty,
  onFocus,
  onClose,
  onMenu
}: {
  tab: Tab
  active: boolean
  dirty: boolean
  onFocus: () => void
  onClose: () => void
  onMenu: (x: number, y: number) => void
}) {
  return (
    <div
      className={`tab ${active ? 'active' : ''}`}
      role="tab"
      aria-selected={active}
      style={tab.color ? { ['--tab-color' as string]: tab.color } : undefined}
      onContextMenu={(event) => {
        if (tab.kind !== 'repo') return
        event.preventDefault()
        onMenu(event.clientX, event.clientY)
      }}
    >
      <Button type="button" className="tab-hit" title="Right-click to group by color or workspace" onClick={onFocus}>
        {tab.color ? <i className="tab-dot" style={{ background: tab.color }} /> : null}
        <span className="name">{tab.name}</span>
        {dirty ? <span className="tab-dirty">*</span> : null}
      </Button>
      <Button type="button" className="x" aria-label={`Close ${tab.name}`} onClick={onClose}>
        <IcoClose />
      </Button>
    </div>
  )
}

function WorkspaceGroupMenu({
  x,
  y,
  label,
  onEdit,
  onSave,
  onClose,
  onCloseGroup
}: {
  x: number
  y: number
  label?: string
  onEdit: () => void
  onSave: () => void
  onClose: () => void
  onCloseGroup: () => void
}) {
  return (
    <div className="tab-menu-back" onMouseDown={onClose}>
      <div
        className="tab-menu"
        style={{ left: Math.max(8, Math.min(x, window.innerWidth - 220)), top: Math.max(8, Math.min(y, window.innerHeight - 120)) }}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <Button type="button" className="tab-menu-item" onClick={onEdit}>Edit workspace</Button>
        <Button type="button" className="tab-menu-item" onClick={onSave}>Save open repositories</Button>
        <Button type="button" className="tab-menu-item danger" onClick={onCloseGroup}>
          {label ? `Close workspace “${label}”` : 'Close group'}
        </Button>
      </div>
    </div>
  )
}

function TabGroupMenu({
  x,
  y,
  workspaces,
  canCloseWorkspace,
  onClose,
  onColor,
  onWorkspace,
  onCloseWorkspace
}: {
  x: number
  y: number
  workspaces: RepoWorkspace[]
  canCloseWorkspace?: boolean
  onClose: () => void
  onColor: (color: string | null) => void
  onWorkspace: (workspace: RepoWorkspace) => void
  onCloseWorkspace?: () => void
}) {
  return (
    <div className="tab-menu-back" onMouseDown={onClose}>
      <div
        className="tab-menu"
        style={{ left: Math.max(8, Math.min(x, window.innerWidth - 220)), top: Math.max(8, Math.min(y, window.innerHeight - 220)) }}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="tab-menu-label">Color</div>
        <div className="swatches">
          {WORKSPACE_COLORS.map((color) => (
            <Button key={color} type="button" className="swatch" style={{ background: color }} aria-label={color} onClick={() => onColor(color)} />
          ))}
        </div>
        <Button type="button" className="tab-menu-item" onClick={() => onColor(null)}>
          Ungroup
        </Button>
        <div className="tab-menu-label">Workspace</div>
        {workspaces.length ? (
          workspaces.map((workspace) => (
            <Button key={workspace.id} type="button" className="tab-menu-item" onClick={() => onWorkspace(workspace)}>
              <i className="tab-dot" style={{ background: workspace.color }} />
              {workspace.name}
            </Button>
          ))
        ) : (
          <p className="hint">Save a workspace from Home first.</p>
        )}
        {canCloseWorkspace && onCloseWorkspace ? (
          <Button type="button" className="tab-menu-item danger" onClick={onCloseWorkspace}>
            Close workspace
          </Button>
        ) : null}
      </div>
    </div>
  )
}

function WorkspaceEditor({ workspace, recent, onClose, onSave }: {
  workspace: RepoWorkspace
  recent: RepoSummary[]
  onClose: () => void
  onSave: (patch: { name: string; color: string; repos: string[] }) => Promise<void>
}) {
  const [name, setName] = useState(workspace.name)
  const [color, setColor] = useState(workspace.color)
  const [repos, setRepos] = useState(workspace.repos)
  const [extra, setExtra] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const choices = [...new Map([...workspace.repos, ...recent.map((repo) => repo.path), ...extra].map((path) => [path.toLowerCase(), path])).values()]
  async function save() {
    setBusy(true); setError('')
    try { await onSave({ name: name.trim(), color, repos }) }
    catch (reason) { setError((reason as Error).message) }
    finally { setBusy(false) }
  }
  return <Modal title="Edit workspace" onClose={() => { if (!busy) onClose() }}>
    <div className="workspace-editor">
      <label>Workspace name<input autoFocus value={name} disabled={busy} onChange={(event) => setName(event.target.value)} /></label>
      <div className="swatches" aria-label="Workspace color">{WORKSPACE_COLORS.map((item) => <Button key={item} className={`swatch ${item === color ? 'on' : ''}`} style={{ background: item }} aria-label={item} aria-pressed={item === color} disabled={busy} onClick={() => setColor(item)} />)}</div>
      <strong>Repositories · {repos.length}</strong>
      <div className="workspace-repo-options">{choices.map((path) => <label key={path.toLowerCase()} title={path}>
        <input type="checkbox" disabled={busy} checked={repos.some((repo) => repo.toLowerCase() === path.toLowerCase())} onChange={(event) => setRepos((current) => event.target.checked ? [...current, path] : current.filter((repo) => repo.toLowerCase() !== path.toLowerCase()))} />
        <span>{recent.find((repo) => repo.path.toLowerCase() === path.toLowerCase())?.name || fileName(path)}<small>{path}</small></span>
      </label>)}</div>
      <Button className="ghost" disabled={busy} onClick={() => void catchErr(async () => {
        const picked = await window.spoon.app.pickRepo() as { repos?: string[] } | string | null
        const paths = typeof picked === 'string' ? [picked] : picked?.repos ?? []
        setExtra((current) => [...current, ...paths])
        setRepos((current) => [...new Map([...current, ...paths].map((path) => [path.toLowerCase(), path])).values()])
      })}>Add repositories…</Button>
      {error && <p role="alert">{error}</p>}
      <div className="profile-actions"><Button className="primary" disabled={busy || !name.trim() || !repos.length} onClick={() => void save()}>{busy ? 'Saving…' : 'Save workspace'}</Button><Button disabled={busy} onClick={onClose}>Cancel</Button></div>
    </div>
  </Modal>
}

function WorkspaceManager({
  workspaces,
  recent,
  settings,
  accounts,
  onClose,
  onOpen,
  onEdit,
  onDelete,
  onWorkspaces,
  onOpenAiSettings
}: {
  workspaces: RepoWorkspace[]
  recent: RepoSummary[]
  settings: Settings | null
  accounts: AiAccount[]
  onClose: () => void
  onOpen: (workspace: RepoWorkspace) => void
  onEdit: (workspace: RepoWorkspace) => void
  onDelete: (id: string) => void
  onWorkspaces: (workspaces: RepoWorkspace[]) => void
  onOpenAiSettings: () => void
}) {
  const [aiBusy, setAiBusy] = useState(false)
  const [aiError, setAiError] = useState<string | null>(null)
  const [draft, setDraft] = useState<(WorkspaceSuggestion & { include: boolean; color: string })[] | null>(null)
  const [draftSummary, setDraftSummary] = useState('')
  const names = new Map(recent.map((repo) => [repo.path.toLowerCase(), repo.name]))
  const provider = fallbackAiProvider(settings?.aiProvider)
  const model = settings?.aiModels?.[provider]
  const aiConnected = accounts.some((account) => account.provider === provider && account.connected)

  async function runAiAnalyze() {
    if (recent.length < 2) {
      setAiError('Add at least two repositories first.')
      return
    }
    if (!aiConnected) {
      onOpenAiSettings()
      return
    }
    setAiBusy(true)
    setAiError(null)
    try {
      const result = (await window.spoon.ai.analyzeWorkspaces(provider, model)) as WorkspaceAnalysis
      setDraftSummary(result.summary)
      setDraft(
        result.workspaces.map((item, index) => ({
          ...item,
          include: true,
          color: workspaceColor(workspaces.length + index)
        }))
      )
    } catch (error) {
      setAiError(error instanceof Error ? error.message : String(error))
      setDraft(null)
    }
    setAiBusy(false)
  }

  async function persistDraft() {
    if (!draft) return
    const chosen = draft.filter((item) => item.include && item.name.trim() && item.repos.length)
    if (!chosen.length) return
    setAiBusy(true)
    setAiError(null)
    try {
      const result = (await window.spoon.app.saveWorkspaces(
        chosen.map((item) => ({ name: item.name.trim(), color: item.color, repos: item.repos }))
      )) as { workspaces: RepoWorkspace[]; saved: RepoWorkspace[] }
      onWorkspaces(result.workspaces)
      setDraft(null)
      setDraftSummary('')
    } catch (error) {
      setAiError(error instanceof Error ? error.message : String(error))
    }
    setAiBusy(false)
  }

  return (
    <Modal title="Workspaces" onClose={onClose} wide>
      <div className="ws-ai-bar">
        <div className="ws-ai-copy">
          <strong>AI workspaces</strong>
          <div className="hint">
            Analyze your repository list and save related groups. Saved workspaces stay in Spoon memory.
          </div>
        </div>
        <Button
          type="button"
          className="primary ico-text"
          disabled={aiBusy || recent.length < 2}
          onClick={() => void runAiAnalyze()}
        >
          <IcoAi />
          {aiBusy && !draft ? 'Analyzing…' : aiConnected ? 'Analyze with AI' : 'Connect AI'}
        </Button>
      </div>
      {aiError && <p className="hint danger-text">{aiError}</p>}
      {draft && (
        <div className="ws-ai-draft">
          <p className="hint">{draftSummary}</p>
          <ul className="ws-admin">
            {draft.map((item, index) => {
              const labels = item.repos.map((path) => names.get(path.toLowerCase()) || path.split(/[\\/]/).pop() || path)
              return (
                <li key={`${item.name}-${index}`}>
                  <label className="ws-ai-check">
                    <input
                      type="checkbox"
                      checked={item.include}
                      onChange={() =>
                        setDraft((prev) =>
                          prev?.map((row, i) => (i === index ? { ...row, include: !row.include } : row)) ?? null
                        )
                      }
                    />
                    <span className="ws-dot" style={{ background: item.color }} />
                    <div className="ws-admin-copy">
                      <strong>{item.name}</strong>
                      <div className="hint" title={labels.join(', ')}>
                        {labels.join(', ')}
                      </div>
                      {item.rationale && <div className="hint">{item.rationale}</div>}
                    </div>
                  </label>
                </li>
              )
            })}
          </ul>
          <div className="ws-ai-actions">
            <Button type="button" className="ghost" disabled={aiBusy} onClick={() => setDraft(null)}>
              Discard
            </Button>
            <Button
              type="button"
              className="primary"
              disabled={aiBusy || !draft.some((item) => item.include)}
              onClick={() => void persistDraft()}
            >
              {aiBusy ? 'Saving…' : 'Save to memory'}
            </Button>
          </div>
        </div>
      )}
      {!workspaces.length && !draft ? (
        <p className="hint">No saved workspaces yet. Select repositories on Home and choose Save, or analyze with AI.</p>
      ) : workspaces.length > 0 ? (
        <ul className="ws-admin">
          {workspaces.map((workspace) => {
            const labels = workspace.repos.map((path) => names.get(path.toLowerCase()) || path.split(/[\\/]/).pop() || path)
            return (
              <li key={workspace.id}>
                <span className="ws-dot" style={{ background: workspace.color }} />
                <div className="ws-admin-copy">
                  <strong>{workspace.name}</strong>
                  <div className="hint" title={labels.join(', ')}>{labels.join(', ')}</div>
                </div>
                <div className="ws-admin-actions">
                    <>
                      <Button type="button" className="ghost" onClick={() => onOpen(workspace)}>
                        Open
                      </Button>
                      <Button type="button" className="ghost" onClick={() => onEdit(workspace)}>
                        Edit
                      </Button>
                      <Button
                        type="button"
                        className="ghost danger"
                        onClick={() => {
                          void window.spoon.app
                            .confirm(`Delete workspace “${workspace.name}”?`, 'Repositories stay on disk and in the list.')
                            .then((ok) => {
                              if (ok) onDelete(workspace.id)
                            })
                        }}
                      >
                        Delete
                      </Button>
                    </>
                </div>
              </li>
            )
          })}
        </ul>
      ) : null}
    </Modal>
  )
}

function QuickLaunch({
  recent,
  workspaces,
  onClose,
  onOpen,
  onOpenWorkspace,
  onAction
}: {
  tabs: Tab[]
  recent: RepoSummary[]
  workspaces: RepoWorkspace[]
  snap?: Snapshot
  onClose: () => void
  onOpen: (p: string, n?: string) => void
  onOpenWorkspace: (workspace: RepoWorkspace) => void
  onAction: (a: string) => void
}) {
  const [q, setQ] = useState('')
  const items = [
    ...workspaces.map((workspace) => ({
      id: workspace.id,
      label: `Workspace ${workspace.name}`,
      run: () => onOpenWorkspace(workspace)
    })),
    ...recent.map((r) => ({ id: r.path, label: `Open ${r.name}`, run: () => onOpen(r.path, r.name) })),
    { id: 'fetch', label: 'Fetch', run: () => onAction('fetch') },
    { id: 'branch', label: 'New branch', run: () => onAction('branch') },
    { id: 'settings', label: 'Preferences', run: () => onAction('settings') }
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
