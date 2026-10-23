import { execFile, spawn } from 'node:child_process'
import { existsSync, lstatSync, readFileSync, statSync } from 'node:fs'
import { delimiter, dirname, join, resolve } from 'node:path'
import { app, shell } from 'electron'
import {
  LAUNCHER_CATALOG,
  launcherById,
  launcherFromEditor,
  type LauncherIcon,
  type LauncherInfo,
  type LauncherSpec
} from '../shared/launchers'
import { getSettings } from './store'
import { runCommand } from './command'

/**
 * Extensions Windows can start, in PATHEXT order. Extensionless files are skipped on purpose:
 * VS Code and Cursor ship a `bin/code` bash script next to `code.cmd`, and `where code` lists it first.
 */
const RUNNABLE = ['.com', '.exe', '.bat', '.cmd']

let dirsCache: Promise<string[]> | null = null
const locateCache = new Map<string, Promise<string | undefined>>()

export function clearLauncherCache(): void {
  dirsCache = null
  locateCache.clear()
}

/** Expand `%VAR%` references the way Windows does for REG_EXPAND_SZ values. */
export function expandEnv(value: string, env: NodeJS.ProcessEnv = process.env): string {
  return value.replace(/%([^%]+)%/g, (all, name: string) => env[name] ?? all)
}

/** Split PATH-like lists, expand variables and drop duplicates (case-insensitive), keeping the first. */
export function mergeDirs(lists: string[], env: NodeJS.ProcessEnv = process.env): string[] {
  const seen = new Set<string>()
  const dirs: string[] = []
  for (const list of lists) {
    for (const raw of list.split(delimiter)) {
      const dir = expandEnv(raw.trim().replace(/^"(.*)"$/, '$1'), env).replace(/[\\/]+$/, '')
      if (!dir || seen.has(dir.toLowerCase())) continue
      seen.add(dir.toLowerCase())
      dirs.push(dir)
    }
  }
  return dirs
}

/** Where CLI installers put their shims, for a PATH that misses them. */
export function knownBinDirs(env: NodeJS.ProcessEnv = process.env): string[] {
  const home = env.USERPROFILE
  const roaming = env.APPDATA
  const local = env.LOCALAPPDATA
  return [
    home && join(home, '.local', 'bin'),
    roaming && join(roaming, 'npm'),
    local && join(local, 'pnpm'),
    home && join(home, '.bun', 'bin'),
    home && join(home, 'scoop', 'shims'),
    local && join(local, 'Microsoft', 'WindowsApps'),
    local && join(local, 'Programs', 'Microsoft VS Code', 'bin'),
    local && join(local, 'Programs', 'cursor', 'resources', 'app', 'bin'),
    local && join(local, 'Programs', 'Windsurf', 'bin')
  ].filter((dir): dir is string => !!dir)
}

function registryPath(key: string): Promise<string> {
  return new Promise((done) => {
    execFile('reg.exe', ['query', key, '/v', 'Path'], { windowsHide: true }, (error, stdout) => {
      done(error ? '' : (stdout.match(/^\s*Path\s+REG_(?:EXPAND_)?SZ\s+(.*)$/im)?.[1]?.trim() ?? ''))
    })
  })
}

/**
 * Folders to search for launchers. Spoon's own PATH can be stale: it is inherited from whatever
 * started Spoon (Explorer, the installer, the auto-updater relaunch), so a CLI installed later is
 * missing from it. The current user and machine PATH are read from the registry instead.
 */
export function searchDirs(): Promise<string[]> {
  dirsCache ??= Promise.all([
    registryPath('HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment'),
    registryPath('HKCU\\Environment')
  ]).then(([machine, user]) => mergeDirs([process.env.PATH ?? '', machine, user, knownBinDirs().join(delimiter)]))
  return dirsCache
}

/** App Execution Aliases (WindowsApps\wt.exe) are reparse points that `existsSync` reports as missing. */
function isRunnableFile(file: string): boolean {
  try {
    return statSync(file).isFile()
  } catch {
    try {
      const link = lstatSync(file)
      return link.isFile() || link.isSymbolicLink()
    } catch {
      return false
    }
  }
}

/** First runnable file for `bin` in `dirs`, searched in PATH order like Windows does. */
export function findOnPath(bin: string, dirs: string[], exists: (file: string) => boolean = isRunnableFile): string | undefined {
  const exts = /\.[a-z0-9]+$/i.test(bin) && RUNNABLE.includes(bin.slice(bin.lastIndexOf('.')).toLowerCase()) ? [''] : RUNNABLE
  for (const dir of dirs) {
    for (const ext of exts) {
      const file = join(dir, bin + ext)
      if (exists(file)) return file
    }
  }
  return undefined
}

export function locate(bin: string): Promise<string | undefined> {
  const key = bin.toLowerCase()
  let hit = locateCache.get(key)
  if (!hit) {
    hit = searchDirs().then((dirs) => findOnPath(bin, dirs))
    locateCache.set(key, hit)
  }
  return hit
}

/** Environment for started tools, with the refreshed PATH so npm shims can find `node`. */
async function launchEnv(extra?: NodeJS.ProcessEnv): Promise<NodeJS.ProcessEnv> {
  const env: NodeJS.ProcessEnv = {}
  for (const [key, value] of Object.entries(process.env)) if (key.toLowerCase() !== 'path') env[key] = value
  env.Path = (await searchDirs()).join(delimiter)
  return { ...env, ...extra }
}

async function resolveCommand(spec: LauncherSpec): Promise<{ command: string; path: string } | undefined> {
  // Probe every candidate at once, then keep the catalog's preference order.
  const found = await Promise.all(spec.bins.map((bin) => locate(bin)))
  const index = found.findIndex(Boolean)
  return index < 0 ? undefined : { command: spec.bins[index], path: found[index]! }
}

export async function listLaunchers(force = false): Promise<{
  launchers: LauncherInfo[]
  defaultId: string
}> {
  if (force) clearLauncherCache()
  const commands = await Promise.all(LAUNCHER_CATALOG.map((spec) => resolveCommand(spec)))
  const launchers: LauncherInfo[] = LAUNCHER_CATALOG.map((spec, index) => {
    if (spec.mode === 'terminal' || spec.mode === 'explorer') return { ...spec, available: true, command: spec.id }
    const found = commands[index]
    return { ...spec, available: !!found, command: found?.command, path: found?.path }
  })
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
  const file = (launcher as Partial<LauncherInfo>).path
  try {
    return await launch(path, launcher, file)
  } catch (error) {
    throw new Error(`Could not open ${launcher.label}: ${error instanceof Error ? error.message : String(error)}`)
  }
}

const iconCache = new Map<string, Promise<string | null>>()

/** The program Windows would show an icon for: the editor behind a `.cmd` shim, or the CLI itself. */
function iconSource(launcher: LauncherInfo): string | undefined {
  if (launcher.mode === 'explorer') return join(process.env.SystemRoot ?? 'C:\\Windows', 'explorer.exe')
  if (!launcher.path) return undefined
  const file = launcher.mode === 'ide' ? editorExecutable(launcher.path)?.bin : launcher.path
  return file && /\.exe$/i.test(file) ? file : undefined
}

async function programIcon(file: string): Promise<string | null> {
  // Programs without an icon resource (most CLIs, App Execution Aliases) get Windows' generic one.
  const generic = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'whoami.exe')
  const [icon, plain] = await Promise.all([app.getFileIcon(file, { size: 'normal' }), app.getFileIcon(generic, { size: 'normal' })])
  if (icon.isEmpty() || icon.toPNG().equals(plain.toPNG())) return null
  return icon.toDataURL()
}

/** What the "Open with" button shows for the default (or given) launcher. */
export async function launcherIcon(launcherId?: string): Promise<LauncherIcon> {
  const { launchers, defaultId } = await listLaunchers()
  const id = launcherId || defaultId
  const launcher = launchers.find((item) => item.id === id && item.available)
  if (!launcher) return { id, icon: null }
  const base = { id, label: launcher.label, kind: launcher.kind, mode: launcher.mode }
  const file = iconSource(launcher)
  if (!file) return { ...base, icon: null }
  let icon = iconCache.get(file.toLowerCase())
  if (!icon) {
    icon = programIcon(file).catch(() => null)
    iconCache.set(file.toLowerCase(), icon)
  }
  return { ...base, icon: await icon }
}

export async function openFileAt(repo: string, file: string, line = 1, launcherId?: string): Promise<string> {
  if (!existsSync(file)) throw new Error('This file no longer exists in the working tree. Use Show in Explorer to open its folder.')
  const { launchers, defaultId } = await listLaunchers()
  const editors = launchers.filter((item) => item.kind === 'ide' && item.available)
  const editor = launcherId ? editors.find((item) => item.id === launcherId) : editors.find((item) => item.id === defaultId) ?? editors[0]
  if (!editor?.path) throw new Error('No supported editor is installed. Configure an editor in Settings → Open with.')
  const target = `${file}:${Math.max(1, Math.floor(line))}:1`
  const args = editor.id === 'zed' ? [target] : ['--goto', target]
  const targetCommand = editorExecutable(editor.path)
  if (!targetCommand) throw new Error('The editor launcher could not be resolved. Reinstall its command-line launcher.')
  await runCommand(targetCommand.bin, targetCommand.cli ? [targetCommand.cli, ...args] : args, { cwd: repo, timeout: 30_000, env: targetCommand.cli ? { ELECTRON_RUN_AS_NODE: '1', VSCODE_DEV: '' } : undefined })
  return editor.label
}

/**
 * The real program behind an editor launcher. VS Code-style `.cmd` shims run
 * `"%~dp0<editor>.exe" "%~dp0<cli.js>" %*`; starting that pair directly keeps the folder out of
 * cmd.exe. Returns null for a shim of another shape.
 */
export function editorExecutable(file: string): { bin: string; cli?: string } | null {
  if (!/\.(cmd|bat)$/i.test(file)) return { bin: file }
  const shim = readFileSync(file, 'utf8')
  const relative = shim.match(/"%~dp0([^"\r\n]+\.exe)"/i)?.[1]
  const bin = relative && resolve(dirname(file), relative)
  if (!bin || !existsSync(bin)) return null
  const cliPath = shim.match(/"%~dp0([^"\r\n]+cli\.js)"/i)?.[1]
  const cli = cliPath && resolve(dirname(file), cliPath)
  if (cli && !existsSync(cli)) return null
  return { bin, cli }
}

export interface SpawnPlan {
  file: string
  args: string[]
  /** The single argument is a cmd.exe command line, passed through untouched. */
  verbatim?: boolean
  env?: NodeJS.ProcessEnv
}

/** Run `line` in a new console window through cmd's `start`, titled `title`. */
function startInConsole(title: string, line: string): SpawnPlan {
  return { file: 'cmd.exe', args: ['/d', '/s', '/c', `"start "${title}" ${line}"`], verbatim: true }
}

/**
 * How a CLI session is opened: a Windows Terminal tab when `wt` exists, else a cmd window.
 * The repo folder is always the working directory, never part of a command line, so `&`, `;`
 * and quotes in folder names stay harmless. `cmd /k` keeps the window open after the CLI exits.
 */
export function cliPlan(label: string, cli: string, args: string[] = [], wt?: string): SpawnPlan {
  if (wt) return { file: wt, args: ['-d', '.', 'cmd', '/k', cli, ...args] }
  return startInConsole(label, `cmd /k ${[cli, ...args].map(quoteArg).join(' ')}`)
}

/** A plain shell in the repo folder. */
export function terminalPlan(shellPath: string, wt?: string): SpawnPlan {
  if (wt) return { file: wt, args: ['-d', '.'] }
  return startInConsole('Spoon', `${quoteArg(shellPath)} -NoExit -NoLogo`)
}

/** An editor opened on `folder`. */
export function idePlan(file: string, folder: string): SpawnPlan {
  const target = editorExecutable(file)
  if (target?.cli) return { file: target.bin, args: [target.cli, folder], env: { ELECTRON_RUN_AS_NODE: '1', VSCODE_DEV: '' } }
  if (target && !/\.(cmd|bat)$/i.test(target.bin)) return { file: target.bin, args: [folder] }
  // Never hand the folder to cmd.exe unquoted: "R&D" would open "R" and run "D" as a command.
  return { file: 'cmd.exe', args: ['/d', '/s', '/c', `""${file}" "${folder}""`], verbatim: true }
}

/**
 * Start a detached program and wait until Windows has actually created it, so a missing or
 * broken executable is reported instead of crashing the main process with an unhandled
 * `error` event. cmd.exe wrappers are also waited on so a failing `start` is reported.
 */
export async function startDetached(plan: SpawnPlan, cwd: string): Promise<void> {
  const env = await launchEnv(plan.env)
  await new Promise<void>((done, fail) => {
    const child = spawn(plan.file, plan.args, {
      cwd,
      env,
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
      windowsVerbatimArguments: plan.verbatim
    })
    child.once('error', fail)
    if (!plan.verbatim) {
      child.once('spawn', () => {
        child.unref()
        done()
      })
      return
    }
    const timer = setTimeout(() => {
      child.unref()
      done()
    }, 10_000)
    child.once('exit', (code) => {
      clearTimeout(timer)
      if (code === 0) done()
      else fail(new Error(`the command exited with code ${code}.`))
    })
  })
}

async function launch(path: string, spec: LauncherSpec, file?: string): Promise<string> {
  if (spec.mode === 'explorer') {
    const failure = await shell.openPath(path)
    if (failure) throw new Error(failure)
    return spec.label
  }
  const wt = await locate('wt')
  if (spec.mode === 'terminal') {
    const shellPath = (await locate('pwsh')) ?? (await locate('powershell')) ?? 'powershell.exe'
    await startDetached(terminalPlan(shellPath, wt), path)
    return wt ? 'Windows Terminal' : spec.label
  }
  if (!file) throw new Error(`${spec.label} is not installed or not on PATH.`)
  if (spec.mode === 'ide') {
    await startDetached(idePlan(file, path), path)
    return spec.label
  }
  // CLI / agent: open an interactive terminal session in the repo folder.
  await startDetached(cliPlan(spec.label, file, spec.args, wt), path)
  return spec.label
}

function quoteArg(value: string): string {
  if (!/[ \t"&|<>^()]/u.test(value)) return value
  return `"${value.replace(/"/g, '\\"')}"`
}

/** Legacy helper used by older IPC callers. */
export async function openInLegacy(path: string, target: 'editor' | 'terminal' | 'explorer'): Promise<string> {
  if (target === 'terminal') return openWith(path, 'terminal')
  if (target === 'explorer') return openWith(path, 'explorer')
  return openWith(path)
}
