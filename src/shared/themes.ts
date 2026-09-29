import type { AccentId, IconStyle, ThemeMode, ThemePack } from './types'

export type AccentDef = {
  id: AccentId
  label: string
  light: string
  dark: string
  swatch: string
}

export type ThemePackDef = {
  id: ThemePack
  label: string
  blurb: string
  preview: [string, string, string]
  preferDark?: boolean
  preferIcons?: IconStyle
  preferAccent?: AccentId
}

export const THEME_PACKS: ThemePackDef[] = [
  {
    id: 'classic',
    label: 'Classic',
    blurb: 'Clean Spoon chrome. Mono icons, familiar blue.',
    preview: ['#1e1e1e', '#6cb6ff', '#e8e8e8'],
    preferIcons: 'mono',
    preferAccent: 'blue'
  },
  {
    id: 'colored',
    label: 'Colored',
    blurb: 'Action icons in color so Fetch, Pull, and Push read at a glance.',
    preview: ['#1e1e1e', '#22c55e', '#3b82f6'],
    preferIcons: 'color',
    preferAccent: 'teal'
  },
  {
    id: 'spacex',
    label: 'SpaceX',
    blurb: 'Void black, white type, Mars red — xAI stillness with fluid micro-motion.',
    preview: ['#050505', '#e81828', '#f5f5f5'],
    preferDark: true,
    preferIcons: 'color',
    preferAccent: 'red'
  }
]

export const ACCENTS: AccentDef[] = [
  { id: 'blue', label: 'Blue', light: '#0b57d0', dark: '#6cb6ff', swatch: '#3b82f6' },
  { id: 'violet', label: 'Violet', light: '#7c3aed', dark: '#a78bfa', swatch: '#8b5cf6' },
  { id: 'red', label: 'Mars', light: '#c42b1c', dark: '#ff6b5a', swatch: '#e81828' },
  { id: 'teal', label: 'Teal', light: '#0f766e', dark: '#2dd4bf', swatch: '#14b8a6' },
  { id: 'amber', label: 'Amber', light: '#b45309', dark: '#fbbf24', swatch: '#f59e0b' },
  { id: 'silver', label: 'Silver', light: '#52525b', dark: '#d4d4d8', swatch: '#a1a1aa' },
  { id: 'custom', label: 'Custom', light: '#0b57d0', dark: '#6cb6ff', swatch: '#ffffff' }
]

/** Per-action icon colors when iconStyle is `color`. */
export const ICON_COLORS: Record<string, string> = {
  brand: '#c4b5fd',
  launch: '#38bdf8',
  workspaces: '#a78bfa',
  fetch: '#60a5fa',
  pull: '#34d399',
  push: '#fbbf24',
  refresh: '#94a3b8',
  stash: '#fb923c',
  branch: '#22d3ee',
  terminal: '#a3e635',
  health: '#f472b6',
  activity: '#818cf8',
  home: '#e2e8f0',
  settings: '#94a3b8',
  ai: '#c084fc',
  commit: '#4ade80',
  analyze: '#38bdf8'
}

export const SPACEX_ICON_COLORS: Record<string, string> = {
  brand: '#ffffff',
  launch: '#e8e8e8',
  workspaces: '#d4d4d8',
  fetch: '#7dd3fc',
  pull: '#86efac',
  push: '#e81828',
  refresh: '#a1a1aa',
  stash: '#fdba74',
  branch: '#e8e8e8',
  terminal: '#d4d4d8',
  health: '#fb7185',
  activity: '#c4c4c4',
  home: '#fafafa',
  settings: '#a1a1aa',
  ai: '#e81828',
  commit: '#ffffff',
  analyze: '#7dd3fc'
}

export function resolveAccent(
  accentId: AccentId | undefined,
  mode: ThemeMode,
  custom?: string
): { accent: string; accent2: string } {
  if (accentId === 'custom' && custom && /^#[0-9a-fA-F]{6}$/.test(custom)) {
    return { accent: custom, accent2: custom }
  }
  const def = ACCENTS.find((a) => a.id === (accentId ?? 'blue')) ?? ACCENTS[0]
  const accent = mode === 'dark' ? def.dark : def.light
  return { accent, accent2: accent }
}

export function iconColorMap(pack: ThemePack, style: IconStyle): Record<string, string> | null {
  if (style !== 'color') return null
  return pack === 'spacex' ? SPACEX_ICON_COLORS : ICON_COLORS
}

export function sanitizeThemePack(value: unknown): ThemePack {
  return value === 'colored' || value === 'spacex' || value === 'classic' ? value : 'classic'
}

export function sanitizeIconStyle(value: unknown): IconStyle {
  return value === 'color' || value === 'mono' ? value : 'mono'
}

export function sanitizeAccentId(value: unknown): AccentId {
  return ACCENTS.some((a) => a.id === value) ? (value as AccentId) : 'blue'
}

export function sanitizeAccentCustom(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  return /^#[0-9a-fA-F]{6}$/.test(value) ? value : undefined
}
