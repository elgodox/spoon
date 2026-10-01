import { gitChildEnv, gitInstallRoot, realGitExecutable } from './git-env.ts'
import { humanGitError } from '../shared/git-error.ts'

const root = 'C:\\Program Files\\Git'
const gitCmd = `${root}\\cmd\\git.exe`
const gitMingw = `${root}\\mingw64\\bin\\git.exe`
const exists = (path: string) =>
  [
    `${root}\\mingw64\\bin`,
    `${root}\\usr\\bin`,
    `${root}\\cmd`,
    gitMingw
  ].includes(path)

const env = gitChildEnv({
  platform: 'win32',
  gitPath: gitCmd,
  exists,
  base: {
    SYSTEMROOT: 'D:\\Windows',
    PATH: 'D:\\Windows\\System32',
    USERPROFILE: 'C:\\Users\\ada',
    LANG: 'en_US.UTF-8',
    LC_ALL: 'en_US.UTF-8'
  }
})

if (env.SystemRoot !== 'D:\\Windows') throw new Error(`SystemRoot was ${env.SystemRoot}`)
if ('SYSTEMROOT' in env) throw new Error('SYSTEMROOT casing leaked into the child environment')
if (env.WINDIR !== 'D:\\Windows') throw new Error('WINDIR was not filled from SystemRoot')
if (env.ComSpec !== 'D:\\Windows\\System32\\cmd.exe') throw new Error('ComSpec fallback')
if (env.HOME !== 'C:\\Users\\ada') throw new Error('HOME should follow USERPROFILE')
if (env.APPDATA !== 'C:\\Users\\ada\\AppData\\Roaming') throw new Error('APPDATA fallback')
if (env.LANG !== 'C.UTF-8' || env.LC_ALL !== 'C.UTF-8') throw new Error('locale should be C.UTF-8')
if (!env.PATH?.startsWith(`${root}\\mingw64\\bin;`)) throw new Error(`PATH prefix missing: ${env.PATH}`)
if (!env.PATH.includes('D:\\Windows\\System32')) throw new Error('original PATH was dropped')
if (env.PATH.split(';').filter((part) => part.toLowerCase() === 'd:\\windows\\system32').length !== 1) {
  throw new Error('System32 was duplicated')
}

const overlaid = gitChildEnv({
  platform: 'win32',
  exists: () => false,
  base: { SystemRoot: 'C:\\Windows', PATH: 'C:\\Windows\\System32', USERPROFILE: 'C:\\Users\\ada' },
  extra: { GIT_EDITOR: 'true', GIT_SEQUENCE_EDITOR: 'node editor.js' }
})
if (overlaid.GIT_EDITOR !== 'true' || overlaid.GIT_SEQUENCE_EDITOR !== 'node editor.js') {
  throw new Error('extra git env was dropped')
}
if (overlaid.GIT_TERMINAL_PROMPT !== '0') throw new Error('prompts should stay disabled')

if (gitInstallRoot(gitCmd) !== root) throw new Error('cmd wrapper root')
if (gitInstallRoot(`${root}\\bin\\git.exe`) !== root) throw new Error('bin wrapper root')
if (gitInstallRoot(gitMingw) !== root) throw new Error('mingw root')
if (realGitExecutable(gitCmd, exists) !== gitMingw) throw new Error('should prefer mingw64 git.exe')
if (realGitExecutable(`${root}\\bin\\git.exe`, exists) !== gitMingw) throw new Error('bin wrapper should prefer mingw64')
if (realGitExecutable(gitMingw, exists) !== gitMingw) throw new Error('mingw path should stay')
if (realGitExecutable('git', exists) !== 'git') throw new Error('bare command should stay')

const wrapped = "Error invoking remote method 'git:pull': Error: fatal: unable to access 'https://github.com/elgodox/GoldenRoulette.git': getaddrinfo() thread failed to start"
const shown = humanGitError(wrapped)
if (shown.includes('Error invoking remote method')) throw new Error('IPC prefix leaked')
if (!shown.includes('getaddrinfo() thread failed to start')) throw new Error('git line missing')
if (!shown.includes('SystemRoot')) throw new Error('hint missing')
if (humanGitError(shown) !== shown) throw new Error('hint was duplicated')

const other = humanGitError("Error invoking remote method 'git:commit': Error: nothing to commit")
if (other !== 'nothing to commit') throw new Error(`unexpected cleanup: ${other}`)

const missing = gitChildEnv({
  platform: 'win32',
  exists: () => false,
  base: { PATH: '' }
})
if (missing.SystemRoot !== 'C:\\Windows') throw new Error('default SystemRoot')

console.log('git env tests ok')
