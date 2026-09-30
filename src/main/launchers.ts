import { execFile, spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { shell } from 'electron'
import {
  LAUNCHER_CATALOG,
  launcherById,
  launcherFromEditor,
  type LauncherInfo,
  type LauncherSpec
} from '../shared/launchers'
import { getSettings } from './store'
import { runCommand } from './command'

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
  const command = ('command' in launcher && typeof launcher.command === 'string' ? launcher.command : undefined) || launcher.bins[0]
  return launch(path, launcher, command)
}

export async function openFileAt(repo: string, file: string, line = 1, launcherId?: string): Promise<string> {
  if (!existsSync(file)) throw new Error('This file no longer exists in the working tree. Use Show in Explorer to open its folder.')
  const { launchers, defaultId } = await listLaunchers()
  const editors = launchers.filter((item) => item.kind === 'ide' && item.available)
  const editor = launcherId ? editors.find((item) => item.id === launcherId) : editors.find((item) => item.id === defaultId) ?? editors[0]
  if (!editor?.command) throw new Error('No supported editor is installed. Configure an editor in Settings → Open with.')
  const target = `${file}:${Math.max(1, Math.floor(line))}:1`
  const args = editor.id === 'zed' ? [target] : ['--goto', target]
  const targetCommand = await editorExecutable(editor.command)
  await runCommand(targetCommand.bin, targetCommand.cli ? [targetCommand.cli, ...args] : args, { cwd: repo, timeout: 30_000, env: targetCommand.cli ? { ELECTRON_RUN_AS_NODE: '1', VSCODE_DEV: '' } : undefined })
  return editor.label
}

async function editorExecutable(command: string): Promise<{ bin: string; cli?: string }> {
  const file = await new Promise<string>((resolve, reject) => execFile('where.exe', [command], { windowsHide: true }, (error, stdout) => error ? reject(error) : resolve(stdout.trim().split(/\r?\n/)[0])))
  if (!/\.(cmd|bat)$/i.test(file)) return { bin: file }
  const shim = readFileSync(file, 'utf8')
  const relative = shim.match(/"%~dp0([^"\r\n]+\.exe)"/i)?.[1]
  const bin = relative && resolve(dirname(file), relative)
  if (!bin || !existsSync(bin)) throw new Error('The editor launcher could not be resolved. Reinstall its command-line launcher.')
  const cliPath = shim.match(/"%~dp0([^"\r\n]+cli\.js)"/i)?.[1]
  const cli = cliPath && resolve(dirname(file), cliPath)
  if (cli && !existsSync(cli)) throw new Error('The editor command-line script is missing. Reinstall its launcher.')
  return { bin, cli }
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
