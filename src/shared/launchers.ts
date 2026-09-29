export type LauncherKind = 'ide' | 'agent' | 'cli' | 'system'

export type LauncherMode = 'ide' | 'cli-term' | 'terminal' | 'explorer'

export interface LauncherSpec {
  id: string
  label: string
  kind: LauncherKind
  /** Binaries to probe on PATH, in preference order. */
  bins: string[]
  mode: LauncherMode
  /** Extra args after the binary when launching a CLI session. */
  args?: string[]
  blurb: string
}

export interface LauncherInfo extends LauncherSpec {
  available: boolean
  command?: string
}

export const LAUNCHER_KIND_LABEL: Record<LauncherKind, string> = {
  ide: 'IDE',
  agent: 'Agent',
  cli: 'CLI',
  system: 'System'
}

export const LAUNCHER_KIND_ORDER: LauncherKind[] = ['ide', 'agent', 'cli', 'system']

/** Built-in open targets Spoon can detect and launch. */
export const LAUNCHER_CATALOG: LauncherSpec[] = [
  {
    id: 'cursor',
    label: 'Cursor',
    kind: 'ide',
    bins: ['cursor'],
    mode: 'ide',
    blurb: 'Open the folder in the Cursor IDE.'
  },
  {
    id: 'code',
    label: 'VS Code',
    kind: 'ide',
    bins: ['code'],
    mode: 'ide',
    blurb: 'Open the folder in Visual Studio Code.'
  },
  {
    id: 'windsurf',
    label: 'Windsurf',
    kind: 'ide',
    bins: ['windsurf'],
    mode: 'ide',
    blurb: 'Open the folder in Windsurf.'
  },
  {
    id: 'zed',
    label: 'Zed',
    kind: 'ide',
    bins: ['zed'],
    mode: 'ide',
    blurb: 'Open the folder in Zed.'
  },
  {
    id: 'cursor-agent',
    label: 'Cursor Agent',
    kind: 'agent',
    bins: ['cursor-agent'],
    mode: 'cli-term',
    blurb: 'Start Cursor Agent in a terminal for this repo.'
  },
  {
    id: 'grok',
    label: 'Grok',
    kind: 'agent',
    bins: ['grok'],
    mode: 'cli-term',
    blurb: 'Start the Grok agent TUI in this repo.'
  },
  {
    id: 'claude',
    label: 'Claude Code',
    kind: 'cli',
    bins: ['claude'],
    mode: 'cli-term',
    blurb: 'Start Claude Code in a terminal for this repo.'
  },
  {
    id: 'codex',
    label: 'Codex',
    kind: 'cli',
    bins: ['codex'],
    mode: 'cli-term',
    blurb: 'Start the Codex CLI in this repo.'
  },
  {
    id: 'gemini',
    label: 'Gemini CLI',
    kind: 'cli',
    bins: ['gemini'],
    mode: 'cli-term',
    blurb: 'Start Gemini CLI in a terminal for this repo.'
  },
  {
    id: 'opencode',
    label: 'OpenCode',
    kind: 'cli',
    bins: ['opencode'],
    mode: 'cli-term',
    blurb: 'Start OpenCode in a terminal for this repo.'
  },
  {
    id: 'terminal',
    label: 'Terminal',
    kind: 'system',
    bins: [],
    mode: 'terminal',
    blurb: 'Open a shell in the repository folder.'
  },
  {
    id: 'explorer',
    label: 'Explorer',
    kind: 'system',
    bins: [],
    mode: 'explorer',
    blurb: 'Reveal the folder in File Explorer.'
  }
]

export function launcherById(id: string): LauncherSpec | undefined {
  return LAUNCHER_CATALOG.find((item) => item.id === id)
}

export function groupLaunchers<T extends { kind: LauncherKind }>(items: T[]): { kind: LauncherKind; label: string; items: T[] }[] {
  return LAUNCHER_KIND_ORDER.map((kind) => ({
    kind,
    label: LAUNCHER_KIND_LABEL[kind],
    items: items.filter((item) => item.kind === kind)
  })).filter((group) => group.items.length > 0)
}

/** Map legacy editor preference to a launcher id. */
export function launcherFromEditor(editor: string | undefined): string {
  if (editor === 'cursor') return 'cursor'
  if (editor === 'explorer') return 'explorer'
  if (editor === 'code') return 'code'
  return 'cursor'
}
