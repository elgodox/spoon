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
import { existsSync, mkdirSync, watch as fsWatch, writeFileSync, type FSWatcher } from 'node:fs'
import { join } from 'node:path'
import type { ActivityItem, AiEndpointConfig, AiProviderId, CommitOptions, FetchOptions, PullOptions, PushOptions, RebaseTodoItem, Settings } from '../shared/types'
import * as git from './git'
import * as store from './store'
import * as oauth from './oauth'
import { analyzeRepository, generateCommitMessage } from './ai'
import { listProviderModels } from './model-catalog'

app.commandLine.appendSwitch('disable-gpu-sandbox')

let mainWindow: BrowserWindow | null = null
const watchers = new Map<string, { close: () => void }>()
const snapInflight = new Map<string, Promise<unknown>>()
const activity: { id: string; time: number; title: string; command?: string; output?: string; status: 'running' | 'ok' | 'error' }[] = []

function glassAmount(): number {
  return Math.max(0, Math.min(80, store.getSettings().glass ?? 40))
}

function withAlpha(hex: string, alpha: number): string {
  const a = Math.round(Math.max(0, Math.min(1, alpha)) * 255)
    .toString(16)
    .padStart(2, '0')
  return `${hex}${a}`
}

function windowChrome() {
  const dark = nativeTheme.shouldUseDarkColors
  const glass = glassAmount()
  const bar = dark ? '#2d2d2d' : '#f3f3f3'
  const fill = dark ? '#1e1e1e' : '#ffffff'
  const overlayAlpha = glass > 0 ? 1 - glass / 160 : 1
  return {
    dark,
    glass,
    background: glass > 0 ? withAlpha(fill, 0.18) : fill,
    bar: glass > 0 ? withAlpha(bar, overlayAlpha) : bar,
    symbol: dark ? '#f5f5f5' : '#1a1a1a'
  }
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
      mainWindow.setBackgroundMaterial(colors.glass > 0 ? 'acrylic' : 'none')
    } catch {
      /* Windows 10 or older */
    }
    mainWindow.setTitleBarOverlay({ color: colors.bar, symbolColor: colors.symbol, height: 32 })
  }
}

function createWindow(): void {
  const colors = windowChrome()
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 960,
    minHeight: 600,
    show: true,
    backgroundColor: colors.background,
    backgroundMaterial: process.platform === 'win32' && colors.glass > 0 ? 'acrylic' : undefined,
    autoHideMenuBar: false,
    titleBarStyle: process.platform === 'win32' ? 'hidden' : 'default',
    titleBarOverlay:
      process.platform === 'win32'
        ? { color: colors.bar, symbolColor: colors.symbol, height: 32 }
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

  mainWindow.show()
  mainWindow.focus()
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

function watchRepo(repoPath: string): void {
  if (watchers.has(repoPath)) return
  const gitDir = join(repoPath, '.git')
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
        { label: 'Stash', click: () => sendMenu('stash') }
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
    if (patch.theme !== undefined || patch.glass !== undefined) syncNativeTheme()
    return settings
  })
  ipcMain.handle('app:recent', () => store.getRecent())
  ipcMain.handle('app:removeRecent', (_e, path: string) => store.removeRecent(path))
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
  ipcMain.handle('app:addRepos', (_e, repos: { path: string; name: string }[]) => store.touchRepos(repos))
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
    const ok = await dialog.showMessageBox(mainWindow!, {
      type: 'warning',
      buttons: ['Cancel', 'Discard'],
      defaultId: 1,
      cancelId: 0,
      message: `Discard changes in ${files.length} file(s)?`,
      detail: 'This cannot be undone.'
    })
    if (ok.response !== 1) return false
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
  ipcMain.handle('git:reset', async (_e, path: string, hash: string, mode: 'soft' | 'mixed' | 'hard') => {
    if (mode === 'hard') {
      const ok = await dialog.showMessageBox(mainWindow!, {
        type: 'warning',
        buttons: ['Cancel', 'Reset'],
        message: 'Hard reset will discard local changes.',
        defaultId: 0
      })
      if (ok.response !== 1) return
    }
    await git.resetTo(path, hash, mode)
  })
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
  try {
    await git.findGit()
  } catch (e) {
    await dialog.showMessageBox({ type: 'error', message: e instanceof Error ? e.message : String(e) })
  }
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
  registerIpc()
  buildMenu()
  createWindow()

  const openArg = process.argv.find((a, i) => i > 0 && !a.startsWith('-') && existsSync(a))
  if (openArg) {
    void git.isRepo(openArg).then((ok) => {
      if (ok) mainWindow?.webContents.once('did-finish-load', () => send('open-path', openArg))
    })
  }

  const interval = () => {
    const s = store.getSettings()
    if (!s.autoFetch) return
    send('auto-fetch')
  }
  setInterval(interval, Math.max(1, store.getSettings().fetchIntervalMin) * 60_000)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  for (const w of watchers.values()) void w.close()
  if (process.platform !== 'darwin') app.quit()
})
