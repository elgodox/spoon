// Main-process services: "Open with" launchers, the PowerShell command runner,
// the repo overview cache and the auto-updater state machine.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { copyFileSync, existsSync, linkSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { sandboxDir } from '../support/repo.ts'
import { app, calls } from '../support/electron-stub.mjs'
import { autoUpdater } from '../support/electron-updater-stub.mjs'
import * as store from '../../src/main/store.ts'
import * as launchers from '../../src/main/launchers.ts'
import * as records from '../../src/main/repo-cache.ts'
import * as updater from '../../src/main/updater.ts'
import { encodedCommand, runCommand } from '../../src/main/command.ts'
import { launcherById } from '../../src/shared/launchers.ts'

/**
 * A folder on PATH with a fake `code.cmd` laid out like the real VS Code shim
 * ("%~dp0<exe>" "%~dp0<cli.js>" %*). The "exe" is node itself; cli.js records its arguments.
 * Like the real one it also has an extensionless `code` bash script, which `where code` lists first.
 */
function fakeEditor() {
  const bin = sandboxDir('bin-')
  const out = join(bin, 'args.txt')
  const exe = join(bin, 'FakeEditor.exe')
  try {
    linkSync(process.execPath, exe)
  } catch {
    copyFileSync(process.execPath, exe)
  }
  mkdirSync(join(bin, 'resources'))
  writeFileSync(join(bin, 'resources', 'cli.js'), `require('fs').appendFileSync(${JSON.stringify(out)}, JSON.stringify(process.argv.slice(2)) + '\\n')`)
  writeFileSync(join(bin, 'code'), '#!/usr/bin/env sh\nexec "$(dirname "$0")/FakeEditor.exe" "$@"\n')
  writeFileSync(join(bin, 'code.cmd'), '@echo off\r\n"%~dp0FakeEditor.exe" "%~dp0resources\\cli.js" %*\r\n')
  return { bin, out }
}

const lastArgs = async (out: string): Promise<string[]> => JSON.parse((await waitForFile(out)).trim().split('\n').at(-1)!)

function withPath<T>(dir: string, fn: () => Promise<T>): Promise<T> {
  const original = process.env.PATH
  process.env.PATH = `${dir};${original}`
  launchers.clearLauncherCache()
  return fn().finally(() => {
    process.env.PATH = original
    launchers.clearLauncherCache()
  })
}

async function waitForFile(file: string, ms = 8000): Promise<string> {
  const end = Date.now() + ms
  while (Date.now() < end) {
    if (existsSync(file)) {
      const text = readFileSync(file, 'utf8')
      if (text) return text
    }
    await sleep(100)
  }
  throw new Error(`timed out waiting for ${file}`)
}

test('listLaunchers detects tools on PATH and always offers terminal and explorer', async () => {
  const { bin } = fakeEditor()
  await withPath(bin, async () => {
    const { launchers: list, defaultId } = await launchers.listLaunchers(true)
    const by = Object.fromEntries(list.map((l) => [l.id, l]))
    assert.equal(by.code.available, true)
    assert.equal(by.code.command, 'code')
    assert.equal(by.code.path, join(bin, 'code.cmd'), 'the extensionless bash shim is skipped')
    assert.equal(by.terminal.available, true)
    assert.equal(by.explorer.available, true)
    assert.ok(list.find((l) => l.available && l.kind === 'ide'))
    assert.ok(defaultId)
  })
})

test('resolveDefaultId honours the saved default only when it is available', () => {
  store.patchSettings({ defaultLauncher: 'zed' })
  const list = [
    { id: 'zed', kind: 'ide', available: false },
    { id: 'code', kind: 'ide', available: true },
    { id: 'explorer', kind: 'system', available: true }
  ] as never
  assert.equal(launchers.resolveDefaultId(list), 'code')
  store.patchSettings({ defaultLauncher: 'code' })
  assert.equal(launchers.resolveDefaultId(list), 'code')
  assert.equal(launchers.resolveDefaultId([{ id: 'explorer', kind: 'system', available: true }] as never), 'explorer')
})

test('openWith: explorer uses the shell, missing folders and unknown launchers fail', async () => {
  const dir = sandboxDir('open-')
  assert.equal(await launchers.openWith(dir, 'explorer'), launcherById('explorer')!.label)
  assert.equal(calls.openPath.at(-1), dir)
  await assert.rejects(launchers.openWith(join(dir, 'missing'), 'explorer'), /no longer exists/)
  await assert.rejects(launchers.openWith(dir, 'does-not-exist'), /Unknown launcher/)
})

test('openWith passes a folder with special characters to the IDE as one argument', async () => {
  const { bin, out } = fakeEditor()
  const folder = join(sandboxDir('special-'), 'R&D')
  mkdirSync(folder)
  await withPath(bin, async () => {
    await launchers.openWith(folder, 'code')
    const args = await lastArgs(out)
    assert.deepEqual(args, [folder])
  })
})

test('findOnPath follows PATH order, prefers .exe over .cmd and skips extensionless shims', () => {
  const files = new Set(['C:\\a\\code', 'C:\\b\\code.cmd', 'C:\\b\\code.exe', 'C:\\c\\claude.exe'].map((f) => f.toLowerCase()))
  const exists = (file: string) => files.has(file.toLowerCase())
  assert.equal(launchers.findOnPath('code', ['C:\\a', 'C:\\b'], exists), 'C:\\b\\code.exe')
  assert.equal(launchers.findOnPath('claude', ['C:\\a', 'C:\\b', 'C:\\c'], exists), 'C:\\c\\claude.exe')
  assert.equal(launchers.findOnPath('code.cmd', ['C:\\b'], exists), 'C:\\b\\code.cmd')
  assert.equal(launchers.findOnPath('missing', ['C:\\a', 'C:\\b'], exists), undefined)
})

test('mergeDirs expands variables and drops duplicates; knownBinDirs covers CLI installers', () => {
  const env = { USERPROFILE: 'C:\\Users\\me', APPDATA: 'C:\\Users\\me\\AppData\\Roaming', LOCALAPPDATA: 'C:\\Users\\me\\AppData\\Local' }
  assert.deepEqual(
    launchers.mergeDirs(['C:\\Windows;%USERPROFILE%\\.local\\bin\\;;', 'c:\\windows;"C:\\Tools"', '%NOPE%\\x'], env),
    ['C:\\Windows', 'C:\\Users\\me\\.local\\bin', 'C:\\Tools', '%NOPE%\\x']
  )
  const known = launchers.knownBinDirs(env)
  assert.ok(known.includes('C:\\Users\\me\\.local\\bin'), 'native Claude Code installer')
  assert.ok(known.includes('C:\\Users\\me\\AppData\\Roaming\\npm'), 'npm global installs')
})

test('listLaunchers finds the Claude Code CLI even when Spoon started with a stale PATH', async () => {
  // The native installer puts claude.exe in %USERPROFILE%\.local\bin (the sandbox home here).
  const bin = join(process.env.USERPROFILE!, '.local', 'bin')
  mkdirSync(bin, { recursive: true })
  copyFileSync(join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'whoami.exe'), join(bin, 'claude.exe'))
  const original = process.env.PATH
  process.env.PATH = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32')
  try {
    const { launchers: list } = await launchers.listLaunchers(true)
    const claude = list.find((l) => l.id === 'claude')!
    assert.equal(claude.available, true)
    assert.match(claude.path!, /claude\.exe$/i)
  } finally {
    process.env.PATH = original
    launchers.clearLauncherCache()
  }
})

test('CLI launchers open a terminal in the repo folder; the folder is never on a command line', () => {
  const cli = 'C:\\Users\\Jane Doe\\.local\\bin\\claude.exe'
  const wt = 'C:\\Users\\Jane Doe\\AppData\\Local\\Microsoft\\WindowsApps\\wt.exe'
  assert.deepEqual(launchers.cliPlan('Claude Code', cli, [], wt), { file: wt, args: ['-d', '.', 'cmd', '/k', cli] })
  const fallback = launchers.cliPlan('Claude Code', cli)
  assert.equal(fallback.file, 'cmd.exe')
  assert.equal(fallback.verbatim, true)
  assert.deepEqual(fallback.args.slice(0, 3), ['/d', '/s', '/c'])
  assert.equal(fallback.args[3], `"start "Claude Code" cmd /k "${cli}""`)
  assert.deepEqual(launchers.terminalPlan('pwsh.exe', wt), { file: wt, args: ['-d', '.'] })
  assert.equal(launchers.terminalPlan('C:\\Program Files\\PowerShell\\7\\pwsh.exe').args[3], '"start "Spoon" "C:\\Program Files\\PowerShell\\7\\pwsh.exe" -NoExit -NoLogo"')
})

test('idePlan starts the editor itself, not the bash shim or cmd.exe', () => {
  const { bin } = fakeEditor()
  const folder = 'C:\\work\\R&D'
  const plan = launchers.idePlan(join(bin, 'code.cmd'), folder)
  assert.equal(plan.file, join(bin, 'FakeEditor.exe'))
  assert.deepEqual(plan.args, [join(bin, 'resources', 'cli.js'), folder])
  assert.deepEqual(launchers.idePlan('C:\\Zed\\zed.exe', folder), { file: 'C:\\Zed\\zed.exe', args: [folder] })
  const other = join(bin, 'other.cmd')
  writeFileSync(other, '@echo off\r\nstart "" something %*\r\n')
  assert.deepEqual(launchers.idePlan(other, folder), { file: 'cmd.exe', args: ['/d', '/s', '/c', `""${other}" "${folder}""`], verbatim: true })
})

test('a launcher that cannot start is reported instead of crashing the main process', async () => {
  const dir = sandboxDir('broken-')
  await assert.rejects(launchers.startDetached({ file: join(dir, 'missing.exe'), args: [] }, dir), /ENOENT/)
  // A VS Code-style shim whose editor was uninstalled falls back to cmd.exe, which fails.
  const bin = sandboxDir('bin-')
  writeFileSync(join(bin, 'code.cmd'), '@echo off\r\n"%~dp0Gone.exe" "%~dp0resources\\cli.js" %*\r\n')
  await withPath(bin, async () => {
    await assert.rejects(launchers.openWith(dir, 'code'), /Could not open VS Code/)
  })
})

test('openFileAt opens the editor at file:line', async () => {
  const { bin, out } = fakeEditor()
  const repo = sandboxDir('repo-')
  const file = join(repo, 'a b.ts')
  writeFileSync(file, 'x')
  await withPath(bin, async () => {
    store.patchSettings({ defaultLauncher: 'code' })
    assert.equal(await launchers.openFileAt(repo, file, 7.9), 'VS Code')
    const args = await lastArgs(out)
    assert.deepEqual(args, ['--goto', `${file}:7:1`])
  })
  await assert.rejects(launchers.openFileAt(repo, join(repo, 'missing.ts')), /no longer exists/)
})

test('encodedCommand keeps arguments as data, never as PowerShell code', () => {
  const script = Buffer.from(encodedCommand('tool', ['$(evil)', "a'b"], 'in'), 'base64').toString('utf16le')
  assert.ok(!script.includes('$(evil)'))
  assert.match(script, /ConvertFrom-Json/)
})

test('runCommand returns stdout, reports failures and honours abort', async () => {
  const where = await runCommand('where.exe', ['git'], { cwd: process.cwd() })
  assert.match(where, /git/i)
  await assert.rejects(runCommand('where.exe', ['definitely-not-a-command-xyz'], { cwd: process.cwd() }))
  const controller = new AbortController()
  controller.abort()
  await assert.rejects(runCommand('where.exe', ['git'], { cwd: process.cwd(), signal: controller.signal }), /canceled/)
})

test('repo-cache remembers overviews and activity per stamp and persists on flush', () => {
  const overview = { path: 'C:/R', name: 'R', exists: true } as never
  records.saveOverview('C:/R', 'stamp-1', overview)
  assert.equal(records.recallOverview('c:/r', 'stamp-1'), overview)
  assert.equal(records.recallOverview('C:/R', 'stamp-2'), null)
  records.saveActivity('C:/R', 's', 30, 'me', { '2026-1-1': 2 })
  assert.deepEqual(records.recallActivity('C:/R', 's', 30, 'me'), { '2026-1-1': 2 })
  assert.equal(records.recallActivity('C:/R', 's', 90, 'me'), null)
  assert.equal(records.recallActivity('C:/R', 's', 30, 'you'), null)
  records.saveActivity('C:/R', 's', 10, 'me', {})
  assert.deepEqual(records.recallActivity('C:/R', 's', 30, 'me'), { '2026-1-1': 2 }, 'a shorter span does not replace a longer one')
  records.flush()
  const file = JSON.parse(readFileSync(join(app.getPath('userData'), 'repo-records.json'), 'utf8'))
  assert.ok(Object.keys(file.overview).length >= 1)
  records.forget('C:/R')
  assert.equal(records.recallOverview('C:/R', 'stamp-1'), null)
  records.flush()
})

test('updater: disabled in dev builds', async () => {
  const states: string[] = []
  updater.initUpdater((s) => states.push(s.status), true)
  assert.equal(updater.current().status, 'disabled')
  assert.equal((await updater.check()).status, 'disabled')
})

test('updater: packaged flow goes available → downloading → ready → install', async () => {
  app.isPackaged = true
  try {
    const states: string[] = []
    updater.initUpdater((s) => states.push(s.status), false)
    assert.equal(updater.current().status, 'disabled')
    autoUpdater.checkForUpdates = async () => {
      autoUpdater.emit('checking-for-update')
      autoUpdater.emit('update-available', { version: '9.9.9', releaseNotes: '<p>New <b>stuff</b></p>' })
      autoUpdater.emit('download-progress', { percent: 41.6 })
      return null
    }
    let s = await updater.check()
    assert.equal(s.status, 'downloading')
    assert.equal(s.percent, 42)
    assert.equal(s.version, '9.9.9')
    assert.equal(s.notes, 'New stuff')
    autoUpdater.emit('update-downloaded', { version: '9.9.9' })
    s = updater.current()
    assert.equal(s.status, 'ready')
    updater.install()
    await sleep(10)
    assert.equal(autoUpdater.installs, 1)
  } finally {
    app.isPackaged = false
  }
})

test('updater: a missing latest.yml counts as "no update", other errors are reported', async () => {
  app.isPackaged = true
  try {
    updater.initUpdater(() => undefined, false)
    autoUpdater.emit('update-not-available')
    autoUpdater.checkForUpdates = async () => {
      throw new Error('Cannot find latest.yml in the latest release artifacts')
    }
    assert.equal((await updater.check()).status, 'none')
    autoUpdater.checkForUpdates = async () => {
      throw new Error('net::ERR_INTERNET_DISCONNECTED\nmore')
    }
    const s = await updater.check()
    assert.equal(s.status, 'error')
    assert.equal(s.error, 'net::ERR_INTERNET_DISCONNECTED')
  } finally {
    app.isPackaged = false
  }
})
