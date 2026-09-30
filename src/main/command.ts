import { execFile, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { isAbsolute } from 'node:path'

async function executable(command: string): Promise<string> {
  if (isAbsolute(command) && existsSync(command) && /\.(exe|ps1)$/i.test(command)) return command
  const paths = await new Promise<string[]>((resolve, reject) => execFile('where.exe', [command], { windowsHide: true }, (error, stdout) => error ? reject(error) : resolve(stdout.trim().split(/\r?\n/))))
  const first = paths[0]
  if (/\.(exe|ps1)$/i.test(first)) return first
  // npm's PowerShell shim passes an argument array to Node without a cmd shell.
  const script = first.replace(/\.(cmd|bat)$/i, '.ps1')
  if (script !== first && existsSync(script)) return script
  throw new Error('This command needs an executable or PowerShell entry point on PATH.')
}

/** Encode data separately from PowerShell source: paths and prompts are never shell code. */
export function encodedCommand(command: string, args: string[], input?: string): string {
  const payload = Buffer.from(JSON.stringify({ command, args, input }), 'utf8').toString('base64')
  const script = `
    [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
    $OutputEncoding = [Console]::OutputEncoding
    $spoonPayload = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${payload}')) | ConvertFrom-Json
    $spoonCommand = $spoonPayload.command
    $spoonArgs = @($spoonPayload.args)
    if ($null -ne $spoonPayload.input) { $spoonPayload.input | & $spoonCommand @spoonArgs }
    else { & $spoonCommand @spoonArgs }
    if ($null -ne $LASTEXITCODE) { exit $LASTEXITCODE }
    if (-not $?) { exit 1 }
  `
  return Buffer.from(script, 'utf16le').toString('base64')
}

export async function runCommand(command: string, args: string[], options: {
  cwd: string; input?: string; timeout?: number; signal?: AbortSignal; env?: NodeJS.ProcessEnv
}): Promise<string> {
  const bin = await executable(command)
  return new Promise((resolve, reject) => {
    if (options.signal?.aborted) return reject(new Error('Generation canceled.'))
    const script = /\.ps1$/i.test(bin)
    const child = spawn(script ? 'powershell.exe' : bin, script ? ['-NoProfile', '-NonInteractive', '-EncodedCommand', encodedCommand(bin, args, options.input)] : args, {
      cwd: options.cwd, env: { ...process.env, ...options.env }, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe']
    })
    child.stdin.on('error', () => {})
    child.stdin.end(script ? undefined : options.input)
    let output = '', error = '', settled = false
    let stopping = false
    const finish = (reason?: Error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      options.signal?.removeEventListener('abort', cancel)
      if (reason) reject(reason)
      else resolve(output)
    }
    const stop = (message: string) => {
      if (settled || stopping) return
      stopping = true
      if (child.pid) execFile('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }, () => finish(new Error(message)))
      else finish(new Error(message))
    }
    const cancel = () => stop('Generation canceled.')
    const timer = setTimeout(() => stop('The CLI timed out. Check its login in a terminal and try again.'), options.timeout ?? 180_000)
    options.signal?.addEventListener('abort', cancel, { once: true })
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      output += chunk
      if (output.length > 2_000_000) stop('The CLI returned too much output. Try a shorter description.')
    })
    child.stderr.on('data', (chunk: string) => { error = (error + chunk).slice(-8192) })
    child.once('error', (reason) => finish(reason))
    child.once('close', (code) => { if (!stopping) finish(code === 0 ? undefined : new Error(error.trim().slice(-1600) || 'The CLI failed. Check its login in a terminal and try again.')) })
  })
}
