import { execFile, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { shell } from 'electron'
import {
  LAUNCHER_CATALOG,
  launcherById,
  launcherFromEditor,
  type LauncherInfo,
  type LauncherSpec
} from '../shared/launchers'
import { getSettings } from './store'

const whichCache = new Map<string, Promise<boolean>>()

function which(cmd: string): Promise<boolean> {
  const hit = whichCache.get(cmd)
  if (hit) return hit
  const run = new Promise<boolean>((resolve) => {
    execFile('where', [cmd], { windowsHide: true }, (err) => resolve(!err))
  })
  whichCache.set(cmd, run)
  return run
}

export function clearLauncherCache(): void {
  whichCache.clear()
}

async function resolveCommand(spec: LauncherSpec): Promise<string | undefined> {
  if (spec.mode === 'terminal' || spec.mode === 'explorer') return spec.id
  for (const bin of spec.bins) {
    if (await which(bin)) return bin
  }
  return undefined
}

export async function listLaunchers(force = false): Promise<{
  launchers: LauncherInfo[]
  defaultId: string
}> {
  if (force) clearLauncherCache()
  const launchers: LauncherInfo[] = []
  for (const spec of LAUNCHER_CATALOG) {
    const command = await resolveCommand(spec)
    const available = spec.mode === 'terminal' || spec.mode === 'explorer' || !!command
    launchers.push({ ...spec, available, command })
  }
  return { launchers, defaultId: resolveDefaultId(launchers) }
}

export function resolveDefaultId(launchers?: LauncherInfo[]): string {
  const settings = getSettings()
  const preferred = settings.defaultLauncher || launcherFromEditor(settings.editor)
  if (launchers?.some((item) => item.id === preferred && item.available)) return preferred
  const available = launchers?.filter((item) => item.available) ?? []
  const ide = available.find((item) => item.kind === 'ide')
  if (ide) return ide.id
  if (available.some((item) => item.id === 'explorer')) return 'explorer'
  return preferred
}

export async function openWith(path: string, launcherId?: string): Promise<string> {
  if (!existsSync(path)) throw new Error('That folder no longer exists.')
  const { launchers, defaultId } = await listLaunchers()
  const id = launcherId || defaultId
  const launcher = launchers.find((item) => item.id === id) ?? launcherById(id)
  if (!launcher) throw new Error(`Unknown launcher “${id}”.`)
  if ('available' in launcher && !launcher.available) {
    throw new Error(`${launcher.label} is not installed or not on PATH.`)
  }
  const command = ('command' in launcher ? launcher.command : undefined) || launcher.bins[0]
  return launch(path, launcher, command)
}

async function launch(path: string, spec: LauncherSpec, command?: string): Promise<string> {
  const detached = { detached: true, stdio: 'ignore' as const, windowsHide: true, cwd: path }
  if (spec.mode === 'explorer') {
    await shell.openPath(path)
    return spec.label
  }
  if (spec.mode === 'terminal') {
    if (await which('wt')) {
      spawn('wt', ['-d', path], detached).unref()
      return 'Windows Terminal'
    }
    const ps = (await which('pwsh')) ? 'pwsh' : 'powershell'
    spawn(ps, ['-NoExit', '-NoLogo'], { ...detached, windowsHide: false }).unref()
    return ps
  }
  if (spec.mode === 'ide') {
    if (!command) throw new Error(`${spec.label} is not installed or not on PATH.`)
    spawn('cmd', ['/c', command, path], detached).unref()
    return spec.label
  }
  // CLI / agent: open an interactive terminal session in the repo folder.
  if (!command) throw new Error(`${spec.label} is not installed or not on PATH.`)
  const args = spec.args ?? []
  const line = [command, ...args].map(quoteArg).join(' ')
  if (await which('wt')) {
    spawn('wt', ['-d', path, 'cmd', '/k', line], detached).unref()
    return spec.label
  }
  spawn('cmd', ['/c', 'start', `"${spec.label}"`, 'cmd', '/k', `cd /d "${path}" && ${line}`], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true
  }).unref()
  return spec.label
}

function quoteArg(value: string): string {
  if (!/[ \t"]/u.test(value)) return value
  return `"${value.replace(/"/g, '\\"')}"`
}

/** Legacy helper used by older IPC callers. */
export async function openInLegacy(path: string, target: 'editor' | 'terminal' | 'explorer'): Promise<string> {
  if (target === 'terminal') return openWith(path, 'terminal')
  if (target === 'explorer') return openWith(path, 'explorer')
  return openWith(path)
}
