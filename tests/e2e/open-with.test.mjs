// "Open with" from the repository toolbar: the default launcher opens the repo in the editor,
// the right-click menu picks another launcher, and a launcher that cannot start shows an error.
import { after, afterEach, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { copyFileSync, existsSync, linkSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { delimiter, join } from 'node:path'
import { launch, sandbox, toolbar } from './harness.mjs'

let box, ui, page, repo, bin, out
const openButton = () => page.getByTitle('Open with default IDE, agent, or CLI')
const opened = () => (existsSync(out) ? readFileSync(out, 'utf8').trim().split('\n').map((line) => JSON.parse(line)) : [])

/**
 * Fake editors laid out like a real VS Code install: an extensionless `code` bash script that
 * `where code` lists first, and `code.cmd` running "%~dp0<exe>" "%~dp0<cli.js>". The "exe" is
 * node, and cli.js records the arguments it got. `cursor.cmd` points at an editor that is gone.
 */
function fakeEditors(dir) {
  const bin = join(dir, 'fake-bin')
  const out = join(bin, 'opened.jsonl')
  mkdirSync(join(bin, 'resources'), { recursive: true })
  const exe = join(bin, 'FakeEditor.exe')
  try {
    linkSync(process.execPath, exe)
  } catch {
    copyFileSync(process.execPath, exe)
  }
  writeFileSync(join(bin, 'resources', 'cli.js'), `require('fs').appendFileSync(${JSON.stringify(out)}, JSON.stringify(process.argv.slice(2)) + '\\n')`)
  writeFileSync(join(bin, 'code'), '#!/usr/bin/env sh\nexec "$(dirname "$0")/FakeEditor.exe" "$@"\n')
  writeFileSync(join(bin, 'code.cmd'), '@echo off\r\n"%~dp0FakeEditor.exe" "%~dp0resources\\cli.js" %*\r\n')
  writeFileSync(join(bin, 'cursor.cmd'), '@echo off\r\n"%~dp0Uninstalled.exe" "%~dp0resources\\cli.js" %*\r\n')
  // A CLI without an icon of its own, like the native claude.exe.
  copyFileSync(join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'whoami.exe'), join(bin, 'claude.exe'))
  return { bin, out }
}

before(async () => {
  box = sandbox()
  repo = box.repo('open me')
  ;({ bin, out } = fakeEditors(box.dir))
  ui = await launch(box, {
    open: [repo],
    settings: { defaultLauncher: 'code' },
    env: { PATH: `${bin}${delimiter}${process.env.PATH}` }
  })
  page = ui.page
})
afterEach((t) => ui?.recover(t))
after(async () => {
  await ui?.close()
  box?.cleanup()
})

test('the toolbar button opens the repository in the default editor', async () => {
  await openButton().click()
  await ui.until(() => opened().length === 1, 'editor started')
  assert.deepEqual(opened()[0], [repo])
  await ui.expectNoErrors()
})

test('the right-click menu lists detected launchers and opens the picked one', async () => {
  const items = await ui.pickMenu(() => openButton().click({ button: 'right' }), 'open:code')
  const ids = JSON.stringify(items)
  assert.match(ids, /open:code/)
  assert.match(ids, /open:explorer/)
  await ui.until(() => opened().length === 2, 'editor started from the menu')
  assert.deepEqual(opened()[1], [repo])
  await ui.pickMenu(() => openButton().click({ button: 'right' }), 'open:explorer')
  await ui.until(async () => (await ui.state()).openPaths.includes(repo), 'explorer opened the folder')
})

test('the button shows the default launcher: its program icon, else its kind, else the Open icon', async () => {
  const icon = () => openButton().locator('[data-icon]').getAttribute('data-icon')
  const prefs = page.locator('.dialog.prefs')
  const setDefault = async (label) => {
    if (!(await prefs.count())) await toolbar(page, 'settings')
    await prefs.locator('nav.rail').getByRole('button', { name: 'Open with', exact: true }).click()
    const row = prefs.locator('#prefs-panel-open li').filter({ has: page.locator('strong', { hasText: label }) })
    await row.getByRole('button', { name: /Make default|Default/ }).click()
  }
  // VS Code's editor executable has its own icon (here: node.exe's).
  await ui.until(async () => (await icon()) === 'program', 'program icon for VS Code')
  const vscodeIcon = await openButton().locator('img').getAttribute('src')
  assert.match(vscodeIcon, /^data:image\/png;base64,/)
  // claude.exe has no icon of its own: show the CLI icon.
  await setDefault('Claude Code')
  await ui.until(async () => (await icon()) === 'cli', 'CLI icon for Claude Code')
  await setDefault('Explorer')
  // explorer.exe's own icon when Windows hands it out, else the Open icon.
  await ui.until(async () => (await icon()) !== 'cli', 'Explorer icon')
  const explorer = await icon()
  assert.ok(['program', 'default'].includes(explorer), explorer)
  if (explorer === 'program') assert.notEqual(await openButton().locator('img').getAttribute('src'), vscodeIcon)
  await setDefault('VS Code')
  await ui.until(async () => (await icon()) === 'program', 'back to VS Code')
  await prefs.getByRole('button', { name: 'Done', exact: true }).click()
  await prefs.waitFor({ state: 'detached' })
})

test('a launcher that cannot start shows an error instead of doing nothing', async () => {
  await ui.pickMenu(() => openButton().click({ button: 'right' }), 'open:cursor')
  const message = await ui.expectError(/Could not open Cursor/)
  assert.match(message, /Could not open Cursor/)
  // Later launches still work.
  await openButton().click()
  await ui.until(() => opened().length === 3, 'editor started after the failure')
  assert.equal((await ui.state()).errors.length, 0)
})
