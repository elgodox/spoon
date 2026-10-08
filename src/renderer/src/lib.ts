import type { CommitInfo } from '../../shared/types'

let menuUnsub: (() => void) | null = null

export function openMenu(items: object[], onPick: (id: string) => void) {
  void window.spoon.app.popup(items)
  menuUnsub?.()
  menuUnsub = window.spoon.app.on('menu:item', (id) => {
    menuUnsub?.()
    menuUnsub = null
    onPick(String(id))
  })
}

export function openWithMenuItems(
  launchers: { id: string; label: string; kind: string; available: boolean }[],
  opts?: { defaultId?: string; prefix?: string }
): object[] {
  const prefix = opts?.prefix ?? 'open:'
  const kindOrder = ['ide', 'agent', 'cli', 'system'] as const
  const kindLabel: Record<string, string> = {
    ide: 'IDE',
    agent: 'Agent',
    cli: 'CLI',
    system: 'System'
  }
  const available = launchers.filter((item) => item.available)
  const items: object[] = []
  for (const kind of kindOrder) {
    const rows = available.filter((item) => item.kind === kind)
    if (!rows.length) continue
    items.push({
      label: kindLabel[kind],
      submenu: rows.map((item) => ({
        id: `${prefix}${item.id}`,
        label: item.id === opts?.defaultId ? `${item.label} (default)` : item.label
      }))
    })
  }
  return items
}

const LANE_COLORS = ['#b18aff', '#67a8ff', '#f18cde', '#56d7c0', '#f3ba72', '#9295ff', '#ff879b', '#b5cf77']

export function laneColor(lane: number): string {
  return LANE_COLORS[Math.abs(lane) % LANE_COLORS.length]
}

/** Soft underglow for graph strokes (hex + alpha). */
export function laneGlow(lane: number, alpha = 0.22): string {
  const hex = laneColor(lane)
  const n = parseInt(hex.slice(1), 16)
  const r = (n >> 16) & 255
  const g = (n >> 8) & 255
  const b = n & 255
  return `rgba(${r},${g},${b},${alpha})`
}

export function parseReflogSubject(subject: string): { selector: string; action: string; detail: string } {
  const m = subject.match(/^(HEAD@\{\d+\}):\s*(.*)$/)
  if (!m) return { selector: '', action: '', detail: subject }
  const rest = m[2]
  const am = rest.match(/^([A-Za-z][\w-]*):\s*(.*)$/)
  if (am) return { selector: m[1], action: am[1], detail: am[2] }
  return { selector: m[1], action: '', detail: rest }
}

export function branchLeafName(name: string): string {
  const i = name.indexOf('/')
  return i >= 0 ? name.slice(i + 1) : name
}

/** Group `feat/foo` under folder `feat`; bare names stay at the root. */
export function groupByPathPrefix<T>(items: T[], nameOf: (item: T) => string): { roots: T[]; folders: { key: string; items: T[] }[] } {
  const folderMap = new Map<string, T[]>()
  const roots: T[] = []
  for (const item of items) {
    const name = nameOf(item)
    const i = name.indexOf('/')
    if (i <= 0) {
      roots.push(item)
      continue
    }
    const key = name.slice(0, i)
    const list = folderMap.get(key) ?? []
    list.push(item)
    folderMap.set(key, list)
  }
  const folders = [...folderMap.entries()]
    .sort((a, b) => a[0].localeCompare(b[0], undefined, { sensitivity: 'base' }))
    .map(([key, group]) => ({ key, items: group }))
  return { roots, folders }
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

export function avatarColor(seed: string): string {
  const colors = ['#43a047', '#1e88e5', '#8e24aa', '#fb8c00', '#e53935', '#00897b', '#3949ab', '#6d4c41']
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 33 + seed.charCodeAt(i)) >>> 0
  return colors[h % colors.length]
}

export function formatDate(ms: number): string {
  const d = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, '0')
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `${pad(d.getDate())} ${months[d.getMonth()]} ${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function formatAgo(ms: number): string {
  const s = Math.max(1, Math.round((Date.now() - ms) / 1000))
  if (s < 60) return `${s} seconds ago`
  const m = Math.round(s / 60)
  if (m < 60) return `${m} minute${m === 1 ? '' : 's'} ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h} hour${h === 1 ? '' : 's'} ago`
  const d = Math.round(h / 24)
  if (d < 30) return `${d} day${d === 1 ? '' : 's'} ago`
  const mo = Math.round(d / 30)
  if (mo < 12) return `${mo} month${mo === 1 ? '' : 's'} ago`
  const y = Math.round(mo / 12)
  return `${y} year${y === 1 ? '' : 's'} ago`
}

export function fileName(path: string): string {
  return path.split(/[/\\]/).pop() || path
}

export function parentDir(path: string): string {
  const i = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return i >= 0 ? path.slice(0, i) : ''
}

export function statusLetter(code: string): string {
  if (code === '?' || code === ' ') return ''
  return code
}

export function headCommit(commits: CommitInfo[]): CommitInfo | undefined {
  return commits.find((c) => c.refs.some((r) => r.current)) || commits[0]
}

export function joinRepoPath(root: string, rel: string): string {
  const slash = root.includes('\\') ? '\\' : '/'
  return `${root.replace(/[\\/]+$/, '')}${slash}${rel.replace(/[\\/]/g, slash)}`
}

export function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n))
}

export function bindDrag(
  event: { preventDefault(): void },
  axis: 'x' | 'y',
  onMove: (client: number) => void,
  onUp?: (client: number) => void
): void {
  event.preventDefault()
  let last = 0
  const move = (ev: PointerEvent) => {
    last = axis === 'x' ? ev.clientX : ev.clientY
    onMove(last)
  }
  const up = (ev: PointerEvent) => {
    last = axis === 'x' ? ev.clientX : ev.clientY
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', up)
    document.body.classList.remove('resizing', 'resizing-y')
    onUp?.(last)
  }
  document.body.classList.add(axis === 'x' ? 'resizing' : 'resizing-y')
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', up)
}

export async function catchErr(fn: () => Promise<void>): Promise<void> {
  try {
    await fn()
  } catch (e) {
    await window.spoon.app.error(e instanceof Error ? e.message : String(e))
  }
}

/** Lowercase extension used to group changed files by type ("(none)" when there is no extension). */
export function fileType(path: string): string {
  const name = path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1)
  const dot = name.lastIndexOf('.')
  if (dot < 0 || dot === name.length - 1) return '(none)'
  return name.slice(dot).toLowerCase()
}
