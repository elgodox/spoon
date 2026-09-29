import type { RepoWorkspace, WorkspaceAnalysis, WorkspaceSuggestion } from './types'

export const WORKSPACE_COLORS = [
  '#4c8dff',
  '#2faf74',
  '#e0a106',
  '#e06a4f',
  '#a56bde',
  '#2aa8c4',
  '#d45d8c',
  '#8a93a3'
] as const

export function workspaceColor(index: number): string {
  const n = Number.isFinite(index) ? Math.abs(Math.trunc(index)) : 0
  return WORKSPACE_COLORS[n % WORKSPACE_COLORS.length]
}

export function normalizeWorkspaceColor(color: unknown, index = 0): string {
  if (typeof color === 'string' && /^#[0-9a-fA-F]{6}$/.test(color)) return color.toLowerCase()
  return workspaceColor(index)
}

export function parentDir(path: string): string {
  const norm = path.replace(/\\/g, '/').replace(/\/+$/, '')
  const i = norm.lastIndexOf('/')
  return i > 0 ? norm.slice(0, i) : norm
}

export function folderLabel(path: string): string {
  const parent = parentDir(path)
  const parts = parent.split('/').filter(Boolean)
  return parts[parts.length - 1] || 'Projects'
}

export function groupKey(tab: { id: string; workspaceId?: string; color?: string }): string {
  if (tab.workspaceId) return `ws:${tab.workspaceId}`
  if (tab.color) return `color:${tab.color.toLowerCase()}`
  return `tab:${tab.id}`
}

export function clusterGrouped<T extends { id: string; workspaceId?: string; color?: string }>(tabs: T[]): T[] {
  const used = new Set<string>()
  const out: T[] = []
  for (const tab of tabs) {
    if (used.has(tab.id)) continue
    const key = groupKey(tab)
    if (key.startsWith('tab:')) {
      used.add(tab.id)
      out.push(tab)
      continue
    }
    for (const other of tabs) {
      if (used.has(other.id) || groupKey(other) !== key) continue
      used.add(other.id)
      out.push(other)
    }
  }
  return out
}

export function uniqueRepoPaths(paths: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const path of paths) {
    const trimmed = path.trim()
    if (!trimmed) continue
    const key = trimmed.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(trimmed)
  }
  return out
}

export function sanitizeWorkspaces(raw: unknown): RepoWorkspace[] {
  if (!Array.isArray(raw)) return []
  const out: RepoWorkspace[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const row = item as Partial<RepoWorkspace>
    if (typeof row.id !== 'string' || !row.id.trim()) continue
    if (typeof row.name !== 'string' || !row.name.trim()) continue
    if (!Array.isArray(row.repos)) continue
    const repos = uniqueRepoPaths(row.repos.filter((path): path is string => typeof path === 'string'))
    if (!repos.length) continue
    out.push({
      id: row.id.trim(),
      name: row.name.trim().slice(0, 80),
      color: normalizeWorkspaceColor(row.color, out.length),
      repos
    })
  }
  return out
}

export function parseWorkspaceAnalysis(
  text: string,
  knownRepos: { path: string; name: string }[]
): WorkspaceAnalysis {
  const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/```$/i, '').trim()
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  if (start < 0 || end <= start) throw new Error('The workspace analysis was not JSON.')
  const data = JSON.parse(cleaned.slice(start, end + 1)) as {
    summary?: string
    workspaces?: { name?: string; repos?: unknown; rationale?: string }[]
  }
  const byPath = new Map(knownRepos.map((repo) => [repo.path.toLowerCase(), repo.path]))
  const byName = new Map<string, string[]>()
  for (const repo of knownRepos) {
    const key = repo.name.toLowerCase()
    const list = byName.get(key) ?? []
    list.push(repo.path)
    byName.set(key, list)
  }
  const used = new Set<string>()
  const workspaces: WorkspaceSuggestion[] = []
  for (const item of data.workspaces ?? []) {
    const name = (item.name ?? '').trim().slice(0, 80)
    if (!name) continue
    const repos = resolveRepoRefs(item.repos, byPath, byName).filter((path) => {
      const key = path.toLowerCase()
      if (used.has(key)) return false
      used.add(key)
      return true
    })
    if (repos.length < 1) continue
    workspaces.push({
      name,
      repos,
      rationale: (item.rationale ?? '').trim()
    })
  }
  if (!workspaces.length) throw new Error('The analysis did not name any workspaces.')
  return {
    summary: (data.summary ?? '').trim() || `${workspaces.length} suggested workspace${workspaces.length === 1 ? '' : 's'}.`,
    workspaces
  }
}

export function fallbackWorkspaceAnalysis(repos: { path: string; name: string }[]): WorkspaceAnalysis {
  if (!repos.length) throw new Error('Add repositories before analyzing workspaces.')
  const groups = new Map<string, string[]>()
  for (const repo of repos) {
    const key = parentDir(repo.path).toLowerCase()
    const list = groups.get(key) ?? []
    list.push(repo.path)
    groups.set(key, list)
  }
  const workspaces: WorkspaceSuggestion[] = [...groups.entries()].map(([, paths]) => {
    const label = folderLabel(paths[0])
    const multi = paths.length > 1
    return {
      name: multi ? label : repos.find((repo) => repo.path === paths[0])?.name || label,
      repos: paths,
      rationale: multi
        ? `Repositories under the same folder (${label}).`
        : 'Single repository; kept as its own workspace.'
    }
  })
  // Prefer multi-repo groups first, then singles
  workspaces.sort((a, b) => b.repos.length - a.repos.length || a.name.localeCompare(b.name))
  // Drop solitary leftovers when there is at least one real group of 2+
  const clustered = workspaces.filter((item) => item.repos.length > 1)
  const chosen = clustered.length ? clustered : workspaces
  return {
    summary: `${repos.length} repositor${repos.length === 1 ? 'y' : 'ies'} grouped into ${chosen.length} workspace${chosen.length === 1 ? '' : 's'} by folder.`,
    workspaces: chosen
  }
}

function resolveRepoRefs(
  value: unknown,
  byPath: Map<string, string>,
  byName: Map<string, string[]>
): string[] {
  if (!Array.isArray(value)) return []
  const out: string[] = []
  for (const item of value) {
    if (typeof item !== 'string' || !item.trim()) continue
    const raw = item.trim()
    const byExact = byPath.get(raw.toLowerCase())
    if (byExact) {
      out.push(byExact)
      continue
    }
    const names = byName.get(raw.toLowerCase())
    if (names?.length === 1) {
      out.push(names[0])
      continue
    }
    const leaf = raw.replace(/\\/g, '/').split('/').pop()?.toLowerCase()
    if (leaf) {
      const named = byName.get(leaf)
      if (named?.length === 1) out.push(named[0])
    }
  }
  return uniqueRepoPaths(out)
}
