import { app, safeStorage } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { DEFAULT_AI_MODELS } from '../shared/models'
import type { AiProviderId, RepoSummary, Settings, ThemeMode } from '../shared/types'

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
  creds: Record<string, string>
}

const defaults: Settings = {
  theme: 'system',
  fetchIntervalMin: 10,
  autoFetch: true,
  aiProvider: 'grok',
  aiModels: { ...DEFAULT_AI_MODELS },
  aiCommitMode: 'fill',
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
  glass: 40
}

function filePath(): string {
  const dir = app.getPath('userData')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return join(dir, 'spoon.json')
}

function load(): StoreFile {
  try {
    const raw = readFileSync(filePath(), 'utf8')
    const parsed = JSON.parse(raw) as StoreFile
    return {
      settings: {
        ...defaults,
        ...parsed.settings,
        aiModels: { ...defaults.aiModels, ...(parsed.settings?.aiModels ?? {}) }
      },
      recent: parsed.recent ?? [],
      folders: parsed.folders ?? [],
      creds: parsed.creds ?? {}
    }
  } catch {
    return { settings: { ...defaults }, recent: [], folders: [], creds: {} }
  }
}

function save(data: StoreFile): void {
  writeFileSync(filePath(), JSON.stringify(data, null, 2), 'utf8')
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
  ].slice(0, 100)
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
  data.recent = recent.slice(0, 100)
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
  return (['grok', 'chatgpt', 'claude'] as AiProviderId[])
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
