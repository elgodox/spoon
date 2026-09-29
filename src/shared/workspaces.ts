import type { RepoWorkspace } from './types'

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
