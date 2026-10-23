// Persistent settings, recent repos, workspaces, session and credentials (spoon.json).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { sandboxDir } from '../support/repo.ts'

let n = 0
/** A fresh store module bound to its own userData folder (the module caches spoon.json). */
async function freshStore(seed?: unknown) {
  const dir = sandboxDir('userdata-')
  if (seed !== undefined) writeFileSync(join(dir, 'spoon.json'), typeof seed === 'string' ? seed : JSON.stringify(seed))
  ;(globalThis as { __spoonUserData?: string }).__spoonUserData = dir
  const store = await import(`../../src/main/store.ts?fresh=${++n}`)
  const file = () => JSON.parse(readFileSync(join(dir, 'spoon.json'), 'utf8'))
  return { store, dir, file }
}

test('defaults for a brand-new install', async () => {
  const { store } = await freshStore()
  const s = store.getSettings()
  assert.equal(s.themePack, 'classic')
  assert.equal(s.accentId, 'blue')
  assert.equal(s.iconStyle, 'color')
  assert.equal(s.onboarded, false)
  assert.equal(s.autoFetch, true)
  assert.equal(s.aiProvider, 'grok')
  assert.deepEqual(store.getRecent(), [])
  assert.deepEqual(store.getWorkspaces(), [])
})

test('patchSettings persists to spoon.json', async () => {
  const { store, file } = await freshStore()
  store.patchSettings({ theme: 'light', fetchIntervalMin: 5 })
  assert.equal(store.getSettings().theme, 'light')
  assert.equal(file().settings.fetchIntervalMin, 5)
  store.setTheme('dark')
  assert.equal(file().settings.theme, 'dark')
})

test('legacy settings migrate: any older appearance resets to Classic with color icons, "free" provider is replaced, existing users skip the tour', async () => {
  const { store, file } = await freshStore({
    settings: { appearanceVersion: 2, themePack: 'spacex', accentId: 'red', iconStyle: 'mono', aiProvider: 'free', aiModels: { free: 'x' }, glass: 40 },
    recent: [{ path: 'C:/x', name: 'x', lastOpened: 1 }]
  })
  const s = store.getSettings()
  assert.equal(s.themePack, 'classic')
  assert.equal(s.accentId, 'blue')
  assert.equal(s.iconStyle, 'color')
  assert.equal(s.aiProvider, 'grok')
  assert.equal(s.aiModels.free, undefined)
  assert.equal(s.glass, 0)
  assert.equal(s.onboarded, true)
  assert.equal(file().settings.appearanceVersion, 3)
})

test('users of the retired violet Spoon pack move to Classic with the blue accent', async () => {
  const { store } = await freshStore({ settings: { appearanceVersion: 3, themePack: 'spoon', accentId: 'violet', iconStyle: 'mono', theme: 'dark' } })
  const s = store.getSettings()
  assert.equal(s.themePack, 'classic')
  assert.equal(s.accentId, 'blue')
  assert.equal(s.iconStyle, 'mono')
  assert.equal(s.theme, 'dark')
})

test('customised appearance is kept and invalid values are sanitised', async () => {
  const { store } = await freshStore({ settings: { appearanceVersion: 3, themePack: 'colored', accentId: 'nope', iconStyle: 'weird', theme: 'purple' } })
  const s = store.getSettings()
  assert.equal(s.themePack, 'colored')
  assert.equal(s.accentId, 'blue')
  assert.equal(s.iconStyle, 'mono')
  assert.ok(s.theme === 'light' || s.theme === 'dark')
})

test('a corrupt spoon.json is not silently replaced by defaults', async () => {
  const { store, dir } = await freshStore('{"settings":{"theme":"light"},"recent":[{"path":"C:/keep","name":"keep"')
  store.getSettings()
  store.patchSettings({ theme: 'dark' })
  const files = (await import('node:fs')).readdirSync(dir)
  const kept = files.some((f) => f !== 'spoon.json' && f.startsWith('spoon')) ||
    readFileSync(join(dir, 'spoon.json'), 'utf8').includes('C:/keep')
  assert.ok(kept, 'the unreadable file should be backed up before it is overwritten')
})

test('recent repos: touch moves to the top, addRepos dedupes case-insensitively, removeRecent', async () => {
  const { store } = await freshStore()
  store.touchRepo('C:/a', 'a')
  store.touchRepo('C:/b', 'b')
  store.touchRepo('C:/a', 'a')
  assert.deepEqual(store.getRecent().map((r: { name: string }) => r.name), ['a', 'b'])
  store.addRepos([{ path: 'c:/A', name: 'dup' }, { path: 'C:/c', name: 'c' }])
  assert.deepEqual(store.getRecent().map((r: { name: string }) => r.name), ['a', 'b', 'c'])
  assert.equal(store.getRecent()[2].lastOpened, 0)
  store.touchRepos([{ path: 'C:/c', name: 'c' }, { path: 'C:/d', name: 'd' }])
  assert.deepEqual(store.getRecent().map((r: { name: string }) => r.name).slice(0, 2), ['d', 'c'])
  store.removeRecent('C:/b')
  assert.ok(!store.getRecent().some((r: { name: string }) => r.name === 'b'))
})

test('workspaces: create, rename by id, reuse by name, colours, validation, delete', async () => {
  const { store } = await freshStore()
  assert.throws(() => store.saveWorkspace({ name: '  ', repos: ['C:/a'] }), /Name the workspace/)
  assert.throws(() => store.saveWorkspace({ name: 'X', repos: [' '] }), /needs a repository/)
  const { saved } = store.saveWorkspace({ name: 'Web', repos: ['C:/a', 'c:/A', 'C:/b'] })
  assert.deepEqual(saved.repos, ['C:/a', 'C:/b'])
  assert.match(saved.color, /^#[0-9a-f]{6}$/)
  const renamed = store.saveWorkspace({ id: saved.id, name: 'Web app', color: '#ABCDEF', repos: ['C:/a'] }).saved
  assert.equal(renamed.id, saved.id)
  assert.equal(renamed.color, '#abcdef')
  const sameName = store.saveWorkspace({ name: 'WEB APP', repos: ['C:/z'] }).saved
  assert.equal(sameName.id, saved.id)
  assert.equal(store.getWorkspaces().length, 1)
  const bulk = store.saveWorkspaces([
    { name: 'One', repos: ['C:/1'] },
    { name: '', repos: ['C:/skip'] },
    { name: 'Two', repos: [] }
  ])
  assert.deepEqual(bulk.saved.map((w: { name: string }) => w.name), ['One'])
  assert.throws(() => store.saveWorkspaces([{ name: '', repos: [] }]), /Nothing to save/)
  store.deleteWorkspace(saved.id)
  assert.deepEqual(store.getWorkspaces().map((w: { name: string }) => w.name), ['One'])
})

test('session: sanitised, deduped, capped and missing folders dropped on read', async () => {
  const { store } = await freshStore()
  const real = sandboxDir('tab-')
  mkdirSync(join(real, 'x'), { recursive: true })
  const saved = store.saveSession({
    tabs: [
      { path: real, name: '', color: '#ABCDEF' },
      { path: real.toUpperCase(), name: 'dup' },
      { path: join(real, 'gone-folder'), name: 'gone', color: 'red' },
      { path: '   ', name: 'blank' }
    ],
    activePath: real,
    collapsedGroups: { a: true, b: false }
  })
  assert.equal(saved.tabs.length, 2)
  assert.equal(saved.tabs[0].color, '#abcdef')
  assert.equal(saved.tabs[1].color, undefined)
  assert.deepEqual(saved.collapsedGroups, { a: true })
  const read = store.getSession()
  assert.deepEqual(read.tabs.map((t: { path: string }) => t.path), [real])
})

test('credentials round-trip and clear', async () => {
  const { store, file } = await freshStore()
  store.saveCreds({ provider: 'claude', method: 'api-key', apiKey: 'sk-test' })
  assert.equal(store.loadCreds('claude')?.apiKey, 'sk-test')
  assert.ok(!JSON.stringify(file()).includes('sk-test'), 'keys are not stored as plain text JSON')
  assert.equal(store.allCreds().length, 1)
  store.clearCreds('claude')
  assert.equal(store.loadCreds('claude'), null)
  assert.equal(store.loadCreds('missing'), null)
})

test('recent commit messages are deduped and capped at 30', async () => {
  const { store } = await freshStore()
  for (let i = 0; i < 35; i++) store.pushRecentMessage(`msg ${i}`)
  store.pushRecentMessage('msg 34')
  store.pushRecentMessage('   ')
  const list = store.getSettings().recentMessages
  assert.equal(list.length, 30)
  assert.equal(list[0], 'msg 34')
  assert.equal(list.filter((m: string) => m === 'msg 34').length, 1)
})
