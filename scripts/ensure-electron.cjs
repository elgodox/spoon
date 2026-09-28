const { existsSync, rmSync, writeFileSync } = require('node:fs')
const { join } = require('node:path')
const { execSync } = require('node:child_process')
const os = require('node:os')

const root = join(__dirname, '..')
const electronDir = join(root, 'node_modules', 'electron')
const distDir = join(electronDir, 'dist')
const exe = join(distDir, 'electron.exe')
const pathTxt = join(electronDir, 'path.txt')

function ok() {
  return existsSync(exe) && existsSync(pathTxt)
}

function extractCachedZip() {
  const cache = join(os.homedir(), 'AppData', 'Local', 'electron', 'Cache')
  if (!existsSync(cache)) return false
  const { readdirSync, statSync } = require('node:fs')
  const zips = []
  function walk(dir) {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name)
      if (statSync(p).isDirectory()) walk(p)
      else if (name.includes('electron-v') && name.endsWith('-win32-x64.zip')) zips.push(p)
    }
  }
  try {
    walk(cache)
  } catch {
    return false
  }
  zips.sort()
  const version = require(join(electronDir, 'package.json')).version
  const zip = zips.find((z) => z.includes(`electron-v${version}-`)) || zips[zips.length - 1]
  if (!zip) return false
  // A half-extracted dist (only "locales" + "version") makes install.js think Electron is present.
  rmSync(distDir, { recursive: true, force: true })
  // Windows PowerShell 5.1 has no overwrite overload, so extract into a clean folder.
  const powershell = `
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    [System.IO.Compression.ZipFile]::ExtractToDirectory('${zip.replace(/'/g, "''")}', '${distDir.replace(/'/g, "''")}')
  `
  execSync(`powershell -NoProfile -Command "${powershell.replace(/"/g, '\\"')}"`, { stdio: 'inherit' })
  writeFileSync(pathTxt, 'electron.exe')
  writeFileSync(join(distDir, 'version'), version)
  return existsSync(exe)
}

function install() {
  try {
    execSync('node install.js', { cwd: electronDir, stdio: 'inherit', env: process.env })
  } catch {
    /* fall through */
  }
}

function ensure() {
  if (ok()) return true
  if (!existsSync(join(electronDir, 'package.json'))) {
    console.error(`Electron is not installed. Run npm install inside ${root}`)
    return false
  }
  console.log('Electron binary missing — repairing…')
  install()
  if (!ok()) extractCachedZip()
  if (!ok()) {
    console.error('Could not install Electron. Delete node_modules/electron and run npm install again.')
    return false
  }
  console.log('Electron ready:', exe)
  return true
}

if (require.main === module) {
  process.exit(ensure() ? 0 : 1)
}

module.exports = { ensure }
