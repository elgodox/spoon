import {
  app,
  BrowserWindow,
  Menu,
  dialog,
  ipcMain,
  shell,
  nativeTheme,
  clipboard
} from 'electron'
import { spawn, execFile } from 'node:child_process'
import { existsSync, mkdirSync, watch as fsWatch, writeFileSync, type FSWatcher } from 'node:fs'
import { release } from 'node:os'
import { join } from 'node:path'
import type {
  ActivityItem,
  AiEndpointConfig,
  AiProviderId,
  BulkAction,
  BulkResult,
  CommitOptions,
  FetchOptions,
  PullOptions,
  PushOptions,
  RebaseTodoItem,
  RepoFixId,
  Settings,
  WindowMaterial
} from '../shared/types'
import * as git from './git'
import * as store from './store'
import * as oauth from './oauth'
import * as updater from './updater'
import { analyzeRepository, generateCommitMessage } from './ai'
import { listProviderModels } from './model-catalog'

app.commandLine.appendSwitch('disable-gpu-sandbox')
app.setAppUserModelId('com.spoon.git')

if (!app.requestSingleInstanceLock()) {
  app.quit()
  process.exit(0)
}

let mainWindow: BrowserWindow | null = null
const watchers = new Map<string, { close: () => void }>()
const snapInflight = new Map<string, Promise<unknown>>()
const activity: { id: string; time: number; title: string; command?: string; output?: string; status: 'running' | 'ok' | 'error' }[] = []
let fetchTimer: NodeJS.Timeout | null = null

const WINDOWS_BUILD = process.platform === 'win32' ? Number(release().split('.')[2] ?? 0) : 0

function effectiveMaterial(): WindowMaterial {
  const s = store.getSettings()
  if ((s.glass ?? 40) <= 0) return 'none'
  // BrowserWindow materials need Windows 11 22H2 (build 22621); earlier builds would paint black.
  if (WINDOWS_BUILD < 22621) return 'none'
  return s.material ?? 'mica'
}

function windowChrome() {
  const dark = nativeTheme.shouldUseDarkColors
  const material = effectiveMaterial()
  return {
    dark,
    material,
    background: material !== 'none' ? '#00000000' : dark ? '#17171c' : '#f6f6f9',
    bar: material !== 'none' ? '#00000000' : dark ? '#17171c' : '#f6f6f9',
    symbol: dark ? '#f2f2f7' : '#1c1c22'
  }
}

function chromeInfo() {
  const c = windowChrome()
  return { dark: c.dark, material: c.material, build: WINDOWS_BUILD }
}

function syncNativeTheme(): void {
  const mode = store.getSettings().theme
  const source = mode === 'system' ? 'system' : mode
  if (nativeTheme.themeSource !== source) nativeTheme.themeSource = source
  paintWindowChrome()
  send('theme:native', nativeTheme.shouldUseDarkColors)
}

function paintWindowChrome(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return
  const colors = windowChrome()
  mainWindow.setBackgroundColor(colors.background)
  if (process.platform === 'win32') {
    try {
      if (WINDOWS_BUILD >= 22621) mainWindow.setBackgroundMaterial(colors.material)
    } catch {
      /* material not supported on this build */
    }
    mainWindow.setTitleBarOverlay({ color: colors.bar, symbolColor: colors.symbol, height: 40 })
  }
  send('chrome', chromeInfo())
}

function createWindow(): void {
  const colors = windowChrome()
  const bounds = store.getSettings().windowBounds
  mainWindow = new BrowserWindow({
    ...(bounds
      ? { width: bounds.width, height: bounds.height, x: bounds.x, y: bounds.y }
      : { width: 1400, height: 880 }),
    minWidth: 980,
    minHeight: 620,
    show: false,
    backgroundColor: colors.background,
    backgroundMaterial: process.platform === 'win32' && colors.material !== 'none' ? colors.material : undefined,
    autoHideMenuBar: true,
    titleBarStyle: process.platform === 'win32' ? 'hidden' : 'default',
    titleBarOverlay:
      process.platform === 'win32'
        ? { color: colors.bar, symbolColor: colors.symbol, height: 40 }
        : undefined,
    icon: app.isPackaged
      ? join(process.resourcesPath, 'icon.png')
      : join(__dirname, '../../resources/icon.png'),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false,
      backgroundThrottling: true
    }
  })

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show()
    mainWindow?.focus()
  })
  mainWindow.on('close', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return
    store.patchSettings({ windowBounds: mainWindow.getBounds() })
  })
  mainWindow.webContents.on('did-fail-load', (_e, code, desc, url) => {
    void dialog.showMessageBox(mainWindow!, {
      type: 'error',
      message: 'Spoon failed to load the UI',
      detail: `${code} ${desc}\n${url}`
    })
  })
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  const rendererUrl = process.env['ELECTRON_RENDERER_URL']
  if (rendererUrl) {
    void mainWindow.loadURL(rendererUrl)
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function send(channel: string, ...args: unknown[]): void {
  mainWindow?.webContents.send(channel, ...args)
}

function pushActivity(item: (typeof activity)[number]): void {
  activity.unshift(item)
  if (activity.length > 80) activity.pop()
  send('activity', activity)
}

async function withActivity<T>(title: string, command: string, fn: () => Promise<T>): Promise<T> {
  const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`
  const item: ActivityItem = { id, time: Date.now(), title, command, status: 'running', output: '' }
  pushActivity(item)
  try {
    const result = await fn()
    item.status = 'ok'
    item.output = typeof result === 'string' ? result : (result as { stdout?: string })?.stdout || 'Done'
    pushActivity({ ...item })
    return result
  } catch (err) {
    item.status = 'error'
    item.output = err instanceof Error ? err.message : String(err)
    pushActivity({ ...item })
    throw err
  }
}

async function bulk(action: BulkAction, paths: string[]): Promise<BulkResult[]> {
  const run = git.limiter(action === 'refresh' ? 8 : 4)
  let done = 0
  const title = { fetch: 'Fetch all', pull: 'Pull all', push: 'Push all', refresh: 'Refresh all' }[action]
  return withActivity(title, `${paths.length} repositories`, () =>
    Promise.all(
      paths.map((path) =>
        run(async (): Promise<BulkResult> => {
          const name = path.split(/[\\/]/).pop() || path
          const result = await bulkOne(action, path, name).catch(
            (err): BulkResult => ({ path, name, ok: false, message: err instanceof Error ? err.message.split('\n')[0] : String(err) })
          )
          send('bulk:progress', { done: ++done, total: paths.length, result })
          return result
        })
      )
    )
  )
}

async function bulkOne(action: BulkAction, path: string, name: string): Promise<BulkResult> {
  const skip = (message: string): BulkResult => ({ path, name, ok: true, skipped: true, message })
  if (!existsSync(path)) return { path, name, ok: false, message: 'Folder not found' }
  if (action === 'refresh') return { path, name, ok: true, message: 'Refreshed' }
  if (action === 'fetch') {
    const remotes = await git.getRemotes(path)
    if (!remotes.length) return skip('No remote')
    await git.fetchRemote(path, { all: true, prune: true })
    return { path, name, ok: true, message: 'Fetched' }
  }
  const o = await git.overview(path)
  if (o.error) return { path, name, ok: false, message: o.error }
  if (o.operation) return skip(`${o.operation} in progress`)
  if (o.detached) return skip('Detached HEAD')
  if (!o.upstream) return skip('No upstream')
  if (action === 'pull') {
    if (!o.behind) return skip('Up to date')
    if (o.staged + o.unstaged + o.conflicts > 0) return skip('Has local changes')
    if (o.ahead) return skip('Diverged, pull it manually')
    await git.git(path, ['pull', '--ff-only'])
    return { path, name, ok: true, message: `Pulled ${o.behind} commit(s)` }
  }
  if (!o.ahead) return skip('Nothing to push')
  if (o.behind) return skip('Behind remote, pull first')
  await git.git(path, ['push'])
  return { path, name, ok: true, message: `Pushed ${o.ahead} commit(s)` }
}

function which(cmd: string): Promise<boolean> {
  return new Promise((r) => execFile('where', [cmd], { windowsHide: true }, (err) => r(!err)))
}

async function openIn(path: string, target: 'editor' | 'terminal' | 'explorer'): Promise<string> {
  if (!existsSync(path)) throw new Error('That folder no longer exists.')
  const detached = { detached: true, stdio: 'ignore' as const, windowsHide: true, cwd: path }
  if (target === 'explorer') {
    await shell.openPath(path)
    return 'Explorer'
  }
  if (target === 'terminal') {
    if (await which('wt')) {
      spawn('wt', ['-d', path], detached).unref()
      return 'Windows Terminal'
    }
    const ps = (await which('pwsh')) ? 'pwsh' : 'powershell'
    spawn(ps, ['-NoExit', '-NoLogo'], { ...detached, windowsHide: false }).unref()
    return ps
  }
  const preferred = store.getSettings().editor ?? 'code'
  const editors = preferred === 'explorer' ? [] : [preferred, preferred === 'code' ? 'cursor' : 'code']
  for (const cmd of editors) {
    if (await which(cmd)) {
      spawn('cmd', ['/c', cmd, '.'], detached).unref()
      return cmd === 'code' ? 'VS Code' : 'Cursor'
    }
  }
  await shell.openPath(path)
  return 'Explorer'
}

function scheduleFetch(): void {
  if (fetchTimer) clearInterval(fetchTimer)
  fetchTimer = null
  const s = store.getSettings()
  if (!s.autoFetch) return
  fetchTimer = setInterval(() => {
    const now = store.getSettings()
    if (!now.autoFetch) return
    if (now.autoFetchAll) {
      const paths = store
        .getRecent()
        .filter((r) => r.lastOpened > 0 || now.pinned?.includes(r.path))
        .slice(0, 40)
        .map((r) => r.path)
      void bulk('fetch', paths).then(() => send('bulk:done', 'fetch'))
    }
    send('auto-fetch')
  }, Math.max(1, s.fetchIntervalMin) * 60_000)
}

function watchRepo(repoPath: string): void {
  if (watchers.has(repoPath)) return
  watchers.set(repoPath, { close: () => undefined })
  void git.gitDirOf(repoPath).then((gitDir) => {
    if (watchers.has(repoPath)) watchGitDir(repoPath, gitDir)
  })
}

function watchGitDir(repoPath: string, gitDir: string): void {
  const handles: FSWatcher[] = []
  let timer: NodeJS.Timeout | null = null
  const ping = () => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => send('repo:changed', repoPath), 900)
  }
  const add = (p: string, recursive = false) => {
    if (!existsSync(p)) return
    try {
      const w = fsWatch(p, { persistent: true, recursive }, ping)
      w.on('error', () => undefined)
      handles.push(w)
    } catch {
      /* directory may vanish during git operations */
    }
  }
  add(join(gitDir, 'HEAD'))
  add(join(gitDir, 'index'))
  add(join(gitDir, 'COMMIT_EDITMSG'))
  add(join(gitDir, 'refs'), true)
  add(join(gitDir, 'packed-refs'))
  watchers.set(repoPath, {
    close: () => {
      if (timer) clearTimeout(timer)
      for (const w of handles) w.close()
    }
  })
}

function unwatchRepo(path: string): void {
  const w = watchers.get(path)
  if (w) {
    w.close()
    watchers.delete(path)
  }
}

function buildMenu(): void {
  const sendMenu = (action: string) => send('menu', action)
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: 'File',
      submenu: [
        { label: 'New Tab', accelerator: 'Ctrl+N', click: () => sendMenu('manager') },
        { type: 'separator' },
        { label: 'Clone Repository…', accelerator: 'Ctrl+Shift+N', click: () => sendMenu('clone') },
        { label: 'Open Repository…', accelerator: 'Ctrl+O', click: () => sendMenu('open') },
        { label: 'Create New Repository…', click: () => sendMenu('init') },
        { type: 'separator' },
        { label: 'Scan Folders for Repositories…', click: () => sendMenu('scan') },
        { type: 'separator' },
        { label: 'Preferences…', accelerator: 'Ctrl+,', click: () => sendMenu('settings') },
        { type: 'separator' },
        { role: 'quit', label: 'Exit' }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' }
      ]
    },
    {
      label: 'View',
      submenu: [
        { label: 'Quick Launch', accelerator: 'Ctrl+P', click: () => sendMenu('quick') },
        { label: 'Command Palette', accelerator: 'Ctrl+K', click: () => sendMenu('quick') },
        { label: 'Home', accelerator: 'Ctrl+H', click: () => sendMenu('home') },
        { label: 'Changes', accelerator: 'Ctrl+1', click: () => sendMenu('changes') },
        { label: 'History', accelerator: 'Ctrl+2', click: () => sendMenu('commits') },
        { type: 'separator' },
        { label: 'Toggle Theme', click: () => sendMenu('theme') },
        { type: 'separator' },
        { role: 'reload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' }
      ]
    },
    {
      label: 'Repository',
      submenu: [
        { label: 'Fetch', accelerator: 'Ctrl+Shift+F', click: () => sendMenu('fetch') },
        { label: 'Pull', accelerator: 'Ctrl+Shift+L', click: () => sendMenu('pull') },
        { label: 'Push', accelerator: 'Ctrl+Shift+P', click: () => sendMenu('push') },
        { type: 'separator' },
        { label: 'Commit', accelerator: 'Ctrl+Enter', click: () => sendMenu('commit') },
        { label: 'Commit & Push', accelerator: 'Ctrl+Shift+Enter', click: () => sendMenu('commit-push') },
        { type: 'separator' },
        {
          label: 'AI',
          submenu: [
            { label: 'Write Message', accelerator: 'Ctrl+Alt+M', click: () => sendMenu('ai-fill') },
            { label: 'Commit', accelerator: 'Ctrl+Alt+Enter', click: () => sendMenu('ai-commit') },
            { label: 'Commit & Push', accelerator: 'Ctrl+Alt+Shift+Enter', click: () => sendMenu('ai-commit-push') },
            { type: 'separator' },
            { label: 'Analyze Changes', accelerator: 'Ctrl+Alt+A', click: () => sendMenu('analyze') }
          ]
        },
        { type: 'separator' },
        { label: 'New Branch…', accelerator: 'Ctrl+Shift+B', click: () => sendMenu('branch') },
        { label: 'Stash', click: () => sendMenu('stash') },
        { type: 'separator' },
        { label: 'Health Check…', accelerator: 'Ctrl+Shift+H', click: () => sendMenu('health') },
        { label: 'Open in Editor', accelerator: 'Ctrl+Shift+E', click: () => sendMenu('open-editor') },
        { label: 'Open in Terminal', accelerator: 'Ctrl+`', click: () => sendMenu('open-terminal') }
      ]
    },
    {
      label: 'Window',
      submenu: [{ role: 'minimize' }, { role: 'close' }]
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'Spoon on GitHub',
          click: () => {
            void shell.openExternal('https://github.com/elgodox/spoon')
          }
        },
        {
          label: 'Report an Issue',
          click: () => {
            void shell.openExternal('https://github.com/elgodox/spoon/issues')
          }
        },
        { type: 'separator' },
        { label: 'Take the Tour', click: () => sendMenu('tour') },
        { label: 'Check for Updates…', click: () => sendMenu('check-updates') },
        { label: 'About Spoon', click: () => sendMenu('about') }
      ]
    }
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

function registerIpc(): void {
  ipcMain.handle('app:settings', () => store.getSettings())
  ipcMain.handle('app:patchSettings', (_e, patch: Partial<Settings>) => {
    const settings = store.patchSettings(patch)
    if (patch.theme !== undefined || patch.glass !== undefined || patch.material !== undefined) syncNativeTheme()
    if (patch.autoFetch !== undefined || patch.fetchIntervalMin !== undefined || patch.autoFetchAll !== undefined) scheduleFetch()
    if (patch.autoUpdate !== undefined) updater.schedule(settings.autoUpdate)
    return settings
  })
  ipcMain.handle('app:recent', () => store.getRecent())
  ipcMain.handle('app:removeRecent', (_e, path: string) => {
    const s = store.getSettings()
    if (s.pinned?.includes(path)) store.patchSettings({ pinned: s.pinned.filter((p) => p !== path) })
    unwatchRepo(path)
    return store.removeRecent(path)
  })
  ipcMain.handle('app:chrome', () => chromeInfo())
  ipcMain.handle('app:version', () => app.getVersion())
  ipcMain.handle('app:openIn', (_e, path: string, target: 'editor' | 'terminal' | 'explorer') => openIn(path, target))
  ipcMain.handle('app:update', () => updater.current())
  ipcMain.handle('app:checkUpdate', () => updater.check())
  ipcMain.handle('app:installUpdate', () => updater.install())
  ipcMain.handle('repo:overview', (_e, paths: string[]) => {
    const run = git.limiter(6)
    return Promise.all(paths.map((p) => run(() => git.overview(p))))
  })
  ipcMain.handle('repo:health', (_e, path: string, deep?: boolean) => git.health(path, !!deep))
  ipcMain.handle('repo:fix', async (_e, path: string, fix: RepoFixId, input?: { name?: string; email?: string }) => {
    if (fix === 'remove-missing') {
      unwatchRepo(path)
      store.removeRecent(path)
      return 'Removed from the list'
    }
    return withActivity('Repair', fix, () => git.applyFix(path, fix, input))
  })
  ipcMain.handle('repo:bulk', (_e, action: BulkAction, paths: string[]) => bulk(action, paths))
  ipcMain.handle('repo:rescan', async () => {
    const roots = store.getSettings().watchedRoots ?? []
    if (!roots.length) return store.getRecent()
    return store.addRepos(await git.scanRepos(roots))
  })
  ipcMain.handle('app:activity', () => activity)
  ipcMain.handle('app:openExternal', (_e, url: string) => shell.openExternal(url))
  ipcMain.handle('app:showItem', (_e, path: string) => shell.showItemInFolder(path))
  ipcMain.handle('app:openPath', (_e, path: string) => shell.openPath(path))
  ipcMain.handle('app:copy', (_e, text: string) => clipboard.writeText(text))
  ipcMain.handle('app:pickDirectory', async () => {
    const r = await dialog.showOpenDialog(mainWindow!, { properties: ['openDirectory', 'createDirectory'] })
    return r.canceled ? null : r.filePaths[0]
  })
  ipcMain.handle('app:pickDirectories', async () => {
    const r = await dialog.showOpenDialog(mainWindow!, {
      title: 'Choose folders to scan for Git repositories',
      properties: ['openDirectory', 'multiSelections']
    })
    return r.canceled ? null : r.filePaths
  })
  ipcMain.handle('app:addRepos', (_e, repos: { path: string; name: string }[]) => store.addRepos(repos))
  ipcMain.handle('git:scan', async (_e, roots: string[]) =>
    git.scanRepos(roots, (info) => send('scan:progress', info))
  )
  ipcMain.handle('app:pickRepo', async () => {
    const r = await dialog.showOpenDialog(mainWindow!, { properties: ['openDirectory'] })
    if (r.canceled) return null
    const path = r.filePaths[0]
    if (!(await git.isRepo(path))) {
      await dialog.showMessageBox(mainWindow!, {
        type: 'warning',
        message: 'That folder is not a Git repository.',
        detail: 'Use Clone or Create new, or pick a folder that contains a .git directory.'
      })
      return null
    }
    const root = await git.repoRoot(path)
    store.touchRepo(root, await git.repoName(root))
    watchRepo(root)
    return root
  })
  ipcMain.handle('app:confirm', async (_e, message: string, detail?: string) => {
    const r = await dialog.showMessageBox(mainWindow!, {
      type: 'question',
      buttons: ['Cancel', 'OK'],
      defaultId: 1,
      cancelId: 0,
      message,
      detail
    })
    return r.response === 1
  })
  ipcMain.handle('app:error', async (_e, message: string) => {
    await dialog.showMessageBox(mainWindow!, { type: 'error', message })
  })
  ipcMain.handle('app:popup', (_e, items: Electron.MenuItemConstructorOptions[]) => {
    const menu = Menu.buildFromTemplate(
      items.map((it) => ({
        ...it,
        click: it.id
          ? () => send('menu:item', it.id)
          : undefined
      }))
    )
    menu.popup({ window: mainWindow ?? undefined })
  })

  ipcMain.handle('git:isRepo', (_e, path: string) => git.isRepo(path))
  ipcMain.handle('git:open', async (_e, path: string) => {
    if (!(await git.isRepo(path))) throw new Error('That folder is not a Git repository.')
    const root = await git.repoRoot(path)
    store.touchRepo(root, await git.repoName(root))
    watchRepo(root)
    return snapshot(root)
  })
  ipcMain.handle('git:close', (_e, path: string) => unwatchRepo(path))
  ipcMain.handle('git:snapshot', (_e, path: string) => snapshot(path))
  ipcMain.handle('git:status', (_e, path: string) => git.getStatus(path))
  ipcMain.handle('git:commits', (_e, path: string, max?: number, extra?: string[]) => git.getCommits(path, max, extra))
  ipcMain.handle('git:branches', (_e, path: string) => git.getBranches(path))
  ipcMain.handle('git:tags', (_e, path: string) => git.getTags(path))
  ipcMain.handle('git:remotes', (_e, path: string) => git.getRemotes(path))
  ipcMain.handle('git:stashes', (_e, path: string) => git.getStashes(path))
  ipcMain.handle('git:submodules', (_e, path: string) => git.getSubmodules(path))
  ipcMain.handle('git:submoduleUpdate', (_e, path: string, subpath?: string) => git.submoduleUpdate(path, subpath))
  ipcMain.handle('git:diff', (_e, path: string, opts: Parameters<typeof git.getDiff>[1]) => git.getDiff(path, opts))
  ipcMain.handle('git:stage', (_e, path: string, files: string[]) => git.stage(path, files))
  ipcMain.handle('git:unstage', (_e, path: string, files: string[]) => git.unstage(path, files))
  ipcMain.handle('git:stageAll', (_e, path: string) => git.stageAll(path))
  ipcMain.handle('git:unstageAll', (_e, path: string) => git.unstageAll(path))
  ipcMain.handle('git:discard', async (_e, path: string, files: string[]) => {
    await git.discard(path, files)
    return true
  })
  ipcMain.handle('git:applyHunk', (_e, path: string, file: string, hunk: Parameters<typeof git.applyHunk>[2], mode: Parameters<typeof git.applyHunk>[3]) =>
    git.applyHunk(path, file, hunk, mode)
  )
  ipcMain.handle('git:commit', async (_e, path: string, opts: CommitOptions) => {
    const out = await withActivity('Commit', 'git commit', () => git.commit(path, opts))
    store.pushRecentMessage(opts.message)
    return out
  })
  ipcMain.handle('git:fetch', (_e, path: string, opts: FetchOptions) =>
    withActivity('Fetch', 'git fetch', () => git.fetchRemote(path, opts))
  )
  ipcMain.handle('git:pull', (_e, path: string, opts: PullOptions) =>
    withActivity('Pull', 'git pull', () => git.pullRemote(path, opts))
  )
  ipcMain.handle('git:push', (_e, path: string, opts: PushOptions) =>
    withActivity('Push', 'git push', () => git.pushRemote(path, opts))
  )
  ipcMain.handle('git:checkout', (_e, path: string, ref: string, create?: boolean) =>
    withActivity('Checkout', `git checkout ${ref}`, () => git.checkout(path, ref, !!create))
  )
  ipcMain.handle('git:createBranch', (_e, path: string, name: string, checkout: boolean, start?: string) =>
    git.createBranch(path, name, checkout, start)
  )
  ipcMain.handle('git:deleteBranch', (_e, path: string, name: string, force: boolean, remote?: string) =>
    git.deleteBranch(path, name, force, remote)
  )
  ipcMain.handle('git:renameBranch', (_e, path: string, from: string, to: string) => git.renameBranch(path, from, to))
  ipcMain.handle('git:merge', (_e, path: string, ref: string, noFf: boolean, squash: boolean) =>
    withActivity('Merge', `git merge ${ref}`, () => git.mergeBranch(path, ref, noFf, squash))
  )
  ipcMain.handle('git:rebase', (_e, path: string, ref: string) =>
    withActivity('Rebase', `git rebase ${ref}`, () => git.rebaseOnto(path, ref))
  )
  ipcMain.handle('git:rebaseContinue', (_e, path: string) => git.rebaseContinue(path))
  ipcMain.handle('git:rebaseAbort', (_e, path: string) => git.rebaseAbort(path))
  ipcMain.handle('git:interactiveRebase', (_e, path: string, onto: string, todos: RebaseTodoItem[]) =>
    interactiveRebase(path, onto, todos)
  )
  ipcMain.handle('git:cherryPick', (_e, path: string, hashes: string[]) =>
    withActivity('Cherry-pick', 'git cherry-pick', () => git.cherryPick(path, hashes))
  )
  ipcMain.handle('git:revert', (_e, path: string, hashes: string[]) =>
    withActivity('Revert', 'git revert', () => git.revertCommits(path, hashes))
  )
  ipcMain.handle('git:reset', (_e, path: string, hash: string, mode: 'soft' | 'mixed' | 'hard') =>
    withActivity('Reset', `git reset --${mode} ${hash.slice(0, 7)}`, () => git.resetTo(path, hash, mode))
  )
  ipcMain.handle('git:createTag', (_e, path: string, name: string, message?: string, hash?: string) =>
    git.createTag(path, name, message, hash)
  )
  ipcMain.handle('git:deleteTag', (_e, path: string, name: string) => git.deleteTag(path, name))
  ipcMain.handle('git:stash', (_e, path: string, message?: string, files?: string[]) => git.stashPush(path, message, files))
  ipcMain.handle('git:stashApply', (_e, path: string, sel: string, pop: boolean) => git.stashApply(path, sel, pop))
  ipcMain.handle('git:stashDrop', (_e, path: string, sel: string) => git.stashDrop(path, sel))
  ipcMain.handle('git:addRemote', (_e, path: string, name: string, url: string) => git.addRemote(path, name, url))
  ipcMain.handle('git:removeRemote', (_e, path: string, name: string) => git.removeRemote(path, name))
  ipcMain.handle('git:setRemoteUrl', (_e, path: string, name: string, url: string) => git.setRemoteUrl(path, name, url))
  ipcMain.handle('git:renameRemote', (_e, path: string, from: string, to: string) => git.renameRemote(path, from, to))
  ipcMain.handle('git:blame', (_e, path: string, file: string, rev?: string) => git.blame(path, file, rev))
  ipcMain.handle('git:history', (_e, path: string, file: string) => git.fileHistory(path, file))
  ipcMain.handle('git:tree', (_e, path: string, rev?: string) => git.fileTree(path, rev))
  ipcMain.handle('git:showFile', async (_e, path: string, rev: string, file: string) => {
    const buf = await git.showFile(path, rev, file)
    return buf.toString('utf8')
  })
  ipcMain.handle('git:preview', (_e, path: string, file: string, opts?: { rev?: string; origPath?: string }) =>
    git.previewMedia(path, file, opts)
  )
  ipcMain.handle('git:openFile', async (_e, path: string, file: string) => {
    const abs = git.worktreeFile(path, file)
    if (!existsSync(abs)) return shell.showItemInFolder(path)
    const err = await shell.openPath(abs)
    if (err) throw new Error(err)
  })
  ipcMain.handle('git:reflog', (_e, path: string) => git.reflog(path))
  ipcMain.handle('git:readConflict', (_e, path: string, file: string) => git.readConflict(path, file))
  ipcMain.handle('git:writeResolved', (_e, path: string, file: string, content: string) => git.writeResolved(path, file, content))
  ipcMain.handle('git:abortMerge', (_e, path: string) => git.abortMerge(path))
  ipcMain.handle('git:continueMerge', (_e, path: string) => git.continueMerge(path))
  ipcMain.handle('git:identity', (_e, path: string) => git.identity(path))
  ipcMain.handle('git:stagedPatch', (_e, path: string) => git.getStagedPatch(path))
  ipcMain.handle('git:workingPatch', (_e, path: string) => git.getWorkingPatch(path))
  ipcMain.handle('git:clone', async (_e, opts) => {
    const dest = await withActivity('Clone', `git clone ${opts.url}`, () =>
      git.cloneRepo(opts, (line) => {
        send('clone:progress', line)
      })
    )
    store.touchRepo(dest, await git.repoName(dest))
    watchRepo(dest)
    return dest
  })
  ipcMain.handle('git:init', async (_e, directory: string, initial: boolean) => {
    const dest = await git.initRepo(directory, initial)
    store.touchRepo(dest, await git.repoName(dest))
    watchRepo(dest)
    return dest
  })
  ipcMain.handle('git:lfs', (_e, path: string) => git.lfsFiles(path))
  ipcMain.handle('git:worktrees', (_e, path: string) => git.worktrees(path))

  ipcMain.handle('ai:accounts', () => oauth.accounts())
  ipcMain.handle('ai:local', () => oauth.detectLocalSessions())
  ipcMain.handle('ai:import', (_e, provider: AiProviderId) => {
    oauth.importLocal(provider)
    return oauth.accounts()
  })
  ipcMain.handle('ai:apiKey', (_e, provider: AiProviderId, key: string) => {
    oauth.saveApiKey(provider, key)
    return oauth.accounts()
  })
  ipcMain.handle('ai:disconnect', (_e, provider: AiProviderId) => {
    oauth.disconnect(provider)
    oauth.applyFreeFallback()
    return oauth.accounts()
  })
  ipcMain.handle('ai:console', (_e, provider: AiProviderId) => oauth.openProviderConsole(provider))
  ipcMain.handle('ai:grokPkce', () => oauth.startGrokPkce(mainWindow ?? undefined))
  ipcMain.handle('ai:grokDevice', () => oauth.startGrokDevice())
  ipcMain.handle('ai:grokPoll', (_e, flow) => oauth.pollGrokDevice(flow))
  ipcMain.handle('ai:generate', async (_e, provider: AiProviderId, diff: string, extra?: string, model?: string) =>
    generateCommitMessage(provider, diff, extra, model)
  )
  ipcMain.handle('ai:analyze', (_e, repo: string, provider: AiProviderId, model?: string) =>
    analyzeRepository(provider, repo, model)
  )
  ipcMain.handle('ai:models', (_e, provider: AiProviderId, force?: boolean) => listProviderModels(provider, !!force))
  ipcMain.handle('ai:addEndpoint', (_e, endpoint: AiEndpointConfig, apiKey?: string) => oauth.addEndpoint(endpoint, apiKey))
  ipcMain.handle('ai:removeEndpoint', (_e, id: string) => oauth.removeEndpoint(id))
}

async function snapshot(path: string) {
  const existing = snapInflight.get(path)
  if (existing) return existing
  const run = (async () => {
    const [status, commits, branches, tags, remotes, stashes, submodules, identity] = await Promise.all([
      git.getStatus(path),
      git.getCommits(path, 250, ['--all']),
      git.getBranches(path),
      git.getTags(path),
      git.getRemotes(path),
      git.getStashes(path),
      git.getSubmodules(path),
      git.identity(path)
    ])
    return { status, commits, branches, tags, remotes, stashes, submodules, identity }
  })().finally(() => snapInflight.delete(path))
  snapInflight.set(path, run)
  return run
}

async function interactiveRebase(cwd: string, onto: string, todos: RebaseTodoItem[]): Promise<void> {
  const dir = join(app.getPath('temp'), 'spoon-rebase')
  mkdirSync(dir, { recursive: true })
  const editor = join(dir, 'editor.js')
  const todoText = todos
    .filter((t) => t.action !== 'drop')
    .map((t) => `${t.action} ${t.hash} ${t.subject}`)
    .join('\n')
  writeFileSync(join(dir, 'todo.txt'), todoText, 'utf8')
  writeFileSync(
    editor,
    `const fs=require('fs');const p=process.argv[process.argv.length-1];const t=fs.readFileSync(${JSON.stringify(join(dir, 'todo.txt'))},'utf8');fs.writeFileSync(p,t);`,
    'utf8'
  )
  await withActivity('Interactive rebase', `git rebase -i ${onto}`, () =>
    git.git(cwd, ['rebase', '-i', onto], {
      env: {
        GIT_SEQUENCE_EDITOR: `node "${editor.replace(/\\/g, '/')}"`,
        GIT_EDITOR: 'true'
      }
    })
  )
}

process.on('uncaughtException', (err) => {
  console.error(err)
  dialog.showErrorBox('Spoon crashed', err.stack || err.message)
})

app.whenReady().then(async () => {
  app.setName('Spoon')
  syncNativeTheme()
  nativeTheme.on('updated', () => {
    paintWindowChrome()
    send('theme:native', nativeTheme.shouldUseDarkColors)
  })
  registerIpc()
  buildMenu()
  createWindow()
  const gitReady = git.findGit().catch(async (e) => {
    await dialog.showMessageBox(mainWindow!, { type: 'error', message: e instanceof Error ? e.message : String(e) })
  })
  for (const provider of ['grok', 'chatgpt', 'claude'] as const) {
    if (!store.loadCreds(provider)) {
      try {
        oauth.importLocal(provider)
      } catch {
        /* no local session */
      }
    }
  }
  oauth.applyFreeFallback()

  const firstArg = app.isPackaged ? 1 : 2
  const openArg = process.argv.find((a, i) => i >= firstArg && !a.startsWith('-') && existsSync(a))
  if (openArg) {
    void gitReady.then(() => git.isRepo(openArg)).then((ok) => {
      if (ok) mainWindow?.webContents.once('did-finish-load', () => send('open-path', openArg))
    })
  }

  scheduleFetch()
  updater.initUpdater((s) => send('update', s), store.getSettings().autoUpdate !== false)

  app.on('second-instance', (_e, argv) => {
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
    const target = argv.slice(1).find((a) => !a.startsWith('-') && existsSync(a))
    if (target) void git.isRepo(target).then((ok) => ok && send('open-path', target))
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  for (const w of watchers.values()) void w.close()
  if (process.platform !== 'darwin') app.quit()
})
