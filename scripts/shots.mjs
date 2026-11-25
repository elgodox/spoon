// Screenshots of the main screens, for a quick visual review: `npm run build && node scripts/shots.mjs`.
// Uses the E2E harness, so it runs in a sandbox and never touches real repos or settings.
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { commitAll, git, launch, root, sandbox, writeFile } from '../tests/e2e/harness.mjs'

const out = join(root, 'output', 'shots')
mkdirSync(out, { recursive: true })
const theme = process.argv[2] === 'light' ? 'light' : 'dark'
const box = sandbox('spoon-shots-')
const { clone } = box.remotePair('spoon-studio')
writeFile(clone, 'src/app.ts', 'export const app = 1\n')
commitAll(clone, 'feat: add the app entry point')
git(clone, ['tag', 'v1.0.0'])
git(clone, ['checkout', '-q', '-b', 'feat/accounts'])
writeFile(clone, 'src/accounts.ts', 'export const accounts = []\n')
commitAll(clone, 'feat: saved Git accounts')
git(clone, ['checkout', '-q', 'main'])
git(clone, ['merge', '-q', '--no-ff', '-m', 'Merge accounts', 'feat/accounts'])
writeFile(clone, 'README.md', '# spoon-studio\n\nYour code. In flow.\n')
writeFile(clone, 'notes.log', 'scratch\n')
const other = box.repo('website')

const ui = await launch(box, { repos: [clone, other], settings: { theme }, env: { SPOON_NO_SYSTEM_CREDS: '1' } })
const { page } = ui
// A hidden window does not always produce a frame in time: nudge it and try again.
const shot = async (name) => {
  for (let attempt = 0; ; attempt++) {
    try {
      return await page.screenshot({ path: join(out, `${theme}-${name}.png`), timeout: 8000 })
    } catch (error) {
      if (attempt >= 4) throw error
      await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 200)))
    }
  }
}
try {
  await page.waitForTimeout(1200)
  await shot('home')
  await page.getByRole('button', { name: 'Clone', exact: true }).first().click()
  await page.locator('.dialog').waitFor()
  await shot('clone')
  await page.keyboard.press('Escape')
  await page.locator('.dialog .dialog-head button').click().catch(() => {})
  await page.locator('.repo-row, .mgr-row, [class*="repo"]').filter({ hasText: 'spoon-studio' }).first().dblclick()
  await page.locator('.tabs .tab.active', { hasText: 'spoon-studio' }).waitFor()
  await page.waitForTimeout(800)
  await shot('history')
  await page.locator('.sidebar .side-item, .side-item').filter({ hasText: 'Changes' }).first().click()
  await page.waitForTimeout(800)
  await shot('changes')
  await page.getByText('README.md', { exact: true }).first().click()
  await page.waitForTimeout(800)
  await shot('changes-diff')
  await ui.menu('settings')
  await page.locator('.dialog.prefs').waitFor()
  await page.locator('.dialog.prefs .rail-item[title="Accounts"]').click()
  await page.evaluate(() => window.spoon.credentials.save({ url: 'https://github.com', username: 'elgodox', password: 'x' }))
  await page.evaluate(() => window.spoon.credentials.save({ url: 'https://gitlab.com', username: 'alan', password: 'x' }))
  await page.locator('.dialog.prefs .rail-item[title="Git"]').click()
  await page.locator('.dialog.prefs .rail-item[title="Accounts"]').click()
  await page.waitForTimeout(500)
  await shot('accounts')
  await page.locator('.dialog.prefs .rail-item[title="Appearance"]').click()
  await page.waitForTimeout(300)
  await shot('appearance')
  console.log('errors', JSON.stringify(await ui.errors()), JSON.stringify(ui.pageErrors))
} finally {
  await ui.app.close().catch(() => {})
  box.cleanup()
}
