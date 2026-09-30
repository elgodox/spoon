const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const cp = require('node:child_process')
const assert = require('node:assert/strict')
let playwright
try { playwright = require('playwright') } catch { playwright = require(path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')) }
const root = path.resolve(__dirname, '..')
async function main() {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'spoon-workspace-ui-'))
  let app
  try {
    const data = path.join(temp, 'data'), repos = [path.join(temp, 'alpha'), path.join(temp, 'beta')]
    await fs.mkdir(data)
    for (const repo of repos) {
      await fs.mkdir(repo)
      const git = (args) => cp.execFileSync('git', args, { cwd: repo, windowsHide: true })
      git(['init', '-b', 'main']); git(['config', 'user.name', 'Test']); git(['config', 'user.email', 'test@example.com'])
      await fs.writeFile(path.join(repo, 'hello.txt'), 'hello\n'); git(['add', '.']); git(['commit', '-m', 'Initial commit'])
    }
    await fs.writeFile(path.join(data, 'spoon.json'), JSON.stringify({ settings: { onboarded: true, appearanceVersion: 2, autoUpdate: false, autoFetch: false }, recent: repos.map((repo) => ({ path: repo, name: path.basename(repo), opened: Date.now() })), workspaces: [{ id: 'test-ws', name: 'Test workspace', color: '#a78bfa', repos }], creds: {} }))
    const harness = path.join(temp, 'launch.cjs')
    await fs.writeFile(harness, `const {app,BrowserWindow}=require('electron');app.setPath('userData',process.env.SPOON_UI_DATA);BrowserWindow.prototype.show=function(){};BrowserWindow.prototype.focus=function(){};app.on('browser-window-created',(_,w)=>{w.webContents.setBackgroundThrottling(false);w.setSize(1600,1000)});require(${JSON.stringify(path.join(root, 'out/main/index.js'))});`)
    app = await playwright._electron.launch({ executablePath: path.join(root, 'node_modules/electron/dist/electron.exe'), args: [harness], cwd: root, env: { ...process.env, SPOON_UI_DATA: data, ELECTRON_RUN_AS_NODE: undefined } })
    const page = await app.firstWindow(), errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.route('https://**gravatar.com/**', (route) => route.abort())
    await page.getByRole('button', { name: 'Edit Test workspace', exact: true }).click()
    await page.getByLabel('Workspace name').fill('Edited workspace')
    await page.locator('.workspace-repo-options label').filter({ hasText: 'beta' }).locator('input').uncheck()
    await page.getByRole('button', { name: 'Save workspace', exact: true }).click()
    await page.locator('.workspace-row').filter({ hasText: 'Edited workspace' }).click()
    await page.getByRole('button', { name: /^History$/ }).click()
    await page.getByRole('button', { name: 'Side', exact: true }).click()
    await page.locator('.history-side .details').waitFor()
    const side = await page.locator('.history-side').evaluate((el) => {
      const list = el.querySelector('.history-list-pane').getBoundingClientRect(), details = el.querySelector('.details').getBoundingClientRect()
      return { listRight: list.right, detailLeft: details.left, listTop: list.top, detailTop: details.top }
    })
    assert.ok(side.detailLeft >= side.listRight - 2); assert.ok(Math.abs(side.detailTop - side.listTop) < 2)
    await page.getByRole('button', { name: 'Columns', exact: true }).click()
    await page.locator('.history-column').nth(2).waitFor()
    assert.equal(await page.locator('.history-column').count(), 3)
    await page.locator('.history-diff-column').getByText('hello.txt', { exact: true }).first().waitFor()
    await page.locator('.history-column .tree .n').filter({ hasText: 'hello.txt' }).waitFor()
    const output = path.join(root, 'output/workspace-history'); await fs.mkdir(output, { recursive: true })
    await page.screenshot({ path: path.join(output, 'columns.png') })
    await page.getByRole('button', { name: 'Bottom', exact: true }).click()
    await page.locator('.history-bottom .splitbar.y').waitFor()
    await page.getByRole('button', { name: 'Edit workspace Edited workspace', exact: true }).click()
    await page.locator('.workspace-repo-options label').filter({ hasText: 'beta' }).locator('input').check()
    await page.getByRole('button', { name: 'Save workspace', exact: true }).click()
    await page.locator('.workspace-editor').waitFor({ state: 'detached' })
    let stored = await page.evaluate(() => window.spoon.app.workspaces())
    assert.equal(stored[0].name, 'Edited workspace'); assert.equal(stored[0].repos.length, 2)
    await page.locator('.tab-group-label').click({ button: 'right' })
    await page.getByRole('button', { name: 'Save open repositories', exact: true }).click()
    await page.waitForFunction(async () => (await window.spoon.app.workspaces())[0].repos.length === 1)
    await page.getByRole('button', { name: 'Workspaces', exact: true }).click()
    await page.locator('.ws-admin').getByRole('button', { name: 'Edit', exact: true }).click()
    await page.getByLabel('Workspace name').fill('Final workspace')
    await page.getByRole('button', { name: 'Save workspace', exact: true }).click()
    await page.locator('.workspace-editor').waitFor({ state: 'detached' })
    assert.equal((await page.evaluate(() => window.spoon.app.workspaces()))[0].name, 'Final workspace')
    assert.deepEqual(errors, [])
    const saved = JSON.parse(await fs.readFile(path.join(data, 'spoon.json'), 'utf8'))
    assert.equal(saved.settings.historyLayout, 'bottom'); assert.equal(saved.workspaces[0].name, 'Final workspace')
    console.log('Workspace editing from Home, tabs and manager, saving open repositories, layout geometry, columns content and persistence passed.')
  } finally {
    if (app) await app.close()
    if (path.dirname(temp) === os.tmpdir() && path.basename(temp).startsWith('spoon-workspace-ui-')) await fs.rm(temp, { recursive: true, force: true, maxRetries: 3 })
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1 })
