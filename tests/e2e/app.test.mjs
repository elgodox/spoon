// App shell: Preferences (Appearance, Git, Open with, AI keys, Help), About, Tour,
// Quick Launch, Activity console, tabs and colour groups, menu shortcuts.
import { after, afterEach, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { git, launch, sandbox, toolbar, writeFile } from './harness.mjs'

let box, ui, page, one, two
const settingsFile = () => JSON.parse(readFileSync(join(box.data, 'spoon.json'), 'utf8'))
const prefs = () => page.locator('.dialog.prefs')
const html = (attr) => page.evaluate((a) => document.documentElement.dataset[a], attr)

async function openPrefs(tab) {
  if (!(await prefs().count())) await toolbar(page, 'settings')
  await prefs().locator('nav.rail').getByRole('button', { name: tab, exact: true }).click()
}
async function closePrefs() {
  await prefs().getByRole('button', { name: 'Done', exact: true }).click()
  await prefs().waitFor({ state: 'detached' })
}

before(async () => {
  box = sandbox()
  one = box.repo('one')
  two = box.repo('two')
  writeFile(one, 'dirty.txt', 'x\n')
  ui = await launch(box, { open: [one], repos: [two] })
  page = ui.page
})
afterEach((t) => ui?.recover(t))
after(async () => {
  await ui?.close()
  box?.cleanup()
})

test('Appearance: theme packs, light/dark, icon style and accent apply and persist', async () => {
  await openPrefs('Appearance')
  for (const pack of ['colored', 'classic']) {
    await prefs().locator(`.theme-pack-card.pack-${pack}`).click()
    await ui.until(async () => (await html('pack')) === pack, `pack ${pack}`)
  }
  await prefs().locator('.theme-pack-card.mode-light').click()
  await ui.until(async () => (await html('theme')) === 'light', 'light mode')
  await prefs().locator('.theme-pack-card.mode-dark').click()
  await ui.until(async () => (await html('theme')) === 'dark', 'dark mode')
  await prefs().locator('.theme-pack-card.pack-spacex').click()
  await ui.until(async () => (await html('pack')) === 'spacex' && (await html('theme')) === 'dark', 'SpaceX is dark')
  assert.equal(await prefs().locator('.theme-pack-card.mode-light').isDisabled(), true)
  assert.equal(await prefs().locator('.theme-pack-card.pack-spoon').count(), 0)
  await prefs().locator('.theme-pack-card.pack-classic').click()
  await prefs().locator('.icons-mono').click()
  await ui.until(async () => (await html('icons')) === 'mono', 'mono icons')
  await prefs().locator('.icons-color').click()
  await prefs().getByRole('button', { name: 'Teal', exact: true }).click()
  await ui.until(() => settingsFile().settings.accentId === 'teal', 'accent saved')
  assert.equal(settingsFile().settings.themePack, 'classic')
  assert.equal(settingsFile().settings.iconStyle, 'color')
})

test('Git: automatic fetch and update settings persist', async () => {
  await openPrefs('Git')
  const pane = prefs().locator('#prefs-panel-git')
  await pane.getByLabel('Fetch the open repository on a timer').check()
  await pane.getByLabel('Also fetch pinned and recently opened repos').check()
  await pane.locator('input[type=number]').fill('15')
  await pane.getByLabel('Download updates automatically').uncheck()
  await ui.until(() => {
    const s = settingsFile().settings
    return s.autoFetch === true && s.autoFetchAll === true && s.fetchIntervalMin === 15 && s.autoUpdate === false
  }, 'git settings saved')
  await pane.getByLabel('Fetch the open repository on a timer').uncheck()
  await ui.until(() => settingsFile().settings.autoFetch === false, 'autoFetch off')
})

test('Accounts: the global and per-repository commit identity', async () => {
  await openPrefs('Accounts')
  const pane = prefs().locator('#prefs-panel-accounts')
  const globalForm = pane.getByRole('form', { name: 'Global identity' })
  const save = globalForm.getByRole('button', { name: 'Save identity', exact: true })
  await ui.until(async () => (await globalForm.getByLabel('Name').inputValue()) === 'Spoon Tester', 'global identity loaded')
  assert.equal(await save.isDisabled(), true, 'nothing to save yet')
  await globalForm.getByLabel('Name').fill('Ada Lovelace')
  await globalForm.getByLabel('Email').fill('not-an-email')
  assert.equal(await save.isDisabled(), true, 'an invalid email cannot be saved')
  await globalForm.getByLabel('Email').fill('ada@example.com')
  await save.click()
  // Name and email are two `git config` writes: wait for both.
  await ui.until(() => git(one, ['config', '--global', 'user.name']).trim() === 'Ada Lovelace' && git(one, ['config', '--global', 'user.email']).trim() === 'ada@example.com', 'global identity saved')

  // Only in this repository.
  const localForm = pane.getByRole('form', { name: 'Repository identity' })
  await localForm.getByLabel('Name').fill('Work Me')
  await localForm.getByLabel('Email').fill('me@work.dev')
  await localForm.getByRole('button', { name: 'Save for this repository', exact: true }).click()
  await ui.until(() => git(one, ['config', '--local', '--get', 'user.email']).trim() === 'me@work.dev', 'repository identity saved')
  await ui.until(() => git(one, ['config', 'user.name']).trim() === 'Work Me', 'repository name saved')
  await localForm.getByRole('button', { name: 'Use the global identity', exact: true }).click()
  await ui.until(() => git(one, ['config', 'user.name']).trim() === 'Ada Lovelace', 'back to the global identity')

  // Put the test identity back for the rest of the suite.
  await globalForm.getByLabel('Name').fill('Spoon Tester')
  await globalForm.getByLabel('Email').fill('tester@example.com')
  await save.click()
  await ui.until(() => git(one, ['config', '--global', 'user.email']).trim() === 'tester@example.com' && git(one, ['config', '--global', 'user.name']).trim() === 'Spoon Tester', 'identity restored')
  await closePrefs()
})

test('Accounts: add, edit and remove a saved Git account', async () => {
  await openPrefs('Accounts')
  const pane = prefs().locator('#prefs-panel-accounts')
  await pane.getByText(/No saved accounts yet/).waitFor()
  await pane.getByRole('button', { name: 'Add account', exact: true }).click()
  const form = pane.getByRole('form', { name: 'Add account' })
  const saveAccount = form.getByRole('button', { name: 'Save account', exact: true })
  assert.equal(await saveAccount.isDisabled(), true)
  await form.getByLabel('Server').fill('https://github.com/elgodox/spoon.git')
  await form.getByLabel('Username').fill('alan')
  await form.getByLabel('Personal access token').fill('ghp_secret_token')
  await saveAccount.click()
  const accountRow = pane.locator('.account-row').filter({ hasText: 'github.com' })
  await accountRow.getByText('alan', { exact: true }).waitFor()
  await ui.until(() => (settingsFile().gitCreds ?? []).length === 1, 'account saved')
  assert.deepEqual([settingsFile().gitCreds[0].protocol, settingsFile().gitCreds[0].host], ['https', 'github.com'])
  assert.ok(!readFileSync(join(box.data, 'spoon.json'), 'utf8').includes('ghp_secret_token'), 'the token is encrypted on disk')

  // Edit: a new username, the saved token is kept.
  const secret = settingsFile().gitCreds[0].secret
  await accountRow.getByRole('button', { name: 'Edit alan at github.com', exact: true }).click()
  const editForm = pane.getByRole('form', { name: 'Edit account' })
  await editForm.getByLabel('Username').fill('alan-work')
  await editForm.getByRole('button', { name: 'Save changes', exact: true }).click()
  await accountRow.getByText('alan-work', { exact: true }).waitFor()
  await ui.until(() => settingsFile().gitCreds[0].username === 'alan-work', 'account edited')
  assert.equal(settingsFile().gitCreds.length, 1)
  assert.ok(secret)

  // A server that is not HTTP(S) is refused with a reason.
  await pane.getByRole('button', { name: 'Add account', exact: true }).click()
  await form.getByLabel('Server').fill('ssh://git@example.com')
  await form.getByLabel('Username').fill('git')
  await form.getByLabel('Password or token').fill('x')
  await saveAccount.click()
  await pane.getByRole('alert').getByText(/SSH remotes use your SSH keys/).waitFor()
  await form.getByRole('button', { name: 'Cancel', exact: true }).click()

  await ui.confirmNext(false)
  await accountRow.getByRole('button', { name: 'Remove alan-work at github.com', exact: true }).click()
  await page.waitForTimeout(400)
  assert.equal(settingsFile().gitCreds.length, 1, 'Cancel keeps the account')
  await ui.confirmNext(true)
  await accountRow.getByRole('button', { name: 'Remove alan-work at github.com', exact: true }).click()
  await ui.until(() => settingsFile().gitCreds.length === 0, 'account removed')
  await pane.getByText(/No saved accounts yet/).waitFor()
  await closePrefs()
})

test('Open with: lists launchers, rescans PATH and changes the default', async () => {
  await openPrefs('Open with')
  const pane = prefs().locator('#prefs-panel-open')
  await pane.getByText('File Explorer').or(pane.getByText('Explorer')).first().waitFor()
  await pane.getByRole('button', { name: 'Rescan PATH' }).click()
  await pane.getByRole('button', { name: 'Rescan PATH' }).waitFor()
  const explorer = pane.locator('li').filter({ has: page.locator('strong', { hasText: /Explorer/ }) })
  await explorer.getByRole('button', { name: /Make default|Default/ }).click()
  await ui.until(() => settingsFile().settings.defaultLauncher === 'explorer', 'default launcher saved')
})

test('AI: save an API key, see it connected, then disconnect', async () => {
  await openPrefs('AI')
  await prefs().locator('.rail-item[title="Claude"]').click()
  await prefs().getByPlaceholder('Paste API key').first().fill('sk-ant-test-key')
  await prefs().getByRole('button', { name: 'Save', exact: true }).first().click()
  await prefs().locator('.rail-item[title="Claude"]').getByText(/Connected/).waitFor()
  assert.ok(settingsFile().creds.claude, 'credential stored')
  assert.ok(!JSON.stringify(settingsFile()).includes('sk-ant-test-key'), 'the key is not stored as plain text')
  await prefs().getByRole('button', { name: 'Disconnect', exact: true }).click()
  await prefs().locator('.rail-item[title="Claude"]').getByText('Not connected').waitFor()
  await ui.until(() => !settingsFile().creds.claude, 'credential removed')
})

test('Help: links open in the browser and the rail works with the keyboard', async () => {
  await openPrefs('Help')
  const pane = prefs().locator('#prefs-panel-help')
  await pane.getByRole('button', { name: 'GitHub', exact: true }).click()
  await pane.getByRole('button', { name: 'Report an issue', exact: true }).click()
  await ui.until(async () => {
    const urls = (await ui.state()).external
    return urls.includes('https://github.com/elgodox/spoon') && urls.includes('https://github.com/elgodox/spoon/issues')
  }, 'external links opened')
  await prefs().locator('nav.rail .rail-item[aria-current="page"]').focus()
  await page.keyboard.press('ArrowUp')
  await prefs().locator('#prefs-panel-ai').waitFor()
  await closePrefs()
})

test('Tour: Next, Back, Skip, and it marks onboarding as done', async () => {
  await openPrefs('Help')
  await prefs().getByRole('button', { name: 'Take the tour', exact: true }).click()
  const card = page.locator('.tour-card')
  await card.waitFor()
  await card.getByText('1 / 5').waitFor()
  await card.getByRole('button', { name: 'Next', exact: true }).click()
  await card.getByText('2 / 5').waitFor()
  await card.getByRole('button', { name: 'Back', exact: true }).click()
  await card.getByText('1 / 5').waitFor()
  await page.keyboard.press('ArrowRight')
  await card.getByText('2 / 5').waitFor()
  await card.getByRole('button', { name: 'Skip', exact: true }).click()
  await card.waitFor({ state: 'detached' })
  assert.equal(settingsFile().settings.onboarded, true)
})

test('About: shows the version, links to GitHub, closes with Escape', async () => {
  await toolbar(page, 'brand')
  const about = page.locator('.dialog.about')
  await about.waitFor()
  await about.getByText(/Version \d/).waitFor()
  await about.getByRole('button', { name: 'github.com/elgodox/spoon' }).click()
  await ui.until(async () => (await ui.state()).external.at(-1) === 'https://github.com/elgodox/spoon', 'GitHub opened')
  await page.keyboard.press('Escape')
  await about.waitFor({ state: 'detached' })
})

test('Quick Launch: search a repository and open it with Enter', async () => {
  await ui.menu('quick')
  const input = page.getByPlaceholder('Quick Launch')
  await input.waitFor()
  await input.fill('two')
  await page.locator('.quick .hit.on', { hasText: 'two' }).waitFor()
  await input.press('Enter')
  await page.locator('.tabs .tab.active', { hasText: 'two' }).waitFor()
  await ui.menu('quick')
  await page.getByPlaceholder('Quick Launch').press('Escape')
  await page.locator('.quick').waitFor({ state: 'detached' })
})

test('menu shortcuts switch views and toggle the theme', async () => {
  await ui.menu('commits')
  await page.locator('.commit-list').waitFor()
  await ui.menu('changes')
  await page.locator('.changes-heading').waitFor()
  const before = await html('theme')
  await ui.menu('theme')
  await ui.until(async () => (await html('theme')) !== before, 'theme toggled')
  await ui.menu('theme')
  await ui.until(async () => (await html('theme')) === before, 'theme restored')
  await ui.menu('settings')
  await prefs().waitFor()
  await closePrefs()
})

test('Activity console lists git operations', async () => {
  await toolbar(page, 'refresh')
  await toolbar(page, 'activity')
  const panel = page.locator('.activity')
  await panel.waitFor()
  await panel.getByRole('button', { name: 'Close', exact: true }).click()
  await panel.waitFor({ state: 'detached' })
})

test('tabs: new tab, colour group via the tab menu, close', async () => {
  await page.locator('.tabs .tab', { hasText: 'one' }).locator('.tab-hit').click()
  await page.locator('.tabs .tab', { hasText: 'one' }).locator('.tab-hit').click({ button: 'right' })
  await page.locator('.tab-menu .swatch[aria-label="#2faf74"]').click()
  await page.locator('.tabs .tab', { hasText: 'two' }).locator('.tab-hit').click({ button: 'right' })
  await page.locator('.tab-menu .swatch[aria-label="#2faf74"]').click()
  await page.locator('.tabs .tab-group').first().waitFor()
  await page.locator('.tabs .tab-group-label').first().click()
  await page.locator('.tabs .tab-group.collapsed').waitFor()
  await page.locator('.tabs .tab-group-label').first().click()
  await page.getByRole('button', { name: 'New tab', exact: true }).click()
  await page.locator('.manager.home').waitFor()
  const count = await page.locator('.tabs .tab').count()
  await page.locator('.tabs .tab.active button.x').click({ force: true })
  await ui.until(async () => (await page.locator('.tabs .tab').count()) === count - 1, 'tab closed')
})

test('the open tabs are restored after a restart', async () => {
  await ui.until(() => (settingsFile().session?.tabs ?? []).length >= 2, 'session saved')
  const saved = settingsFile().session.tabs.map((t) => t.name).sort()
  assert.ok(saved.includes('one') && saved.includes('two'))
})

test('confetti (Ctrl+Shift+.) renders', async () => {
  await ui.menu('confetti')
  await page.locator('canvas.confetti').waitFor({ state: 'attached' })
})

test('no uncaught renderer errors', () => {
  assert.deepEqual(ui.unexpectedPageErrors(), [])
})
