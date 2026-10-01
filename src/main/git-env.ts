import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { execFile } from 'node:child_process'

/**
 * Canonical names MinGW and Win32 APIs look up. Curl's DNS thread fails with
 * "getaddrinfo() thread failed to start" when SystemRoot is absent. Electron
 * often exposes only SYSTEMROOT, and a case-variant duplicate in the same
 * environment block is not a reliable substitute.
 */
const WIN_CANONICAL: Record<string, string> = {
  systemroot: 'SystemRoot',
  windir: 'WINDIR',
  comspec: 'ComSpec',
  path: 'PATH',
  pathext: 'PATHEXT',
  home: 'HOME',
  userprofile: 'USERPROFILE',
  appdata: 'APPDATA',
  localappdata: 'LOCALAPPDATA',
  homedrive: 'HOMEDRIVE',
  homepath: 'HOMEPATH',
  systemdrive: 'SYSTEMDRIVE',
  programdata: 'ProgramData',
  programfiles: 'ProgramFiles',
  'programfiles(x86)': 'ProgramFiles(x86)',
  temp: 'TEMP',
  tmp: 'TMP',
  username: 'USERNAME',
  userdomain: 'USERDOMAIN'
}

export interface GitEnvOptions {
  base?: NodeJS.ProcessEnv
  extra?: NodeJS.ProcessEnv
  gitPath?: string
  platform?: NodeJS.Platform
  exists?: (path: string) => boolean
}

function filled(value: string | undefined): string | undefined {
  const text = value?.trim()
  return text ? text : undefined
}

export function windowsPath(root: string, ...parts: string[]): string {
  return [root.replace(/[\\/]+$/, ''), ...parts].join('\\')
}

export function gitInstallRoot(gitPath: string): string | undefined {
  const norm = gitPath.replace(/\//g, '\\')
  // Match mingw64\bin before a bare bin, or bin swallows the mingw directory.
  const mingw = norm.match(/^(.*)\\(?:mingw64|mingw32)\\bin\\git\.exe$/i)
  if (mingw) return mingw[1]
  const wrapped = norm.match(/^(.*)\\(?:cmd|bin)\\git\.exe$/i)
  return wrapped?.[1]
}

export function realGitExecutable(candidate: string, exists: (path: string) => boolean = existsSync): string {
  const root = gitInstallRoot(candidate)
  if (!root) return candidate
  const norm = candidate.replace(/\//g, '\\')
  for (const rel of ['mingw64\\bin\\git.exe', 'mingw32\\bin\\git.exe']) {
    const full = windowsPath(root, rel)
    if (full.toLowerCase() !== norm.toLowerCase() && exists(full)) return full
  }
  return candidate
}

function gitBinDirs(gitPath: string | undefined, exists: (path: string) => boolean): string[] {
  if (!gitPath) return []
  const root = gitInstallRoot(gitPath)
  if (!root) return []
  return ['mingw64\\bin', 'usr\\bin', 'cmd'].map((rel) => windowsPath(root, rel)).filter((dir) => exists(dir))
}

function prependPath(current: string, dirs: string[]): string {
  const parts = current.split(';').filter(Boolean)
  const seen = new Set(parts.map((part) => part.toLowerCase()))
  const add = dirs.filter((dir) => !seen.has(dir.toLowerCase()))
  return [...add, ...parts].join(';')
}

export function gitChildEnv(options: GitEnvOptions = {}): NodeJS.ProcessEnv {
  const platform = options.platform ?? process.platform
  const exists = options.exists ?? existsSync
  const env: NodeJS.ProcessEnv = {}
  for (const [key, value] of Object.entries(options.base ?? process.env)) {
    if (value === undefined) continue
    const name = platform === 'win32' ? (WIN_CANONICAL[key.toLowerCase()] ?? key) : key
    if (key === name || env[name] === undefined) env[name] = value
  }

  if (platform === 'win32') {
    const systemRoot = filled(env.SystemRoot) || 'C:\\Windows'
    env.SystemRoot = systemRoot
    env.WINDIR = filled(env.WINDIR) || systemRoot
    env.ComSpec = filled(env.ComSpec) || windowsPath(systemRoot, 'System32', 'cmd.exe')
    env.SYSTEMDRIVE = filled(env.SYSTEMDRIVE) || systemRoot.slice(0, 2)
    env.ProgramData = filled(env.ProgramData) || `${systemRoot.slice(0, 2)}\\ProgramData`
    const profile = filled(env.USERPROFILE) || homedir()
    env.USERPROFILE = profile
    env.HOME = filled(env.HOME) || profile
    env.APPDATA = filled(env.APPDATA) || windowsPath(profile, 'AppData', 'Roaming')
    env.LOCALAPPDATA = filled(env.LOCALAPPDATA) || windowsPath(profile, 'AppData', 'Local')
    env.HOMEDRIVE = filled(env.HOMEDRIVE) || profile.slice(0, 2)
    env.HOMEPATH = filled(env.HOMEPATH) || profile.slice(2) || '\\'
    const system32 = windowsPath(systemRoot, 'System32')
    env.PATH = prependPath(filled(env.PATH) || '', [...gitBinDirs(options.gitPath, exists), system32])
  } else if (!filled(env.HOME)) {
    env.HOME = homedir()
  }

  // Git for Windows ships C.UTF-8. en_US.UTF-8 usually is not installed, and an
  // invalid locale can keep the mingw resolver thread from starting.
  env.LANG = 'C.UTF-8'
  env.LC_ALL = 'C.UTF-8'
  env.GIT_TERMINAL_PROMPT = '0'
  env.GIT_OPTIONAL_LOCKS = '0'

  if (options.extra) {
    for (const [key, value] of Object.entries(options.extra)) {
      if (value !== undefined) env[key] = value
    }
  }
  return env
}

/** Fill gaps on the live process so children that inherit the environment can resolve DNS. */
export function ensureWindowsEnv(): void {
  if (process.platform !== 'win32') return
  const repaired = gitChildEnv({ platform: 'win32' })
  for (const key of [
    'SystemRoot',
    'WINDIR',
    'ComSpec',
    'SYSTEMDRIVE',
    'ProgramData',
    'HOME',
    'USERPROFILE',
    'APPDATA',
    'LOCALAPPDATA',
    'HOMEDRIVE',
    'HOMEPATH'
  ]) {
    if (!filled(process.env[key]) && repaired[key]) process.env[key] = repaired[key]
  }
}

export function whereCommand(command: string): Promise<string | undefined> {
  if (process.platform !== 'win32') return Promise.resolve(undefined)
  return new Promise((resolve) => {
    execFile(
      'where.exe',
      [command],
      { windowsHide: true, env: gitChildEnv() },
      (error, stdout) => {
        if (error) {
          resolve(undefined)
          return
        }
        const first = stdout
          .split(/\r?\n/)
          .map((line) => line.trim())
          .find(Boolean)
        resolve(first)
      }
    )
  })
}
