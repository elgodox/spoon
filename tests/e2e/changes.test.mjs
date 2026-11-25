// Changes view: staging, hunks, discard, diff modes, previews, file menu, commit and amend.
import { after, afterEach, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { commitAll, dialogBox, git, launch, sandbox, subjects, view, writeFile } from './harness.mjs'

const lines = (n, edit = {}) => Array.from({ length: n }, (_, i) => edit[i + 1] ?? `line ${i + 1}`).join('\n') + '\n'
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
)

let box, ui, page, repo
const unstagedPane = () => page.locator('.file-pane').nth(0)
const stagedPane = () => page.locator('.file-pane').nth(1)
const row = (pane, name) => pane.locator('.file-row').filter({ hasText: name })
const stagedPaths = () => git(repo, ['diff', '--cached', '--name-only']).trim().split('\n').filter(Boolean).sort()

before(async () => {
  box = sandbox()
  repo = box.repo('changes', { 'app.ts': lines(40), 'notes.md': 'notes\n', 'remove-me.txt': 'bye\n', 'logo.png': PNG })
  ui = await launch(box, { open: [repo] })
  page = ui.page
  await view(page, 'Changes')
  await page.locator('.changes-heading').waitFor()
})
afterEach(async (t) => {
  await ui?.recover(t)
})
after(async () => {
  await ui?.close()
  box?.cleanup()
})

async function refresh() {
  await page.locator('.toolbar .tb-btn[data-ico="refresh"]').click()
  await ui.idle()
}

test('lists unstaged, untracked and deleted files', async () => {
  writeFile(repo, 'app.ts', lines(40, { 2: 'TOP CHANGE', 38: 'BOTTOM CHANGE' }))
  writeFile(repo, 'new file.ts', 'export const fresh = true\n')
  unlinkSync(join(repo, 'remove-me.txt'))
  await refresh()
  for (const name of ['app.ts', 'new file.ts', 'remove-me.txt']) await row(unstagedPane(), name).waitFor()
  assert.equal(await row(stagedPane(), 'app.ts').count(), 0)
  await page.locator('.sidebar .side-item', { hasText: 'Changes' }).locator('.counter', { hasText: '3' }).waitFor()
})

test('selecting a file shows its diff in unified and side-by-side modes', async () => {
  await row(unstagedPane(), 'app.ts').click()
  await page.locator('.diff-path', { hasText: 'app.ts' }).waitFor()
  await page.locator('.diff-line.add', { hasText: 'TOP CHANGE' }).waitFor()
  await page.locator('.diff-line.del', { hasText: 'line 2' }).first().waitFor()
  await page.getByRole('button', { name: 'Side by side', exact: true }).click()
  await page.getByRole('button', { name: 'Unified', exact: true }).waitFor()
  await page.getByRole('button', { name: 'Unified', exact: true }).click()
  await page.getByRole('button', { name: 'Side by side', exact: true }).waitFor()
})

test('stage a single hunk, then unstage it', async () => {
  await row(unstagedPane(), 'app.ts').click()
  const firstHunk = page.locator('.diff-view .hunk-actions').first()
  await firstHunk.getByRole('button', { name: 'Stage', exact: true }).click()
  await ui.until(() => git(repo, ['diff', '--cached']).includes('TOP CHANGE'), 'hunk staged')
  assert.ok(!git(repo, ['diff', '--cached']).includes('BOTTOM CHANGE'), 'only the first hunk is staged')
  await row(stagedPane(), 'app.ts').waitFor()
  await row(stagedPane(), 'app.ts').click()
  await page.locator('.diff-view .hunk-actions').first().getByRole('button', { name: 'Unstage', exact: true }).click()
  await ui.until(() => git(repo, ['diff', '--cached']).trim() === '', 'hunk unstaged')
})

test('discard a single hunk asks first and keeps the other one', async () => {
  await row(unstagedPane(), 'app.ts').click()
  await page.locator('.diff-line.add', { hasText: 'BOTTOM CHANGE' }).waitFor()
  await ui.confirmNext(false)
  await page.locator('.diff-view .hunk-actions').nth(1).getByRole('button', { name: 'Discard', exact: true }).click()
  await page.waitForTimeout(500)
  assert.match(readFileSync(join(repo, 'app.ts'), 'utf8'), /BOTTOM CHANGE/, 'Cancel keeps the hunk')
  await ui.confirmNext(true)
  await page.locator('.diff-view .hunk-actions').nth(1).getByRole('button', { name: 'Discard', exact: true }).click()
  await ui.until(() => !readFileSync(join(repo, 'app.ts'), 'utf8').includes('BOTTOM CHANGE'), 'hunk discarded')
  assert.match(readFileSync(join(repo, 'app.ts'), 'utf8'), /TOP CHANGE/)
})

test('stage and unstage files with the pane buttons, multi-select and Ctrl+A', async () => {
  await row(unstagedPane(), 'app.ts').click()
  await row(unstagedPane(), 'new file.ts').click({ modifiers: ['Control'] })
  await unstagedPane().getByRole('button', { name: 'Stage 2', exact: true }).click()
  await ui.until(() => stagedPaths().join() === 'app.ts,new file.ts', 'two files staged')
  await row(stagedPane(), 'app.ts').click()
  await stagedPane().locator('.file-list').press('Control+a')
  await stagedPane().getByRole('button', { name: /^Unstage( 2)?$/ }).click()
  await ui.until(() => stagedPaths().length === 0, 'all unstaged')
  await unstagedPane().locator('.file-row').first().click()
  await unstagedPane().locator('.file-list').press('Control+a')
  await unstagedPane().getByRole('button', { name: /^Stage/ }).click()
  await ui.until(() => stagedPaths().length === 3, 'everything staged')
  await stagedPane().locator('.file-row').first().click()
  await stagedPane().locator('.file-list').press('Control+a')
  await stagedPane().getByRole('button', { name: /^Unstage/ }).click()
  await ui.until(() => stagedPaths().length === 0, 'everything unstaged again')
})

test('file context menu: copy paths and patch, stage, blame and file history', async () => {
  const target = row(unstagedPane(), 'app.ts')
  await target.click()
  await target.click({ button: 'right' })
  const menu = page.getByRole('menu', { name: 'File actions' })
  await menu.waitFor()
  await menu.getByRole('menuitem', { name: 'Copy relative path', exact: true }).click()
  await ui.until(async () => (await ui.state()).copies.at(-1) === 'app.ts', 'relative path copied')
  await target.click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Copy full path', exact: true }).click()
  await ui.until(async () => (await ui.state()).copies.at(-1)?.toLowerCase() === join(repo, 'app.ts').toLowerCase(), 'full path copied')
  await target.click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Copy patch', exact: true }).click()
  await ui.until(async () => /TOP CHANGE/.test((await ui.state()).copies.at(-1) ?? ''), 'patch copied')
  await target.click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Show in Windows Explorer', exact: true }).click()
  await ui.until(async () => (await ui.state()).reveals.length > 0, 'revealed in Explorer')

  await target.click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Blame', exact: true }).click()
  const blame = dialogBox(page, 'Blame')
  await blame.locator('.blame-row').first().waitFor()
  assert.ok((await blame.locator('.blame-row').count()) >= 40)
  await blame.getByRole('button', { name: 'Close' }).first().click()

  await target.click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'File history', exact: true }).click()
  const history = dialogBox(page, 'History')
  await history.getByText('Initial commit').first().waitFor()
  await history.getByRole('button', { name: 'Close' }).first().click()

  await target.click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Stage', exact: true }).click()
  await ui.until(() => stagedPaths().join() === 'app.ts', 'staged from the menu')
  await row(stagedPane(), 'app.ts').click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Unstage', exact: true }).click()
  await ui.until(() => stagedPaths().length === 0, 'unstaged from the menu')
})

test('untracked files cannot blame or copy a patch; Escape closes the menu', async () => {
  await row(unstagedPane(), 'new file.ts').click({ button: 'right' })
  assert.equal(await page.getByRole('menuitem', { name: 'Copy patch', exact: true }).isDisabled(), true)
  assert.equal(await page.getByRole('menuitem', { name: 'Blame', exact: true }).isDisabled(), true)
  await page.keyboard.press('Escape')
  assert.equal(await page.getByRole('menu').count(), 0)
})

test('discard changes from the context menu asks first and respects Cancel', async () => {
  await row(unstagedPane(), 'new file.ts').click({ button: 'right' })
  await ui.confirmNext(false)
  await page.getByRole('menuitem', { name: /^Discard changes/ }).click()
  await page.waitForTimeout(400)
  assert.ok(existsSync(join(repo, 'new file.ts')), 'Cancel keeps the file')
  await row(unstagedPane(), 'new file.ts').click({ button: 'right' })
  await ui.confirmNext(true)
  await page.getByRole('menuitem', { name: /^Discard changes/ }).click()
  await ui.until(() => !existsSync(join(repo, 'new file.ts')), 'untracked file discarded')
  await row(unstagedPane(), 'new file.ts').waitFor({ state: 'detached' })
})

test('image changes show a media preview', async () => {
  const bigger = Buffer.concat([PNG, Buffer.alloc(16)])
  writeFile(repo, 'logo.png', bigger)
  await refresh()
  await row(unstagedPane(), 'logo.png').click()
  const preview = page.locator('.media-preview')
  await preview.waitFor()
  await preview.locator('.kv').nth(1).waitFor()
  const labels = await preview.locator('.kv').allTextContents()
  assert.match(labels[0], /^(HEAD|Before)/)
  assert.match(labels[1], /^Working copy/)
  assert.ok((await preview.locator('img').count()) >= 1)
})

test('file-type chips filter the change lists', async () => {
  await page.locator('.type-chip', { hasText: '.png' }).waitFor()
  await page.locator('.type-chip', { hasText: '.png' }).click()
  await row(unstagedPane(), 'logo.png').waitFor()
  await ui.until(async () => (await unstagedPane().locator('.file-row').count()) === 1, 'only .png files listed')
  await page.locator('.type-chip', { hasText: '.ts' }).click()
  await ui.until(async () => (await unstagedPane().locator('.file-row').count()) === 2, '.png and .ts listed')
  await page.locator('.type-chip', { hasText: 'All' }).click()
  await ui.until(async () => (await unstagedPane().locator('.file-row').count()) === 3, 'all files listed')
  git(repo, ['checkout', '--', 'logo.png'])
  await refresh()
})

test('commit the staged files with the commit box', async () => {
  await row(unstagedPane(), 'app.ts').click()
  await unstagedPane().getByRole('button', { name: /^Stage/ }).click()
  await ui.until(() => stagedPaths().join() === 'app.ts', 'app.ts staged')
  const box = page.getByPlaceholder('Commit message · Ctrl+Enter to commit')
  await box.fill('feat: top change')
  await page.locator('.commit-box').getByRole('button', { name: 'Commit', exact: true }).click()
  await ui.until(() => subjects(repo)[0] === 'feat: top change', 'commit created')
  await ui.until(async () => (await box.inputValue()) === '', 'commit box cleared')
  await ui.expectNoErrors()
})

test('Ctrl+Enter commits and Amend rewrites the last commit', async () => {
  writeFile(repo, 'notes.md', 'notes v2\n')
  await refresh()
  await row(unstagedPane(), 'notes.md').click()
  await unstagedPane().getByRole('button', { name: /^Stage/ }).click()
  await ui.until(() => stagedPaths().join() === 'notes.md', 'notes staged')
  const box = page.getByPlaceholder('Commit message · Ctrl+Enter to commit')
  await box.fill('docs: notes')
  await box.press('Control+Enter')
  await ui.until(() => subjects(repo)[0] === 'docs: notes', 'committed with Ctrl+Enter')

  writeFile(repo, 'notes.md', 'notes v3\n')
  await refresh()
  await row(unstagedPane(), 'notes.md').click()
  await unstagedPane().getByRole('button', { name: /^Stage/ }).click()
  await ui.until(() => stagedPaths().join() === 'notes.md', 'notes staged again')
  await page.locator('.commit-box').getByLabel('Amend').check()
  await box.fill('docs: notes, amended')
  await page.locator('.commit-box').getByRole('button', { name: 'Commit', exact: true }).click()
  await ui.until(() => subjects(repo)[0] === 'docs: notes, amended', 'amended')
  assert.equal(subjects(repo)[1], 'feat: top change')
  assert.equal(git(repo, ['show', 'HEAD:notes.md']), 'notes v3\n')
})

test('committing with nothing staged shows an error and creates nothing', async () => {
  const before = subjects(repo).length
  const box = page.getByPlaceholder('Commit message · Ctrl+Enter to commit')
  await box.fill('nothing here')
  await page.locator('.commit-box').getByRole('button', { name: 'Commit', exact: true }).click()
  await page.waitForTimeout(800)
  assert.equal(subjects(repo).length, before)
  await ui.clearErrors()
  await box.fill('')
})

test('file context menu: Ignore adds untracked files to .gitignore', async () => {
  writeFile(repo, 'debug.log', 'noise\n')
  writeFile(repo, 'cache/data.tmp', 'noise\n')
  await refresh()
  const log = row(unstagedPane(), 'debug.log')
  await log.click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Ignore this file', exact: true }).click()
  await ui.until(() => existsSync(join(repo, '.gitignore')) && readFileSync(join(repo, '.gitignore'), 'utf8').includes('/debug.log'), 'file ignored')
  await log.waitFor({ state: 'detached' })
  const tmp = row(unstagedPane(), 'data.tmp')
  await tmp.click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Ignore all *.tmp files', exact: true }).click()
  await ui.until(() => readFileSync(join(repo, '.gitignore'), 'utf8').includes('*.tmp'), 'extension ignored')
  await tmp.waitFor({ state: 'detached' })
  assert.equal(readFileSync(join(repo, '.gitignore'), 'utf8'), '/debug.log\n*.tmp\n')
  await row(unstagedPane(), '.gitignore').waitFor()
  // Tracked files have nothing to ignore.
  writeFile(repo, 'notes.md', 'changed for the ignore test\n')
  await refresh()
  await row(unstagedPane(), 'notes.md').click({ button: 'right' })
  await page.getByRole('menu', { name: 'File actions' }).waitFor()
  assert.equal(await page.getByRole('menuitem', { name: /^Ignore/ }).count(), 0)
  await page.keyboard.press('Escape')
})

test('no uncaught renderer errors', () => {
  assert.deepEqual(ui.unexpectedPageErrors(), [])
})
