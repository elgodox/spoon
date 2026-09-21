const { execSync, spawn } = require('node:child_process')
const { join } = require('node:path')

const root = join(__dirname, '..')
const { ensure } = require('./ensure-electron.cjs')
if (!ensure()) process.exit(1)

function freePort(port) {
  try {
    const out = execSync(
      `powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort ${port} -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique"`,
      { encoding: 'utf8' }
    )
    for (const line of out.split(/\s+/).map((s) => s.trim()).filter(Boolean)) {
      const pid = Number(line)
      if (pid && pid !== process.pid) {
        try {
          process.kill(pid)
        } catch {
          try {
            execSync(`taskkill /PID ${pid} /T /F`, { stdio: 'ignore' })
          } catch {
            /* ignore */
          }
        }
      }
    }
  } catch {
    /* port already free */
  }
}

freePort(5173)

const child = spawn(join(root, 'node_modules', '.bin', 'electron-vite.cmd'), ['dev'], {
  cwd: root,
  stdio: 'inherit',
  shell: true,
  env: process.env
})

child.on('exit', (code) => process.exit(code ?? 0))
