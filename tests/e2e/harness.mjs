// End-to-end harness: launches the built Spoon app (out/) with Playwright's Electron driver.
//
// Every launch is isolated: its own userData (spoon.json), HOME/USERPROFILE (so no real AI
// sessions are imported) and global Git config. Native UI is replaced inside the main process:
// - dialog.showMessageBox answers from a queue (default "OK") and records every message
// - dialog.showOpenDialog / showSaveDialog answer from a queue (default: cancel)
// - Menu.popup records the menu; tests pick an item with `pickMenu(id)`
// - shell.* and clipboard record what would have left the app
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { _electron as electron } from 'playwright'

export const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

/**
 * Renderer errors caused by bugs that already have a todo test. They are ignored by the
 * "no uncaught renderer errors" checks so those checks keep catching new problems.
 * Remove an entry once its bug is fixed.
 */
export const KNOWN_PAGE_ERRORS = []

const MAIN_PATCH = String.raw`
const { app, BrowserWindow, Menu, clipboard, dialog, shell } = require('electron')
app.setPath('userData', process.env.SPOON_UI_DATA)
BrowserWindow.prototype.show = function () {}
BrowserWindow.prototype.focus = function () {}
app.on('browser-window-created', (_e, w) => {
  w.webContents.setBackgroundThrottling(false)
  w.setSize(1500, 950)
})
const t = (global.spoonTest = {
  messages: [], errors: [], openDialogs: [], saveDialogs: [], popups: [],
  external: [], reveals: [], openPaths: [], copies: [],
  answers: { message: [], open: [], save: [] }
})
dialog.showMessageBox = async (a, b) => {
  const opts = b || a
  t.messages.push({ type: opts.type, message: opts.message, detail: opts.detail })
  if (opts.type === 'error') t.errors.push(opts.message)
  const queued = t.answers.message.shift()?.value
  return { response: queued ?? (opts.defaultId ?? 0), checkboxChecked: false }
}
dialog.showErrorBox = (title, content) => t.errors.push(title + ': ' + content)
dialog.showOpenDialog = async (a, b) => {
  const opts = b || a
  t.openDialogs.push(opts)
  const queued = t.answers.open.shift()?.value
  return queued ? { canceled: false, filePaths: queued } : { canceled: true, filePaths: [] }
}
dialog.showSaveDialog = async (a, b) => {
  const opts = b || a
  t.saveDialogs.push(opts)
  const queued = t.answers.save.shift()?.value
  return queued ? { canceled: false, filePath: queued } : { canceled: true }
}
const flatten = (items) => items.map((i) => ({ id: i.id, label: i.label, type: i.type, enabled: i.enabled, submenu: i.submenu ? flatten(i.submenu.items) : undefined }))
Menu.prototype.popup = function () { t.popups.push(flatten(this.items)) }
shell.openExternal = async (url) => { t.external.push(url) }
shell.showItemInFolder = (p) => { t.reveals.push(p) }
shell.openPath = async (p) => { t.openPaths.push(p); return '' }
clipboard.writeText = (text) => { t.copies.push(text) }
require(process.env.SPOON_MAIN)
`

export function git(cwd, args, env = {}) {
  return execFileSync('git', args, { cwd, env: { ...process.env, ...env }, windowsHide: true, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] })
}

export function writeFile(repo, file, content) {
  const full = join(repo, file)
  mkdirSync(dirname(full), { recursive: true })
  writeFileSync(full, content)
}

export function commitAll(repo, message) {
  git(repo, ['add', '-A'])
  git(repo, ['commit', '-q', '-m', message])
  return git(repo, ['rev-parse', 'HEAD']).trim()
}

export function subjects(repo, range = 'HEAD') {
  return git(repo, ['log', '--format=%s', range]).trim().split('\n').filter(Boolean)
}

/** Create a sandbox: temp root, fake home and an isolated global Git config. */
export function sandbox(prefix = 'spoon-e2e-') {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  const home = join(dir, 'home')
  const data = join(dir, 'data')
  mkdirSync(home)
  mkdirSync(data)
  const gitconfig = join(dir, 'gitconfig')
  writeFileSync(
    gitconfig,
    '[user]\n\tname = Spoon Tester\n\temail = tester@example.com\n[init]\n\tdefaultBranch = main\n[commit]\n\tgpgsign = false\n[core]\n\tautocrlf = false\n[protocol "file"]\n\tallow = always\n'
  )
  const env = { HOME: home, USERPROFILE: home, GIT_CONFIG_GLOBAL: gitconfig, GIT_CONFIG_NOSYSTEM: '1' }
  Object.assign(process.env, env)
  const box = {
    dir,
    home,
    data,
    gitconfig,
    env,
    /** A repo with one commit. */
    repo(name, files = { 'README.md': `# ${name}\n` }) {
      const repo = join(dir, name)
      mkdirSync(repo, { recursive: true })
      git(repo, ['init', '-q', '-b', 'main'])
      for (const [file, content] of Object.entries(files)) writeFile(repo, file, content)
      commitAll(repo, 'Initial commit')
      return repo
    },
    /** A bare origin plus a clone tracking origin/main, and a second clone to simulate teammates. */
    remotePair(name = 'synced') {
      const seed = box.repo(`${name}-seed`)
      const bare = join(dir, `${name}.git`)
      git(dir, ['clone', '-q', '--bare', seed, bare])
      const clone = join(dir, name)
      const other = join(dir, `${name}-teammate`)
      git(dir, ['clone', '-q', bare, clone])
      git(dir, ['clone', '-q', bare, other])
      return { bare, clone, other }
    },
    cleanup() {
      try {
        rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
      } catch {
        /* Windows may keep a handle on the temp folder for a moment */
      }
    }
  }
  return box
}

/**
 * Launch Spoon.
 * @param box sandbox()
 * @param opts.repos   repositories listed on Home
 * @param opts.open    repositories restored as open tabs (first one active)
 * @param opts.settings extra settings merged over the test defaults
 * @param opts.env     extra environment for the Electron process
 */
export async function launch(box, opts = {}) {
  const repos = opts.repos ?? []
  const open = opts.open ?? []
  const listed = [...new Set([...repos, ...open])]
  const seed = {
    settings: {
      appearanceVersion: 3,
      themePack: 'classic',
      theme: 'dark',
      onboarded: true,
      autoUpdate: false,
      autoFetch: false,
      showAvatars: false,
      ...opts.settings
    },
    recent: listed.map((path, i) => ({ path, name: path.split(/[\\/]/).pop(), lastOpened: Date.now() - i })),
    workspaces: opts.workspaces ?? [],
    session: { tabs: open.map((path) => ({ path, name: path.split(/[\\/]/).pop() })), activePath: open[0] ?? null },
    creds: {}
  }
  writeFileSync(join(box.data, 'spoon.json'), JSON.stringify(seed))
  const patch = join(box.dir, 'launch.cjs')
  writeFileSync(patch, MAIN_PATCH)
  const app = await electron.launch({
    executablePath: join(root, 'node_modules/electron/dist/electron.exe'),
    args: [patch],
    cwd: root,
    env: {
      ...process.env,
      ...box.env,
      ...opts.env,
      SPOON_UI_DATA: box.data,
      SPOON_MAIN: join(root, 'out/main/index.js'),
      ELECTRON_RUN_AS_NODE: undefined,
      ELECTRON_RENDERER_URL: undefined
    }
  })
  const page = await app.firstWindow()
  const pageErrors = []
  page.on('pageerror', (error) => pageErrors.push(error.message))
  await page.route(/gravatar\.com|githubusercontent\.com/, (route) => route.abort())
  page.setDefaultTimeout(15_000)
  await page.waitForSelector('.toolbar')

  // Playwright sometimes fails an evaluate with "Resulting promise was garbage collected".
  // Every main-process call below is idempotent, so retry it a couple of times.
  const evalMain = async (fn, arg) => {
    for (let attempt = 0; ; attempt++) {
      try {
        return await app.evaluate(fn, arg)
      } catch (error) {
        if (attempt >= 2 || !/garbage collected/i.test(String(error))) throw error
        await page.waitForTimeout(100)
      }
    }
  }
  let answerSeq = 0
  const state = () => evalMain(() => global.spoonTest)
  const ui = {
    app,
    page,
    box,
    pageErrors,
    state,
    /** Queue answers for upcoming native dialogs. */
    async answer(kind, value) {
      const id = ++answerSeq
      await evalMain(({}, [kind, value, id]) => {
        const queue = global.spoonTest.answers[kind]
        if (!queue.some((item) => item.id === id)) queue.push({ id, value })
      }, [kind, value, id])
    },
    /** Queue "Cancel" (0) or "OK" (1) for the next app.confirm(). */
    confirmNext: (ok = true) => ui.answer('message', ok ? 1 : 0),
    async errors() {
      return (await state()).errors
    },
    /** Uncaught renderer errors, minus the ones caused by known bugs (KNOWN_PAGE_ERRORS). */
    unexpectedPageErrors() {
      return pageErrors.filter((message) => !KNOWN_PAGE_ERRORS.some((known) => known.pattern.test(message)))
    },
    async expectNoErrors() {
      const errors = await ui.errors()
      if (errors.length || pageErrors.length) throw new Error(`Unexpected errors: ${JSON.stringify({ errors, pageErrors })}`)
    },
    /** Wait for an app error dialog matching `pattern`, then clear the list. */
    async expectError(pattern) {
      const deadline = Date.now() + 10_000
      while (Date.now() < deadline) {
        const errors = await ui.errors()
        const hit = errors.find((e) => pattern.test(e))
        if (hit) {
          await evalMain(() => (global.spoonTest.errors.length = 0))
          return hit
        }
        await page.waitForTimeout(100)
      }
      throw new Error(`Expected an error matching ${pattern}, got ${JSON.stringify(await ui.errors())}`)
    },
    async clearErrors() {
      await evalMain(() => (global.spoonTest.errors.length = 0))
    },
    /** Wait for the next native popup menu and return its items. */
    async nextPopup(previous) {
      const deadline = Date.now() + 10_000
      while (Date.now() < deadline) {
        const popups = (await state()).popups
        if (popups.length > previous) return popups.at(-1)
        await page.waitForTimeout(50)
      }
      throw new Error('No popup menu opened')
    },
    /** Open a native context menu with `open()` and click the item with `id`. */
    async pickMenu(open, id) {
      const before = (await state()).popups.length
      await open()
      const items = await ui.nextPopup(before)
      const flat = (list) => list.flatMap((i) => [i, ...(i.submenu ? flat(i.submenu) : [])])
      const match = flat(items).find((i) => (typeof id === 'string' ? i.id === id : id.test(i.id ?? '')))
      if (!match) throw new Error(`Menu has no item ${id}: ${JSON.stringify(flat(items).map((i) => i.id))}`)
      await evalMain(({ BrowserWindow }, itemId) => BrowserWindow.getAllWindows()[0].webContents.send('menu:item', itemId), match.id)
      return items
    },
    /** Send an application-menu action (the same channel the menu bar and accelerators use). */
    async menu(action) {
      // Playwright occasionally reports "Resulting promise was garbage collected" for a
      // fire-and-forget evaluate; the send is idempotent enough to retry once.
      const send = () => app.evaluate(({ BrowserWindow }, a) => { BrowserWindow.getAllWindows()[0].webContents.send('menu', a); return true }, action)
      try {
        await send()
      } catch {
        await send()
      }
    },
    /** Wait until the app is idle (no `.app.busy`). */
    async idle() {
      await page.waitForFunction(() => !document.querySelector('.app.busy'), null, { timeout: 30_000 })
    },
    /** Poll a Node-side condition (e.g. git state on disk). */
    async until(check, message = 'condition', ms = 15_000) {
      const deadline = Date.now() + ms
      let last
      while (Date.now() < deadline) {
        try {
          last = await check()
          if (last) return last
        } catch (error) {
          last = error
        }
        await page.waitForTimeout(100)
      }
      throw new Error(`Timed out waiting for ${message}${last instanceof Error ? `: ${last.message}` : ''}`)
    },
    /** Save a screenshot to output/e2e/<name>.png (handy when a step fails). */
    async shot(name) {
      const dir = join(root, 'output', 'e2e')
      mkdirSync(dir, { recursive: true })
      // The window is never shown, so capture through webContents instead of page.screenshot().
      const png = await app
        .evaluate(async ({ BrowserWindow }) => {
          const wc = BrowserWindow.getAllWindows()[0].webContents
          return (await wc.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG().toString('base64')
        })
        .catch(() => null)
      if (png) writeFileSync(join(dir, `${name.replace(/[^\w.-]+/g, '-').slice(0, 80)}.png`), Buffer.from(png, 'base64'))
    },
    /**
     * Use as `afterEach((t) => ui.recover(t))`: screenshot a failed step, then close any dialog or
     * menu left open so one failure does not cascade into the next test.
     */
    async recover(t) {
      if (t && !t.passed) await ui.shot(`fail-${t.name}`)
      for (let i = 0; i < 4; i++) {
        if (await page.getByRole('menu').count()) await page.keyboard.press('Escape')
        const back = page.locator('.dialog-back, .tab-menu-back, .tour-dim').first()
        if (!(await back.count())) break
        await page.keyboard.press('Escape')
        if (await back.count()) await back.click({ position: { x: 4, y: 4 }, force: true }).catch(() => undefined)
        await page.waitForTimeout(150)
      }
      await ui.clearErrors()
    },
    async close() {
      await app.close().catch(() => undefined)
    }
  }
  return ui
}

/** Open the sidebar view of the active repository tab. */
export async function view(page, name) {
  await page.locator('.sidebar').getByRole('button', { name: new RegExp(`^${name}`) }).first().click()
}

/** Click a toolbar button by its data-ico. */
export async function toolbar(page, ico) {
  await page.locator(`.toolbar .tb-btn[data-ico="${ico}"]`).click()
}

export function dialogBox(page, title) {
  return page.locator('.dialog').filter({ has: page.locator('.dialog-head h2', { hasText: title }) })
}
