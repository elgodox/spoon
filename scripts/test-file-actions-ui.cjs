const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const cp = require('node:child_process')
const assert = require('node:assert/strict')
const sharp = require('sharp')
let playwright
try { playwright = require('playwright') } catch { playwright = require(process.env.SPOON_PLAYWRIGHT_PATH || path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')) }
const { _electron } = playwright
const root = path.resolve(__dirname, '..')
function git(dir, args, env = {}) { return cp.execFileSync('git', args, { cwd: dir, env: { ...process.env, ...env }, windowsHide: true, encoding: 'utf8' }) }
async function main() {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'spoon-file-ui-'))
  let app
  try {
    const repo = path.join(temp, 'repo'), data = path.join(temp, 'data'), bin = path.join(temp, 'bin')
    await Promise.all([repo, data, bin].map((dir) => fs.mkdir(dir)))
    git(repo, ['init', '-b', 'main']); git(repo, ['config', 'user.name', 'Test Committer']); git(repo, ['config', 'user.email', 'committer@example.com'])
    const name = 'demo & special.ts'
    const original = Array.from({ length: 24 }, (_, i) => `line ${i + 1}`)
    await fs.writeFile(path.join(repo, name), original.join('\n') + '\n')
    await fs.writeFile(path.join(repo, 'removed.ts'), 'removed\n')
    git(repo, ['add', '.']); git(repo, ['commit', '-m', 'Add test file'], { GIT_AUTHOR_NAME: 'Test Author', GIT_AUTHOR_EMAIL: 'author@example.com' })
    const staged = [...original]; staged[7] = 'staged change'
    await fs.writeFile(path.join(repo, name), staged.join('\n') + '\n'); git(repo, ['add', name])
    const working = ['insert one', 'insert two', ...staged]; working[16] = 'working change'
    await fs.writeFile(path.join(repo, name), working.join('\n') + '\n'); await fs.unlink(path.join(repo, 'removed.ts'))
    const photo = `data:image/png;base64,${(await sharp({ create: { width: 256, height: 256, channels: 4, background: '#ab68ff' } }).png().toBuffer()).toString('base64')}`
    await fs.writeFile(path.join(data, 'spoon.json'), JSON.stringify({ settings: { appearanceVersion: 2, theme: 'dark', themePack: 'spoon', iconStyle: 'color', accentId: 'violet', onboarded: true, autoUpdate: false, autoFetch: false, avatarOverrides: { 'committer@example.com': photo }, profileEmail: 'committer@example.com' }, recent: [{ path: repo, name: 'File actions', opened: Date.now() }], session: { tabs: [{ id: 'test', path: repo, name: 'File actions' }], activeId: 'test' }, creds: {} }))
    // An actual executable records editor arguments, including a path with ampersands.
    const fakeEditor = path.join(bin, 'FakeEditor.exe'), argsFile = path.join(temp, 'editor.txt')
    const source = 'using System; using System.IO; public class FakeEditor { public static void Main(string[] args) { File.WriteAllLines(Environment.GetEnvironmentVariable("SPOON_EDITOR_OUTPUT"), args); } }'
    const ps = `$ProgressPreference='SilentlyContinue'; Add-Type -TypeDefinition '${source}' -OutputAssembly '${fakeEditor.replace(/'/g, "''")}' -OutputType ConsoleApplication`
    cp.execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(ps, 'utf16le').toString('base64')], { windowsHide: true })
    await fs.writeFile(path.join(bin, 'cli.js'), '// editor CLI fixture')
    await fs.writeFile(path.join(bin, 'code.cmd'), '@echo off\r\n"%~dp0FakeEditor.exe" "%~dp0cli.js" %*\r\n')
    const harness = path.join(temp, 'launch.cjs')
    await fs.writeFile(harness, `const {app,BrowserWindow,ipcMain,shell}=require('electron');app.setPath('userData',process.env.SPOON_UI_DATA);BrowserWindow.prototype.show=function(){};BrowserWindow.prototype.focus=function(){};app.on('browser-window-created',(_,w)=>w.webContents.setBackgroundThrottling(false));global.testActions={reveals:[],copies:[],generations:[]};shell.showItemInFolder=p=>global.testActions.reveals.push(p);shell.openPath=async p=>{global.testActions.reveals.push(p);return ''};require(${JSON.stringify(path.join(root, 'out/main/index.js'))});app.whenReady().then(()=>setTimeout(()=>{for(const c of ['profile:pick','profile:generate','app:copy'])ipcMain.removeHandler(c);ipcMain.handle('profile:pick',()=>${JSON.stringify(photo)});ipcMain.handle('profile:generate',(_,id,prompt)=>{global.testActions.generations.push({id,prompt});return ${JSON.stringify(photo)}});ipcMain.handle('app:copy',(_,text)=>global.testActions.copies.push(text));},100));`)
    app = await _electron.launch({ executablePath: path.join(root, 'node_modules/electron/dist/electron.exe'), args: [harness], cwd: root, env: { ...process.env, PATH: `${bin};${process.env.PATH}`, SPOON_UI_DATA: data, SPOON_EDITOR_OUTPUT: argsFile, ELECTRON_RUN_AS_NODE: undefined } })
    const page = await app.firstWindow()
    const errors = []; page.on('pageerror', (error) => errors.push(error.message))
    const photoBuffer = Buffer.from(photo.split(',')[1], 'base64')
    await page.route('https://**gravatar.com/**', (route) => route.fulfill({ body: photoBuffer, contentType: 'image/png' }))
    await page.locator('.sidebar').getByRole('button', { name: /^Changes/ }).click()
    await page.locator('.changes-heading').waitFor()
    const output = path.join(root, 'output/profile-actions'); await fs.mkdir(output, { recursive: true })
    const buttonOutput = path.join(root, 'output/button-audit'); await fs.mkdir(buttonOutput, { recursive: true })
    const buttonAudit = []
    async function auditButtons(screen) {
      // Inspect settled styles; hidden windows can pause compositor transitions.
      const still = await page.addStyleTag({ content: 'button{transition:none!important}' })
      const results = await page.locator('button').evaluateAll((buttons) => buttons.filter((button) => button.getClientRects().length && getComputedStyle(button).visibility !== 'hidden').map((button) => {
        const style = getComputedStyle(button)
        return { label: (button.getAttribute('aria-label') || button.textContent || button.title).trim().slice(0, 80), variant: button.dataset.buttonVariant, className: button.className, height: style.height, minHeight: style.minHeight, radius: style.borderRadius, fontSize: style.fontSize, weight: style.fontWeight, padding: style.padding, opacity: style.opacity, disabled: button.disabled, border: style.borderWidth, background: style.backgroundColor }
      }))
      await still.evaluate((element) => element.remove())
      assert.ok(results.length, `No buttons on ${screen}`)
      for (const button of results) {
        assert.ok(button.variant && button.className.includes('spoon-button'), `Unclassified button on ${screen}: ${button.label}`)
        assert.equal(button.fontSize, '12px', `${screen}: font of ${button.label}`)
        assert.equal(button.radius, button.variant === 'card' ? '12px' : '8px', `${screen}: radius of ${button.label}`)
        if (['primary','secondary','danger','select','filter','tab','segment'].includes(button.variant)) {
          assert.equal(button.height, '32px', `${screen}: height of ${button.label}`)
          assert.equal(button.minHeight, '32px', `${screen}: minimum of ${button.label}`)
        }
        if (button.disabled) assert.equal(button.opacity, '0.48', `${screen}: disabled ${button.label}`)
      }
      buttonAudit.push({ screen, buttons: results })
      await fs.writeFile(path.join(buttonOutput, 'audit.json'), JSON.stringify(buttonAudit, null, 2))
    }
    async function capture(name) {
      const still = await page.addStyleTag({ content: '*,*::before,*::after{animation:none!important;transition:none!important}' })
      await page.waitForTimeout(300)
      await app.evaluate(async ({BrowserWindow}) => BrowserWindow.getAllWindows()[0].webContents.capturePage(undefined, { stayHidden: true, stayAwake: true }))
      await page.waitForTimeout(150)
      const bytes = await app.evaluate(async ({BrowserWindow}) => (await BrowserWindow.getAllWindows()[0].webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG().toString('base64'))
      await fs.writeFile(path.join(output, name + '.png'), Buffer.from(bytes, 'base64'))
      if (name.startsWith('buttons-')) await fs.writeFile(path.join(buttonOutput, name + '.png'), Buffer.from(bytes, 'base64'))
      await still.evaluate((element) => element.remove())
    }
    async function editorArgs(expected) {
      const deadline = Date.now() + 10000
      while (Date.now() < deadline) {
        const args = await fs.readFile(argsFile, 'utf8').catch(() => '')
        if (expected.test(args)) return args
        await page.waitForTimeout(100)
      }
      throw new Error(`Editor did not receive expected arguments: ${expected}`)
    }
    const fileRow = page.locator('.file-pane').first().locator('.file-row').filter({ hasText: name })
    await fileRow.click(); await fileRow.click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Open with VS Code', exact: true }).waitFor()
    await capture('changes-menu')
    await page.getByRole('menuitem', { name: 'Open with VS Code', exact: true }).click()
    await editorArgs(/--goto\r?\n.*demo & special\.ts:1:1/)
    await fileRow.click({ button: 'right' }); await page.getByRole('menuitem', { name: 'Copy relative path', exact: true }).click()
    await page.waitForTimeout(200)
    assert.equal((await app.evaluate(() => global.testActions.copies)).at(-1), name)
    const stagedRow = page.locator('.file-pane').nth(1).locator('.file-row').filter({ hasText: name })
    await stagedRow.click({ button: 'right' }); await page.getByRole('menuitem', { name: 'Open with VS Code', exact: true }).click()
    await editorArgs(/special\.ts:10:1/)
    await fileRow.click(); const line = page.locator('.diff-line.add').filter({ hasText: 'working change' }); await line.waitFor(); await line.click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Open in editor · line 17', exact: true }).waitFor()
    await page.getByRole('menuitem', { name: 'Open with VS Code', exact: true }).click()
    await editorArgs(/special\.ts:17:1/)
    await page.locator('.file-row').filter({ hasText: 'removed.ts' }).click({ button: 'right' })
    assert.equal(await page.getByRole('menuitem', { name: 'Open in editor at change', exact: true }).isDisabled(), true)
    await capture('deleted-menu')
    await page.getByRole('menuitem', { name: 'Show in Windows Explorer', exact: true }).click()
    assert.equal((await app.evaluate(() => global.testActions.reveals)).at(-1), repo)
    await fileRow.click({ button: 'right' }); await page.keyboard.press('Escape'); assert.equal(await page.getByRole('menu').count(), 0)
    await page.locator('.sidebar').getByRole('button', { name: 'History', exact: true }).click(); await page.locator('.commit-row').first().click()
    await page.locator('.commit-meta .avatar img').nth(1).waitFor()
    assert.match(await page.locator('.commit-meta .avatar img').nth(0).getAttribute('src'), /gravatar.com\/avatar\/[a-f0-9]{64}/)
    assert.equal(await page.locator('.commit-meta .avatar img').nth(1).getAttribute('src'), photo)
    await capture('history-photos')
    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    await page.getByRole('button', { name: 'Profile', exact: true }).click()
    await page.locator('#avatar-agent option').first().waitFor({ state: 'attached' })
    await capture('profile')
    await page.getByRole('button', { name: 'Choose photo', exact: true }).click()
    await page.getByAltText('Avatar preview').waitFor()
    await page.getByRole('button', { name: 'Use this photo', exact: true }).click()
    await page.getByRole('status').filter({ hasText: 'Photo applied' }).waitFor()
    await page.getByRole('button', { name: 'Generate avatar', exact: true }).click()
    await page.getByAltText('Avatar preview').waitFor()
    assert.equal((await app.evaluate(() => global.testActions.generations)).length, 1)
    await capture('avatar-preview')
    await app.evaluate(({BrowserWindow}) => BrowserWindow.getAllWindows()[0].setSize(980, 620))
    await capture('compact-profile')
    await page.getByRole('button', { name: 'Done', exact: true }).click()
    await page.evaluate(() => window.spoon.app.patchSettings({ themePack: 'classic', theme: 'light' }))
    await page.reload()
    await page.locator('.sidebar').getByRole('button', { name: /^Changes/ }).click()
    await page.locator('.file-pane').first().locator('.file-row').filter({ hasText: name }).click({ button: 'right' })
    await capture('classic-light-menu')
    const bounds = await page.locator('.change-context-menu').boundingBox()
    assert.ok(bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= 980 && bounds.y + bounds.height <= 620)
    await auditButtons('classic-light-context-menu')
    await page.keyboard.press('Escape')
    for (const [pack, theme] of [['classic','dark'],['classic','light'],['spoon','dark'],['spoon','light'],['colored','dark'],['colored','light'],['spacex','dark']]) {
      await page.getByRole('button', { name: 'Settings', exact: true }).click()
      await page.locator('.prefs-layout > .rail').getByRole('button', { name: 'Appearance', exact: true }).click()
      await page.locator(`.theme-pack-card.pack-${pack}`).click()
      if (pack !== 'spacex') await page.locator(`.theme-pack-card.mode-${theme}`).click()
      await page.waitForFunction(([pack, theme]) => document.documentElement.dataset.pack === pack && document.documentElement.dataset.theme === theme, [pack, theme])
      await page.getByRole('button', { name: 'Done', exact: true }).click()
      await app.evaluate(async ({BrowserWindow}) => BrowserWindow.getAllWindows()[0].webContents.capturePage(undefined, { stayHidden: true, stayAwake: true }))
      await page.locator('.sidebar').getByRole('button', { name: /^Changes/ }).click()
      await auditButtons(`${pack}-${theme}-changes`)
      const styleOf = (button) => { const style = getComputedStyle(button); return [style.height, style.borderRadius, style.borderWidth, style.borderColor, style.fontSize, style.fontWeight, style.padding, style.backgroundColor, style.color] }
      const stage = page.locator('.file-pane').first().getByRole('button', { name: 'Stage', exact: true })
      const analyze = page.getByRole('button', { name: 'Analyze', exact: true })
      await page.mouse.move(10, 10); await page.waitForTimeout(150)
      assert.deepEqual(await stage.evaluate(styleOf), await analyze.evaluate(styleOf), `${pack}-${theme}: Stage and Analyze must match`)
      const original = await stage.evaluate(styleOf)
      await stage.hover(); await page.waitForTimeout(150)
      assert.notDeepEqual(await stage.evaluate(styleOf), original, 'Hover must be visible')
      await page.keyboard.press('Tab'); await stage.focus()
      assert.equal(await stage.evaluate((button) => getComputedStyle(button).outlineWidth), '2px')
      // Hidden Electron windows do not reliably advance compositor transitions.
      // Verify the configured duration, then inspect the pressed state without interpolation.
      assert.equal(await stage.evaluate((button) => getComputedStyle(button).transitionDuration), '0.12s')
      await stage.evaluate((button) => { button.style.transition = 'none' })
      await stage.hover(); await page.mouse.down()
      assert.match(await stage.evaluate((button) => getComputedStyle(button).transform), /0\.96/)
      // Release outside the control so this visual-state check cannot stage files.
      await page.mouse.move(10, 10); await page.mouse.up()
      await stage.evaluate((button) => { button.disabled = true })
      await stage.hover({ force: true }); await page.waitForTimeout(150)
      assert.equal(await stage.evaluate((button) => getComputedStyle(button).opacity), '0.48')
      assert.equal(await stage.evaluate((button) => getComputedStyle(button).transform), 'none')
      await stage.evaluate((button) => { button.disabled = false })
      await stage.evaluate((button) => { button.style.removeProperty('transition') })
      await page.emulateMedia({ reducedMotion: 'reduce' })
      assert.equal(await stage.evaluate((button) => getComputedStyle(button).transitionDuration), '0s')
      await stage.hover(); await page.mouse.down()
      assert.equal(await stage.evaluate((button) => getComputedStyle(button).transform), 'none')
      await page.mouse.move(10, 10); await page.mouse.up(); await page.emulateMedia({ reducedMotion: 'no-preference' })
      if (pack === 'classic' && theme === 'dark') await capture('buttons-classic-dark-changes')
      if (pack === 'spoon' && theme === 'dark') await capture('buttons-spoon-dark-changes')
    }
    await page.locator('.sidebar').getByRole('button', { name: 'History', exact: true }).click()
    await page.locator('.commit-row').first().click(); await auditButtons('history-details')
    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    for (const tab of ['Appearance', 'Profile', 'Git', 'Open with', 'AI', 'Help']) {
      await page.locator('.prefs-layout > .rail').getByRole('button', { name: tab, exact: true }).click()
      await page.waitForTimeout(150)
      await auditButtons(`preferences-${tab}`)
      if (tab === 'Profile' || tab === 'Open with') await capture(`buttons-preferences-${tab.replace(/ /g, '-').toLowerCase()}`)
    }
    await page.getByRole('button', { name: 'Done', exact: true }).click()
    await page.getByRole('button', { name: 'About Spoon', exact: true }).click(); await page.locator('.dialog.about').waitFor(); await auditButtons('about')
    await capture('buttons-about'); await page.locator('.dialog.about').getByRole('button', { name: 'Close', exact: true }).click()
    await page.getByRole('button', { name: 'New Branch', exact: true }).click(); await page.locator('.dialog').waitFor(); await auditButtons('new-branch'); await page.getByRole('button', { name: 'Cancel', exact: true }).click()
    await page.getByRole('button', { name: 'Workspaces', exact: true }).click(); await page.locator('.dialog').waitFor(); await auditButtons('workspaces'); await page.locator('.dialog').getByRole('button', { name: 'Close', exact: true }).click()
    await page.getByRole('button', { name: 'Home', exact: true }).click(); await page.locator('.manager').waitFor(); await auditButtons('home'); await capture('buttons-home')
    await page.evaluate(() => document.dispatchEvent(new Event('spoon-tour')))
    await page.locator('.tour-card').waitFor(); await auditButtons('tour-first-step')
    await page.locator('.tour-card').getByRole('button', { name: 'Next', exact: true }).click(); await auditButtons('tour-second-step')
    await page.locator('.tour-card').getByRole('button', { name: 'Skip', exact: true }).click()
    await fs.writeFile(path.join(buttonOutput, 'audit.json'), JSON.stringify(buttonAudit, null, 2))
    assert.deepEqual(errors, [])
    console.log(`Electron UI passed: file actions and profiles; ${buttonAudit.length} button screens checked across all theme packs, hover, focus, press, disabled and reduced motion.`)
  } finally {
    if (app) await app.close()
    await fs.rm(temp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1 })
