import { createServer } from 'node:net'
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { CredentialAnswer, CredentialRequest } from '../shared/types'

// Git and SSH run without a terminal, so they cannot type-prompt for a username or password.
// GIT_ASKPASS / SSH_ASKPASS point at a tiny helper (the same trick VS Code uses): Git runs it
// with the prompt text, the helper forwards it over a local pipe to this process, Spoon asks
// the user in the window and the answer goes back to Git on the helper's stdout.
// A configured credential helper (Git Credential Manager) still runs first; this only fills in
// when it is missing or could not answer.

// Electron's GUI-subsystem exe does not reliably hand stdout to Git on Windows, so the helper
// writes the answer to a temp file and the shell wrapper prints it.
const WRAPPER = `#!/bin/sh
SPOON_ASKPASS_OUT=\`mktemp\`
export SPOON_ASKPASS_OUT
ELECTRON_RUN_AS_NODE=1 "$SPOON_ASKPASS_NODE" "$SPOON_ASKPASS_MAIN" "$@"
status=$?
cat "$SPOON_ASKPASS_OUT"
rm -f "$SPOON_ASKPASS_OUT"
exit $status
`

const HELPER = `const net = require('net')
const fs = require('fs')
const socket = net.connect(process.env.SPOON_ASKPASS_HANDLE)
let data = ''
socket.setEncoding('utf8')
socket.on('connect', () => socket.end(JSON.stringify({ token: process.env.SPOON_ASKPASS_TOKEN, prompt: process.argv.slice(2).join(' ') })))
socket.on('data', (chunk) => { data += chunk })
socket.on('error', () => process.exit(1))
socket.on('close', () => {
  let reply
  try { reply = JSON.parse(data) } catch { process.exit(1) }
  if (!reply || !reply.ok) process.exit(1)
  const out = process.env.SPOON_ASKPASS_OUT
  if (out) fs.writeFileSync(out, reply.value + '\\n')
  else process.stdout.write(reply.value + '\\n')
  process.exit(0)
})
`

/** Read Git's and SSH's prompt text: what is asked, and for which remote. */
export function classifyPrompt(prompt: string): CredentialRequest {
  const text = prompt.trim()
  const git = /^(Username|Password) for '(.+)':?$/i.exec(text)
  if (git) return { prompt: text, kind: git[1].toLowerCase() === 'username' ? 'username' : 'password', target: git[2] }
  if (/\(yes\/no/i.test(text)) return { prompt: text, kind: 'confirm' }
  if (/password|passphrase|\bpin\b|token|passcode/i.test(text)) return { prompt: text, kind: 'password' }
  return { prompt: text, kind: 'text' }
}

/** `https://github.com` + `alan` → `https://alan@github.com`, the way Git names it in the password prompt. */
function withUser(target: string, user: string): string {
  const at = target.indexOf('://')
  return at < 0 ? `${user}@${target}` : `${target.slice(0, at + 3)}${user}@${target.slice(at + 3)}`
}

/**
 * Turn raw prompts into one dialog at a time. A username dialog also collects the password,
 * which answers Git's next "Password for 'https://user@host'" prompt without asking again.
 */
export function createAskpassResponder(
  ask: (request: CredentialRequest) => Promise<CredentialAnswer | null>
): (prompt: string) => Promise<string | null> {
  const remembered = new Map<string, { password: string; expires: number }>()
  let queue: Promise<unknown> = Promise.resolve()
  const handle = async (prompt: string): Promise<string | null> => {
    const request = classifyPrompt(prompt)
    if (request.kind === 'password' && request.target) {
      const kept = remembered.get(request.target)
      remembered.delete(request.target)
      if (kept && kept.expires > Date.now()) return kept.password
    }
    const answer = await ask(request)
    if (!answer) return null
    if (request.kind === 'username' && request.target && answer.password != null) {
      remembered.set(withUser(request.target, answer.value), { password: answer.password, expires: Date.now() + 120_000 })
    }
    return answer.value
  }
  return (prompt) => {
    const result = queue.then(() => handle(prompt))
    queue = result.catch(() => undefined)
    return result
  }
}

/**
 * Listen for the helper and write it to `dir`. Returns the environment that makes Git and SSH
 * use it; pass that only to commands the user started, never to background fetches.
 */
export async function startAskpass(
  dir: string,
  respond: (prompt: string) => Promise<string | null>,
  node = process.execPath
): Promise<NodeJS.ProcessEnv> {
  const token = randomBytes(24).toString('hex')
  const id = `spoon-askpass-${process.pid}-${randomBytes(6).toString('hex')}`
  const handle = process.platform === 'win32' ? `\\\\.\\pipe\\${id}` : join(tmpdir(), `${id}.sock`)
  const server = createServer({ allowHalfOpen: true }, (socket) => {
    let data = ''
    socket.setEncoding('utf8')
    socket.on('error', () => {})
    socket.on('data', (chunk: string) => {
      data += chunk
      if (data.length > 65_536) socket.destroy()
    })
    socket.on('end', () => {
      void (async () => {
        let reply: { ok: boolean; value?: string } = { ok: false }
        try {
          const request = JSON.parse(data) as { token?: string; prompt?: string }
          if (request.token === token) {
            const value = await respond(String(request.prompt ?? ''))
            if (value != null) reply = { ok: true, value }
          }
        } catch {
          /* malformed request or a failed dialog: Git sees a refusal */
        }
        if (!socket.destroyed) socket.end(JSON.stringify(reply))
      })()
    })
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(handle, () => {
      server.off('error', reject)
      resolve()
    })
  })
  server.unref()

  mkdirSync(dir, { recursive: true })
  const wrapper = join(dir, 'askpass.sh')
  const helper = join(dir, 'askpass-main.js')
  writeFileSync(wrapper, WRAPPER, 'utf8')
  writeFileSync(helper, HELPER, 'utf8')
  if (process.platform !== 'win32') chmodSync(wrapper, 0o755)
  // Git for Windows runs the wrapper with its own sh, which prefers forward slashes.
  const posix = (path: string) => (process.platform === 'win32' ? path.replace(/\\/g, '/') : path)
  return {
    GIT_ASKPASS: wrapper,
    SSH_ASKPASS: wrapper,
    SSH_ASKPASS_REQUIRE: 'force',
    SPOON_ASKPASS_NODE: posix(node),
    SPOON_ASKPASS_MAIN: posix(helper),
    SPOON_ASKPASS_HANDLE: handle,
    SPOON_ASKPASS_TOKEN: token
  }
}
