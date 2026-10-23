// Home (repository manager): list, filter, sort, status chips, selection, workspaces,
// bulk sync, scan/add/new/clone, health check and fixes, tabs.
import { after, afterEach, before, beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { commitAll, dialogBox, git, launch, sandbox, toolbar, writeFile } from './harness.mjs'

let box, ui, page
let alpha, beta, dirty, synced, bare, teammate
const repoRow = (name) => page.locator('.home-side .repo-row').filter({ hasText: name }).first()
const settingsFile = () => JSON.parse(readFileSync(join(box.data, 'spoon.json'), 'utf8'))

before(async () => {
  box = sandbox()
  alpha = box.repo('alpha')
  beta = box.repo('beta')
  dirty = box.repo('dirty')
  writeFile(dirty, 'README.md', 'uncommitted\n')
  ;({ clone: synced, bare, other: teammate } = box.remotePair('synced'))
  ui = await launch(box, { repos: [alpha, beta, dirty, synced] })
  page = ui.page
  await page.locator('.manager.home').waitFor()
})
beforeEach(async () => {
  if (!ui) return
  if (!(await page.locator('.manager.home').count())) await toolbar(page, 'home')
  await page.locator('.manager.home').waitFor()
})
afterEach((t) => ui?.recover(t))
after(async () => {
  await ui?.close()
  box?.cleanup()
})

test('Home lists every repository with status metrics', async () => {
  for (const name of ['alpha', 'beta', 'dirty', 'synced']) await repoRow(name).waitFor()
  await repoRow('dirty').locator('.metric').first().waitFor()
  await page.locator('h1', { hasText: 'Home' }).waitFor()
})

test('filter box narrows the list and can be cleared', async () => {
  const filter = page.getByPlaceholder('Filter repositories')
  await filter.fill('alp')
  await repoRow('alpha').waitFor()
  assert.equal(await page.locator('.home-side .repo-row').count(), 1)
  await page.getByRole('button', { name: 'Clear filter' }).click()
  assert.equal(await filter.inputValue(), '')
  await repoRow('beta').waitFor()
})

test('sort menu changes the order and persists', async () => {
  await page.getByRole('button', { name: 'Sort repositories' }).click()
  await page.getByRole('option', { name: 'Name' }).click()
  const names = await page.locator('.home-side .repo-row').evaluateAll((rows) => rows.map((r) => r.getAttribute('title')?.split(/[\\/]/).pop()))
  assert.deepEqual(names, [...names].sort((a, b) => a.localeCompare(b)))
  await ui.until(() => settingsFile().settings.repoSort === 'name', 'repoSort saved')
  await page.getByRole('button', { name: 'Sort repositories' }).click()
  await page.getByRole('option', { name: 'With changes' }).click()
  await page.waitForFunction(() => document.querySelector('.home-side .repo-row')?.textContent?.includes('dirty'))
  await page.getByRole('button', { name: 'Sort repositories' }).click()
  await page.getByRole('option', { name: 'Last opened' }).click()
})

test('status chips filter repositories', async () => {
  const chips = page.getByRole('group', { name: 'Filter repositories by status' }).or(page.locator('[aria-label="Filter repositories by status"]'))
  await chips.locator('button.stat-pill', { hasText: 'Uncommitted' }).click()
  await repoRow('dirty').waitFor()
  assert.equal(await page.locator('.home-side .repo-row').count(), 1)
  await chips.locator('button.stat-pill', { hasText: 'Repositories' }).click()
  await repoRow('alpha').waitFor()
})

test('selection: click, Ctrl+click, Select all and Clear', async () => {
  await repoRow('alpha').click()
  await repoRow('beta').click({ modifiers: ['Control'] })
  await page.locator('section[aria-label="Selected repositories"] h2', { hasText: '2 repositories selected' }).waitFor()
  await page.getByRole('button', { name: /^Clear \(2\)/ }).click()
  await page.getByRole('button', { name: 'Select all', exact: true }).click()
  await page.locator('section[aria-label="Selected repositories"] h2', { hasText: '4 repositories selected' }).waitFor()
  await page.getByRole('button', { name: /^Clear \(4\)/ }).click()
})

test('pin and unpin selected repositories', async () => {
  await repoRow('alpha').click()
  await repoRow('beta').click({ modifiers: ['Control'] })
  await page.getByRole('button', { name: 'Pin selected', exact: true }).click()
  await ui.until(() => settingsFile().settings.pinned?.length === 2, 'pinned saved')
  await page.getByRole('button', { name: 'Unpin selected', exact: true }).click()
  await ui.until(() => (settingsFile().settings.pinned ?? []).length === 0, 'unpinned')
})

test('save a selection as a workspace, edit it and delete it', async () => {
  await repoRow('alpha').click()
  await repoRow('beta').click({ modifiers: ['Control'] })
  await page.getByRole('button', { name: 'Save the selection as a workspace', exact: true }).click()
  await ui.until(() => settingsFile().workspaces?.length === 1, 'workspace saved')
  const ws = settingsFile().workspaces[0]
  assert.deepEqual(ws.repos.map((p) => p.split(/[\\/]/).pop()).sort(), ['alpha', 'beta'])
  // Saving also opens the repos as tabs; go back Home.
  await toolbar(page, 'home')
  const wsRow = page.locator('.workspace-row').filter({ hasText: ws.name })
  await wsRow.hover()
  await page.getByRole('button', { name: `Edit ${ws.name}`, exact: true }).click()
  await page.getByLabel('Workspace name').fill('Renamed WS')
  await page.locator('.swatches[aria-label="Workspace color"] button.swatch').nth(3).click()
  await page.getByRole('button', { name: 'Save workspace', exact: true }).click()
  await ui.until(() => settingsFile().workspaces[0].name === 'Renamed WS', 'renamed')
  await ui.confirmNext(true)
  await page.locator('.workspace-row').filter({ hasText: 'Renamed WS' }).hover()
  await page.getByRole('button', { name: 'Delete Renamed WS', exact: true }).click()
  await ui.until(() => settingsFile().workspaces.length === 0, 'workspace deleted')
})

test('sidebar sections fold, persist, and show a status digest while folded', async () => {
  const toggle = page.getByRole('button', { name: /^Repositories \d+$/ })
  await toggle.click()
  await ui.until(() => settingsFile().settings.homeCollapsed?.includes('repos'), 'fold saved')
  assert.equal(await toggle.getAttribute('aria-expanded'), 'false')
  await page.locator('section[aria-label="Repository list"] .sec-pulse .metric.warn').waitFor()
  // A filter shows matches even inside a folded section.
  await page.getByPlaceholder('Filter repositories').fill('alp')
  assert.equal(await toggle.getAttribute('aria-expanded'), 'true')
  await page.getByRole('button', { name: 'Clear filter' }).click()
  await toggle.click()
  await ui.until(() => !settingsFile().settings.homeCollapsed?.includes('repos'), 'unfold saved')
})

test('arrow keys move the selection and Shift+arrow extends it', async () => {
  await page.getByRole('button', { name: 'Sort repositories' }).click()
  await page.getByRole('option', { name: 'Name' }).click()
  await repoRow('alpha').click()
  await page.keyboard.press('ArrowDown')
  await page.locator('.home-side .repo-row.active', { hasText: 'beta' }).waitFor()
  await page.keyboard.press('Shift+ArrowDown')
  await page.locator('section[aria-label="Selected repositories"] h2', { hasText: '2 repositories selected' }).waitFor()
  await page.getByRole('button', { name: /^Clear \(2\)/ }).click()
  await page.getByRole('button', { name: 'Sort repositories' }).click()
  await page.getByRole('option', { name: 'Last opened' }).click()
})

test('workspaces unfold into their repositories, take dropped repos, and drop members', async () => {
  await repoRow('alpha').click()
  await repoRow('beta').click({ modifiers: ['Control'] })
  await page.getByRole('button', { name: 'Save the selection as a workspace', exact: true }).click()
  await ui.until(() => settingsFile().workspaces?.length === 1, 'workspace saved')
  const ws = settingsFile().workspaces[0]
  await toolbar(page, 'home')
  const wsRow = page.locator('.workspace-row').filter({ hasText: ws.name })
  await page.getByRole('button', { name: `Show repositories in ${ws.name}`, exact: true }).click()
  await ui.until(() => settingsFile().settings.homeExpanded?.includes(ws.id), 'unfold saved')
  const members = page.locator(`[aria-label="Repositories in ${ws.name}"] .ws-member`)
  await ui.until(async () => (await members.count()) === 2, 'two members listed')
  await repoRow('dirty').dragTo(wsRow)
  await ui.until(() => settingsFile().workspaces[0].repos.length === 3, 'dropped repo added')
  await ui.pickMenu(() => members.filter({ hasText: 'dirty' }).click({ button: 'right' }), 'remove')
  await ui.until(() => settingsFile().workspaces[0].repos.length === 2, 'member removed')
  await ui.confirmNext(true)
  await wsRow.hover()
  await page.getByRole('button', { name: `Delete ${ws.name}`, exact: true }).click()
  await ui.until(() => settingsFile().workspaces.length === 0, 'workspace deleted')
})

test('sidebar collapses to an icon rail and back, and remembers it', async () => {
  await page.getByRole('button', { name: 'Collapse sidebar', exact: true }).click()
  await page.locator('.home-side.home-rail').waitFor()
  await ui.until(() => settingsFile().settings.homeRail === true, 'rail saved')
  const beta = page.locator('.home-rail .rail-repo[aria-label="beta"]')
  await beta.click()
  await page.locator('.home-rail .rail-repo.active[aria-label="beta"]').waitFor()
  await page.locator('.manager.home > .splitbar.x').dblclick()
  await page.locator('.home-side .repo-row').first().waitFor()
  await ui.until(() => settingsFile().settings.homeRail === false, 'rail closed')
  assert.equal(await page.locator('.home-rail').count(), 0)
  // The rail's search button reopens the sidebar with the filter focused.
  await page.getByRole('button', { name: 'Collapse sidebar', exact: true }).click()
  await page.locator('.home-rail').getByRole('button', { name: 'Filter repositories' }).click()
  await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === 'Filter repositories')
})

test('double-click opens a repository in a tab; closing the last tab returns to Home', async () => {
  await repoRow('alpha').dblclick()
  await page.locator('.tabs .tab.active', { hasText: 'alpha' }).waitFor()
  await page.locator('.sidebar-head', { hasText: 'alpha' }).waitFor()
  while ((await page.locator('.tabs .tab').count()) > 1 || (await page.locator('.tabs .tab', { hasText: 'New Tab' }).count()) === 0) {
    await page.locator('.tabs .tab button.x').first().click({ force: true })
    await page.waitForTimeout(150)
  }
  await page.locator('.manager.home').waitFor()
})

test('bulk Fetch and Pull update repositories that are behind', async () => {
  writeFile(teammate, 'new.txt', 'n\n')
  commitAll(teammate, 'teammate')
  git(teammate, ['push', '-q'])
  const sync = page.locator('.home-sync-btn')
  await sync.filter({ hasText: 'Fetch' }).click()
  await page.locator('.bulk-summary').waitFor()
  await ui.until(() => git(synced, ['rev-list', '--count', 'HEAD..@{u}']).trim() === '1', 'fetched')
  await page.locator('.bulk-summary').getByRole('button', { name: 'Dismiss' }).click()
  await sync.filter({ hasText: 'Pull' }).click()
  await page.locator('.bulk-summary').waitFor()
  await ui.until(() => existsSync(join(synced, 'new.txt')), 'pulled')
  assert.ok(git(dirty, ['status', '--porcelain']).includes('README.md'), 'dirty repo untouched')
  await page.locator('.bulk-summary').getByRole('button', { name: 'Dismiss' }).click()
})

test('bulk Push pushes repositories that are ahead and skips the rest', async () => {
  writeFile(synced, 'mine.txt', 'm\n')
  commitAll(synced, 'local')
  await page.locator('.home-sync-btn').filter({ hasText: 'Refresh' }).click()
  await page.locator('.bulk-summary').getByRole('button', { name: 'Dismiss' }).click().catch(() => undefined)
  await page.locator('.home-sync-btn').filter({ hasText: 'Push' }).click()
  await page.locator('.bulk-summary').waitFor()
  await ui.until(() => git(bare, ['log', '-1', '--format=%s', 'main']).trim() === 'local', 'pushed')
  await page.locator('.bulk-summary', { hasText: /1 done/ }).waitFor()
})

test('Scan folders adds every repository found under the picked folder', async () => {
  const root = join(box.dir, 'scan-root')
  for (const name of ['one', 'nested/two']) {
    mkdirSync(join(root, name), { recursive: true })
    git(join(root, name), ['init', '-q'])
  }
  await ui.answer('open', [root])
  await page.getByRole('button', { name: 'Scan folders' }).first().click()
  await repoRow('one').waitFor()
  await repoRow('two').waitFor()
  await ui.until(() => settingsFile().settings.watchedRoots?.some((r) => r.toLowerCase() === root.toLowerCase()), 'watched root saved')
})

test('Add opens a single repository directly', async () => {
  const solo = box.repo('solo')
  await ui.answer('open', [solo])
  await page.getByRole('button', { name: 'Add', exact: true }).click()
  await page.locator('.tabs .tab.active', { hasText: 'solo' }).waitFor()
  await toolbar(page, 'home')
  await repoRow('solo').waitFor()
})

test('Add on a folder without repositories warns and adds nothing', async () => {
  const empty = join(box.dir, 'empty-folder')
  mkdirSync(empty)
  await ui.answer('open', [empty])
  await page.getByRole('button', { name: 'Add', exact: true }).click()
  await ui.until(async () => (await ui.state()).messages.some((m) => /No Git repositories in that folder/.test(m.message)), 'warning shown')
})

test('New creates a repository with an initial commit and opens it', async () => {
  const target = join(box.dir, 'created-repo')
  await page.getByRole('button', { name: 'New', exact: true }).click()
  const dialog = dialogBox(page, 'Create repository')
  await ui.answer('open', [target])
  await dialog.getByRole('button', { name: 'Browse' }).click()
  await ui.until(async () => (await dialog.locator('input').first().inputValue()) === target, 'directory picked')
  await dialog.getByRole('button', { name: 'Create', exact: true }).click()
  await ui.until(() => existsSync(join(target, '.git')) && existsSync(join(target, 'README.md')), 'repo created')
  await page.locator('.tabs .tab.active', { hasText: 'created-repo' }).waitFor()
  await toolbar(page, 'home')
})

test('Clone clones a repository into the parent folder and opens it', async () => {
  const parent = join(box.dir, 'clones')
  mkdirSync(parent)
  await page.getByRole('button', { name: 'Clone', exact: true }).first().click()
  const dialog = dialogBox(page, 'Clone')
  const inputs = dialog.locator('input')
  await inputs.nth(0).fill(bare)
  await inputs.nth(1).fill(parent)
  await inputs.nth(2).fill('cloned')
  await dialog.getByRole('button', { name: 'Clone', exact: true }).click()
  await ui.until(() => existsSync(join(parent, 'cloned', '.git')), 'cloned')
  await page.locator('.tabs .tab.active', { hasText: 'cloned' }).waitFor()
  await toolbar(page, 'home')
})

test('Clone with a bad URL tells the user what went wrong', async () => {
  await page.getByRole('button', { name: 'Clone', exact: true }).first().click()
  const dialog = dialogBox(page, 'Clone')
  const inputs = dialog.locator('input')
  await inputs.nth(0).fill(join(box.dir, 'no-such-repo.git'))
  await inputs.nth(1).fill(join(box.dir, 'clones'))
  await inputs.nth(2).fill('broken')
  await dialog.getByRole('button', { name: 'Clone', exact: true }).click()
  await ui.until(async () => (await ui.errors()).length > 0 || (await dialog.getByText(/does not exist|not a git repository|fatal/i).count()) > 0, 'clone error shown to the user', 10_000)
})

test('repository row menu: Fetch, Pin and Remove', async () => {
  await ui.pickMenu(() => repoRow('beta').click({ button: 'right' }), 'pin')
  await ui.until(() => (settingsFile().settings.pinned ?? []).some((p) => p.endsWith('beta')), 'pinned via menu')
  await ui.pickMenu(() => repoRow('beta').click({ button: 'right' }), 'unpin')
  await ui.confirmNext(true)
  await ui.pickMenu(() => repoRow('beta').click({ button: 'right' }), 'remove')
  await ui.until(() => !settingsFile().recent.some((r) => r.path === beta), 'removed from the list')
  assert.ok(existsSync(beta), 'the folder stays on disk')
})

test('health dialog: stale index.lock is detected and removed', async () => {
  writeFileSync(join(alpha, '.git', 'index.lock'), '')
  await repoRow('alpha').dblclick()
  await page.locator('.tabs .tab.active', { hasText: 'alpha' }).waitFor()
  await toolbar(page, 'health')
  const dialog = page.locator('.dialog').filter({ hasText: 'Health check' })
  await dialog.getByText('Stale lock file').waitFor()
  await dialog.getByRole('button', { name: 'Delete index.lock' }).click()
  await ui.until(() => !existsSync(join(alpha, '.git', 'index.lock')), 'lock removed')
  await dialog.getByText('Stale lock file').waitFor({ state: 'detached' })
  await dialog.getByRole('button', { name: 'Close', exact: true }).click()
})

test('health dialog: "Set name and email" saves a missing identity from an in-app form', async () => {
  writeFileSync(box.gitconfig, '[init]\n\tdefaultBranch = main\n')
  await repoRow('alpha').dblclick()
  await page.locator('.tabs .tab.active', { hasText: 'alpha' }).waitFor()
  await toolbar(page, 'health')
  const dialog = page.locator('.dialog').filter({ hasText: 'Health check' })
  await dialog.getByText('Commit identity missing').waitFor()
  await dialog.getByRole('button', { name: 'Set name and email' }).click()
  const form = dialog.getByRole('form', { name: 'Commit identity' })
  await form.getByLabel('Name').fill('Form Name')
  await form.getByLabel('Email').fill('form@example.com')
  await form.getByRole('button', { name: 'Save identity' }).click()
  await ui.until(() => /Form Name/.test(readFileSync(box.gitconfig, 'utf8')) && /form@example\.com/.test(readFileSync(box.gitconfig, 'utf8')), 'identity saved')
  await dialog.getByText('Commit identity missing').waitFor({ state: 'detached' })
  await ui.expectNoErrors()
})

test('no uncaught renderer errors', () => {
  assert.deepEqual(ui.unexpectedPageErrors(), [])
})
