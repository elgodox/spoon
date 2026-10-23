// History view: commit list, search, details tabs, file tree, layouts, commit menu actions,
// tags, reflog and interactive rebase.
import { after, afterEach, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { commitAll, dialogBox, git, launch, sandbox, subjects, view, writeFile } from './harness.mjs'

let box, ui, page, repo
const hashOf = (ref) => git(repo, ['rev-parse', ref]).trim()
const commitRow = (subject) => page.locator('.commit-row').filter({ hasText: subject }).first()

before(async () => {
  box = sandbox()
  repo = box.repo('history', { 'README.md': '# history\n', 'src/core.ts': 'export const core = 1\n' })
  for (let i = 1; i <= 24; i++) {
    writeFile(repo, `notes/n${i}.txt`, `note ${i}\n`)
    commitAll(repo, `chore: note ${i}`)
  }
  git(repo, ['checkout', '-q', '-b', 'feature'])
  writeFile(repo, 'feature.txt', 'feature\n')
  commitAll(repo, 'feat: feature work')
  git(repo, ['checkout', '-q', 'main'])
  ui = await launch(box, { open: [repo] })
  page = ui.page
  await view(page, 'History')
  await page.locator('.commit-list').waitFor()
})
afterEach(async (t) => {
  await ui?.recover(t)
})
after(async () => {
  await ui?.close()
  box?.cleanup()
})

test('lists commits from every branch with refs and the graph', async () => {
  await commitRow('chore: note 24').waitFor()
  await commitRow('feat: feature work').waitFor()
  await commitRow('Initial commit').waitFor({ state: 'attached' }).catch(() => undefined)
  const head = commitRow('chore: note 24')
  await head.locator('.ref-pill').first().waitFor()
  assert.ok((await page.locator('svg.commit-graph').count()) > 0)
})

test('search filters by message and by hash', async () => {
  const search = page.getByLabel('Search commits by message, author or hash')
  await search.fill('note 7')
  await commitRow('chore: note 7').waitFor()
  await page.waitForTimeout(300)
  assert.equal(await page.locator('.commit-row').count(), 1)
  await search.fill(hashOf('HEAD~3').slice(0, 8))
  await commitRow('chore: note 21').waitFor()
  await search.fill('zzz-no-match')
  await page.getByText('No commits to show').waitFor()
  await search.fill('')
  await commitRow('chore: note 24').waitFor()
})

test('commit details: Commit, Changes and File Tree tabs, copy SHA', async () => {
  await commitRow('chore: note 24').click()
  const details = page.locator('.details')
  await details.waitFor()
  await details.getByText('AUTHOR').waitFor()
  await details.getByText('Spoon Tester').first().waitFor()
  await details.locator('span.hash').first().click()
  await ui.until(async () => (await ui.state()).copies.includes(hashOf('HEAD')), 'SHA copied')
  await details.locator('.detail-tabs').getByRole('button', { name: 'Changes', exact: true }).click()
  await details.getByText('notes/n24.txt').first().waitFor()
  await details.locator('.detail-tabs').getByRole('button', { name: 'File Tree', exact: true }).click()
  await details.locator('.tree').getByText('src').first().waitFor()
  await details.locator('.detail-tabs').getByRole('button', { name: 'Commit', exact: true }).click()
})

test('file tree: double-click opens file history, right-click opens blame', async () => {
  const details = page.locator('.details')
  await details.locator('.detail-tabs').getByRole('button', { name: 'File Tree', exact: true }).click()
  const readme = details.locator('.tree .n').filter({ hasText: 'README.md' }).first()
  await readme.dblclick()
  const history = dialogBox(page, 'History')
  await history.getByText('Initial commit').first().waitFor()
  await history.getByRole('button', { name: 'Close' }).first().click()
  await readme.click({ button: 'right' })
  const blame = dialogBox(page, 'Blame')
  await blame.locator('.blame-row').first().waitFor()
  await blame.getByRole('button', { name: 'Close' }).first().click()
  await details.locator('.detail-tabs').getByRole('button', { name: 'Commit', exact: true }).click()
})

test('history layouts: Bottom, Side and Columns', async () => {
  const layouts = page.getByRole('group', { name: 'History layout' })
  await layouts.getByRole('button', { name: 'Side', exact: true }).click()
  await page.locator('.history-side .details').waitFor()
  await layouts.getByRole('button', { name: 'Columns', exact: true }).click()
  await page.locator('section.history-column h3', { hasText: 'File Tree' }).waitFor()
  await layouts.getByRole('button', { name: 'Bottom', exact: true }).click()
  await page.waitForFunction(() => !document.querySelector('section.history-column'))
})

test('commit menu: Copy SHA', async () => {
  const sha = hashOf('HEAD~1')
  await ui.pickMenu(() => commitRow('chore: note 23').click({ button: 'right' }), `cp:${sha}`)
  await ui.until(async () => (await ui.state()).copies.at(-1) === sha, 'SHA copied from menu')
})

test('commit menu: Create tag tags the commit that was right-clicked', async () => {
  const target = hashOf('HEAD~2')
  await ui.pickMenu(() => commitRow('chore: note 22').click({ button: 'right' }), `tg:${target}`)
  const dialog = dialogBox(page, 'Create Tag')
  await dialog.locator('input').first().fill('v-tagged')
  await dialog.getByRole('button', { name: 'OK', exact: true }).click()
  await ui.until(() => git(repo, ['tag']).includes('v-tagged'), 'tag created')
  assert.equal(git(repo, ['rev-list', '-n', '1', 'v-tagged']).trim(), target)
})

test('commit menu: Cherry-pick and Revert', async () => {
  const feature = hashOf('feature')
  await ui.pickMenu(() => commitRow('feat: feature work').click({ button: 'right' }), `ch:${feature}`)
  await ui.until(() => subjects(repo)[0] === 'feat: feature work' && existsSync(join(repo, 'feature.txt')), 'cherry-picked onto main')
  const picked = hashOf('HEAD')
  await page.waitForTimeout(500)
  await ui.pickMenu(() => page.locator('.commit-row').first().click({ button: 'right' }), `rv:${picked}`)
  await ui.until(() => /^Revert "feat: feature work"/.test(subjects(repo)[0]), 'reverted')
  assert.equal(existsSync(join(repo, 'feature.txt')), false)
})

test('commit menu: Reset mixed asks and keeps changes; Reset hard discards', async () => {
  const before = hashOf('HEAD')
  const target = hashOf('HEAD~4')
  await ui.confirmNext(false)
  await ui.pickMenu(() => page.locator(`.commit-row[aria-label*="${target.slice(0, 7)}"]`).click({ button: 'right' }), `rs:${target}`)
  await page.waitForTimeout(600)
  assert.equal(hashOf('HEAD'), before, 'Cancel keeps HEAD')
  await ui.confirmNext(true)
  await ui.pickMenu(() => page.locator(`.commit-row[aria-label*="${target.slice(0, 7)}"]`).click({ button: 'right' }), `rs:${target}`)
  await ui.until(() => hashOf('HEAD') === target, 'mixed reset')
  assert.ok(git(repo, ['status', '--porcelain']).trim().length > 0, 'changes are kept in the work tree')
  git(repo, ['reset', '-q', '--hard', before])
  await page.locator('.toolbar .tb-btn[data-ico="refresh"]').click()
  await ui.idle()
  await ui.confirmNext(true)
  await ui.pickMenu(() => page.locator(`.commit-row[aria-label*="${target.slice(0, 7)}"]`).click({ button: 'right' }), `rh:${target}`)
  await ui.until(() => hashOf('HEAD') === target, 'hard reset')
  assert.equal(git(repo, ['status', '--porcelain']).trim(), '')
})

test('commit menu: Checkout detaches HEAD; the branch chip says so', async () => {
  const target = hashOf('HEAD~1')
  await ui.pickMenu(() => page.locator(`.commit-row[aria-label*="${target.slice(0, 7)}"]`).click({ button: 'right' }), `co:${target}`)
  await ui.until(() => git(repo, ['rev-parse', '--abbrev-ref', 'HEAD']).trim() === 'HEAD', 'detached')
  await page.locator('.branch-chip .br', { hasText: 'detached HEAD' }).waitFor()
  git(repo, ['checkout', '-q', 'main'])
  await page.locator('.toolbar .tb-btn[data-ico="refresh"]').click()
  await page.locator('.branch-chip .br', { hasText: 'main' }).waitFor()
})

test('Reflog dialog lists HEAD movements', async () => {
  await page.getByRole('button', { name: 'Reflog', exact: true }).click()
  const dialog = dialogBox(page, 'Reflog')
  await dialog.locator('.reflog-row').first().waitFor()
  assert.ok((await dialog.locator('.reflog-row').count()) > 3)
  await dialog.getByRole('button', { name: 'Close' }).first().click()
})

test('Interactive rebase can drop a commit and keeps the order of the others', async () => {
  const before = subjects(repo).slice(0, 4)
  await page.getByRole('button', { name: 'Interactive Rebase', exact: true }).click()
  const dialog = dialogBox(page, 'Interactive rebase')
  await dialog.locator('.rebase-item').first().waitFor()
  const victim = before[1]
  await dialog.locator('.rebase-item').filter({ hasText: victim }).locator('select').selectOption('drop')
  await dialog.getByRole('button', { name: 'Start', exact: true }).click()
  // Wait for the whole rebase: mid-way the victim is already gone but newer commits aren't replayed yet.
  await ui.until(() => !subjects(repo).includes(victim) && subjects(repo)[0] === before[0], 'commit dropped', 30_000)
  assert.deepEqual(subjects(repo).slice(0, 3), [before[0], before[2], before[3]])
})

test('Interactive rebase works in a repository with only a few commits', async () => {
  const small = box.repo('small-history')
  for (const n of [1, 2]) {
    writeFile(small, `f${n}.txt`, `${n}\n`)
    commitAll(small, `small ${n}`)
  }
  const ok = await page.evaluate(async (p) => {
    try {
      const list = await window.spoon.git.commits(p, 20, ['HEAD'])
      const onto = list[list.length - 1]?.parents[0] || '--root'
      await window.spoon.git.interactiveRebase(p, onto, list.map((c) => ({ action: c.subject === 'small 1' ? 'drop' : 'pick', hash: c.hash, subject: c.subject })))
      return 'ok'
    } catch (error) {
      return String(error)
    }
  }, small)
  assert.equal(ok, 'ok')
  assert.deepEqual(subjects(small), ['small 2', 'Initial commit'])
})

test('clicking a local branch in another view scopes history to it', async () => {
  await view(page, 'Changes')
  await page.locator('.sidebar .branch-row').filter({ hasText: 'feature' }).click()
  await page.getByPlaceholder('Commits in feature').waitFor()
  await page.getByRole('button', { name: 'Show all', exact: true }).click()
  await page.getByPlaceholder('Search commits').waitFor()
})

test('no uncaught renderer errors', () => {
  assert.deepEqual(ui.unexpectedPageErrors(), [])
})
