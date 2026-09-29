import { app, nativeTheme, safeStorage } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { DEFAULT_AI_MODELS, fallbackAiProvider } from '../shared/models'
import { launcherFromEditor } from '../shared/launchers'
import type { AiProviderId, AppSession, RepoSummary, RepoWorkspace, SessionTab, Settings, ThemeMode } from '../shared/types'
import {
  sanitizeAccentCustom,
  sanitizeAccentId,
  sanitizeIconStyle,
  sanitizeThemePack
} from '../shared/themes'
import { normalizeWorkspaceColor, sanitizeWorkspaces, uniqueRepoPaths, workspaceColor } from '../shared/workspaces'

export interface StoredAiCreds {
  provider: AiProviderId
  method: 'oauth' | 'api-key' | 'imported'
  accessToken?: string
  refreshToken?: string
  apiKey?: string
  expiresAt?: number
  clientId?: string
  email?: string
  label?: string
}

interface StoreFile {
  settings: Settings
  recent: RepoSummary[]
  folders: { name: string; repos: string[] }[]
  workspaces: RepoWorkspace[]
  session: AppSession
  creds: Record<string, string>
}

function sanitizeTheme(theme: unknown): ThemeMode {
  if (theme === 'light' || theme === 'dark') return theme
  return nativeTheme.shouldUseDarkColors ? 'dark' : 'light'
}

const defaults: Settings = {
  theme: 'dark',
  themePack: 'classic',
  iconStyle: 'mono',
  accentId: 'blue',
  fetchIntervalMin: 10,
  autoFetch: true,
  autoFetchAll: false,
  autoUpdate: true,
  material: 'none',
  watchedRoots: [],
  pinned: [],
  onboarded: false,
  editor: 'code',
  defaultLauncher: 'cursor',
  aiProvider: 'grok',
  aiModels: { ...DEFAULT_AI_MODELS },
  aiEndpoints: [],
  aiCommitMode: 'commit',
  aiStageAll: true,
  recentMessages: [],
  starred: {},
  sidebarWidth: 220,
  changesListWidth: 280,
  changesSplit: 0.55,
  detailsHeight: 260,
  commitBoxHeight: 168,
  hideUntracked: false,
  ignoreWhitespace: false,
  diffMode: 'unified',
  showAvatars: true,
  glass: 0,
  repoSort: 'opened'
}

function filePath(): string {
  const dir = app.getPath('userData')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return join(dir, 'spoon.json')
}

function sanitizeAiModels(models: Record<string, string>): Record<string, string> {
  const next = { ...models }
  delete next.free
  return next
}

let cache: StoreFile | null = null

function load(): StoreFile {
  if (cache) return cache
  try {
    const raw = readFileSync(filePath(), 'utf8')
    const parsed = JSON.parse(raw) as StoreFile
    const hadSettings = !!parsed.settings
    cache = {
      settings: {
        ...defaults,
        // Existing installs already know the app; only brand-new users get the tour.
        onboarded: hadSettings && (parsed.recent?.length ?? 0) > 0,
        ...(parsed.settings as Partial<Settings> | undefined),
        theme: sanitizeTheme((parsed.settings as Partial<Settings> | undefined)?.theme),
        themePack: sanitizeThemePack((parsed.settings as Partial<Settings> | undefined)?.themePack),
        iconStyle: sanitizeIconStyle((parsed.settings as Partial<Settings> | undefined)?.iconStyle),
        accentId: sanitizeAccentId((parsed.settings as Partial<Settings> | undefined)?.accentId),
        accentCustom: sanitizeAccentCustom((parsed.settings as Partial<Settings> | undefined)?.accentCustom),
        aiProvider: fallbackAiProvider((parsed.settings as Partial<Settings> | undefined)?.aiProvider),
        aiModels: sanitizeAiModels({ ...defaults.aiModels, ...(parsed.settings?.aiModels ?? {}) }),
        aiEndpoints: parsed.settings?.aiEndpoints ?? [],
        // Transparency removed — keep chrome solid for every pack.
        glass: 0,
        material: 'none'
      },
      recent: parsed.recent ?? [],
      folders: parsed.folders ?? [],
      workspaces: sanitizeWorkspaces(parsed.workspaces),
      session: sanitizeSession((parsed as { session?: unknown }).session),
      creds: parsed.creds ?? {}
    }
    if (!cache.settings.defaultLauncher) {
      cache.settings.defaultLauncher = launcherFromEditor(cache.settings.editor)
    }
    const migratedFree =
      (parsed.settings as Partial<Settings> | undefined)?.aiProvider === 'free' || Boolean(parsed.settings?.aiModels?.free)
    if (migratedFree) {
      try {
        save(cache)
      } catch {
        /* keep the in-memory migration even if the file cannot be rewritten */
      }
    }
  } catch {
    cache = { settings: { ...defaults }, recent: [], folders: [], workspaces: [], session: emptySession(), creds: {} }
  }
  return cache
}

function save(data: StoreFile): void {
  cache = data
  writeFileSync(filePath(), JSON.stringify(data), 'utf8')
}

export function getSettings(): Settings {
  return load().settings
}

export function patchSettings(patch: Partial<Settings>): Settings {
  const data = load()
  data.settings = { ...data.settings, ...patch }
  save(data)
  return data.settings
}

export function getRecent(): RepoSummary[] {
  return load().recent
}

export function touchRepo(path: string, name: string): RepoSummary[] {
  const data = load()
  data.recent = [
    { path, name, lastOpened: Date.now() },
    ...data.recent.filter((r) => r.path !== path)
  ].slice(0, 500)
  save(data)
  return data.recent
}

export function touchRepos(repos: { path: string; name: string }[]): RepoSummary[] {
  const data = load()
  let recent = data.recent
  const now = Date.now()
  for (const repo of repos) {
    recent = [{ path: repo.path, name: repo.name, lastOpened: now }, ...recent.filter((r) => r.path !== repo.path)]
  }
  data.recent = recent.slice(0, 500)
  save(data)
  return data.recent
}

export function addRepos(repos: { path: string; name: string }[]): RepoSummary[] {
  const data = load()
  const known = new Set(data.recent.map((r) => r.path.toLowerCase()))
  const fresh = repos.filter((r) => !known.has(r.path.toLowerCase())).map((r) => ({ ...r, lastOpened: 0 }))
  if (!fresh.length) return data.recent
  data.recent = [...data.recent, ...fresh].slice(0, 500)
  save(data)
  return data.recent
}

export function removeRecent(path: string): RepoSummary[] {
  const data = load()
  data.recent = data.recent.filter((r) => r.path !== path)
  save(data)
  return data.recent
}

export function getFolders(): { name: string; repos: string[] }[] {
  return load().folders
}

export function setFolders(folders: { name: string; repos: string[] }[]): void {
  const data = load()
  data.folders = folders
  save(data)
}

export function getWorkspaces(): RepoWorkspace[] {
  return load().workspaces
}

export function saveWorkspace(input: { id?: string; name: string; color?: string; repos: string[] }): {
  workspaces: RepoWorkspace[]
  saved: RepoWorkspace
} {
  const data = load()
  const name = input.name.trim().slice(0, 80)
  if (!name) throw new Error('Name the workspace.')
  const repos = uniqueRepoPaths(input.repos)
  if (!repos.length) throw new Error('A workspace needs a repository.')
  const existing =
    (input.id ? data.workspaces.find((item) => item.id === input.id) : undefined) ??
    data.workspaces.find((item) => item.name.toLowerCase() === name.toLowerCase())
  const color = input.color
    ? normalizeWorkspaceColor(input.color, data.workspaces.length)
    : existing?.color
      ? normalizeWorkspaceColor(existing.color)
      : workspaceColor(data.workspaces.length)
  const saved: RepoWorkspace = {
    id: existing?.id ?? `ws-${Date.now()}`,
    name,
    color,
    repos
  }
  data.workspaces = [saved, ...data.workspaces.filter((item) => item.id !== saved.id)]
  save(data)
  return { workspaces: data.workspaces, saved }
}

export function deleteWorkspace(id: string): RepoWorkspace[] {
  const data = load()
  data.workspaces = data.workspaces.filter((item) => item.id !== id)
  save(data)
  return data.workspaces
}

export function saveWorkspaces(
  inputs: { name: string; color?: string; repos: string[] }[]
): { workspaces: RepoWorkspace[]; saved: RepoWorkspace[] } {
  const data = load()
  const saved: RepoWorkspace[] = []
  for (const input of inputs) {
    const name = input.name.trim().slice(0, 80)
    if (!name) continue
    const repos = uniqueRepoPaths(input.repos)
    if (!repos.length) continue
    const existing = data.workspaces.find((item) => item.name.toLowerCase() === name.toLowerCase())
    const color = input.color
      ? normalizeWorkspaceColor(input.color, data.workspaces.length + saved.length)
      : existing?.color
        ? normalizeWorkspaceColor(existing.color)
        : workspaceColor(data.workspaces.length + saved.length)
    const row: RepoWorkspace = {
      id: existing?.id ?? `ws-${Date.now()}-${saved.length}`,
      name,
      color,
      repos
    }
    data.workspaces = [row, ...data.workspaces.filter((item) => item.id !== row.id)]
    saved.push(row)
  }
  if (!saved.length) throw new Error('Nothing to save.')
  save(data)
  return { workspaces: data.workspaces, saved }
}

export function saveCreds(creds: StoredAiCreds): void {
  const data = load()
  const json = JSON.stringify(creds)
  data.creds[creds.provider] = safeStorage.isEncryptionAvailable()
    ? safeStorage.encryptString(json).toString('base64')
    : Buffer.from(json, 'utf8').toString('base64')
  save(data)
}

export function loadCreds(provider: AiProviderId): StoredAiCreds | null {
  const data = load()
  const blob = data.creds[provider]
  if (!blob) return null
  try {
    const buf = Buffer.from(blob, 'base64')
    const json = safeStorage.isEncryptionAvailable()
      ? safeStorage.decryptString(buf)
      : buf.toString('utf8')
    return JSON.parse(json) as StoredAiCreds
  } catch {
    return null
  }
}

export function clearCreds(provider: AiProviderId): void {
  const data = load()
  delete data.creds[provider]
  save(data)
}

export function allCreds(): StoredAiCreds[] {
  const data = load()
  return Object.keys(data.creds)
    .map((p) => loadCreds(p))
    .filter((c): c is StoredAiCreds => !!c)
}

export function setTheme(theme: ThemeMode): Settings {
  return patchSettings({ theme })
}

export function pushRecentMessage(message: string): string[] {
  const data = load()
  const trimmed = message.trim()
  if (!trimmed) return data.settings.recentMessages
  data.settings.recentMessages = [
    trimmed,
    ...data.settings.recentMessages.filter((m) => m !== trimmed)
  ].slice(0, 30)
  save(data)
  return data.settings.recentMessages
}

function emptySession(): AppSession {
  return { tabs: [], activePath: null, collapsedGroups: {} }
}

function sanitizeSession(raw: unknown): AppSession {
  if (!raw || typeof raw !== 'object') return emptySession()
  const row = raw as Partial<AppSession>
  const tabs: SessionTab[] = []
  const seen = new Set<string>()
  for (const item of Array.isArray(row.tabs) ? row.tabs : []) {
    if (!item || typeof item !== 'object') continue
    const tab = item as Partial<SessionTab>
    if (typeof tab.path !== 'string' || !tab.path.trim()) continue
    const path = tab.path.trim()
    const key = path.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    tabs.push({
      path,
      name: typeof tab.name === 'string' && tab.name.trim() ? tab.name.trim() : path.split(/[\\/]/).pop() || path,
      workspaceId: typeof tab.workspaceId === 'string' && tab.workspaceId.trim() ? tab.workspaceId.trim() : undefined,
      color: typeof tab.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(tab.color) ? tab.color.toLowerCase() : undefined
    })
    if (tabs.length >= 40) break
  }
  const collapsedGroups: Record<string, boolean> = {}
  if (row.collapsedGroups && typeof row.collapsedGroups === 'object') {
    for (const [key, value] of Object.entries(row.collapsedGroups)) {
      if (value) collapsedGroups[key] = true
    }
  }
  const activePath =
    typeof row.activePath === 'string' && row.activePath.trim()
      ? row.activePath.trim()
      : row.activePath === null
        ? null
        : undefined
  return { tabs, activePath: activePath ?? null, collapsedGroups }
}

export function getSession(): AppSession {
  const session = sanitizeSession(load().session)
  return {
    ...session,
    tabs: session.tabs.filter((tab) => existsSync(tab.path))
  }
}

export function saveSession(input: AppSession): AppSession {
  const data = load()
  data.session = sanitizeSession(input)
  save(data)
  return data.session
}
