import { execFile } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import * as store from './store'
import type {
  CredentialAnswer,
  CredentialRequest,
  GitCredentialInfo,
  GitCredentialInput,
  SystemCredentialInfo
} from '../shared/types'

// Git accounts saved in Spoon. Git reaches them through Spoon's own credential helper
// (see askpass.ts), which runs before any other helper:
// - `get`   answers with the saved username and password for the remote
// - `store` runs after the remote accepted a login; Spoon keeps it when the user ticked
//           "Remember" in the sign-in dialog, or refreshes an account it already has
// - `erase` runs after the remote refused a login; the account stays listed but is marked
//           as rejected, so the next operation asks again instead of failing forever

export interface RemoteKey {
  protocol: string
  host: string
  username?: string
}

/** `https://alan@github.com/org/repo.git` → { protocol: 'https', host: 'github.com', username: 'alan' }. */
export function parseRemote(input: string): RemoteKey | null {
  const text = input.trim()
  if (!text) return null
  const m = /^([a-z][a-z0-9+.-]*):\/\/(?:([^@/\s]*)@)?([^/\s?#]+)/i.exec(text)
  if (m) {
    const username = m[2] ? decodeURIComponent(m[2].split(':')[0]) : undefined
    return { protocol: m[1].toLowerCase(), host: m[3].toLowerCase(), username: username || undefined }
  }
  // A bare host such as `github.com` or `git.example.com:8443`.
  if (/^[a-z0-9.-]+(:\d+)?$/i.test(text) && text.includes('.')) return { protocol: 'https', host: text.toLowerCase() }
  return null
}

const urlOf = (c: { protocol: string; host: string }) => `${c.protocol}://${c.host}`
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()

function toInfo(c: store.StoredGitCredential): GitCredentialInfo {
  return { id: c.id, url: urlOf(c), host: c.host, username: c.username, updatedAt: c.updatedAt, usedAt: c.usedAt, rejected: c.rejected || undefined }
}

export function listCredentials(): GitCredentialInfo[] {
  return store
    .getGitCreds()
    .map(toInfo)
    .sort((a, b) => a.host.localeCompare(b.host) || a.username.localeCompare(b.username))
}

function matches(list: store.StoredGitCredential[], key: RemoteKey): store.StoredGitCredential[] {
  return list
    .filter((c) => c.protocol === key.protocol && same(c.host, key.host) && (!key.username || same(c.username, key.username)))
    .sort((a, b) => (b.usedAt ?? b.updatedAt) - (a.usedAt ?? a.updatedAt))
}

function upsert(key: Required<RemoteKey>, password: string): void {
  const list = store.getGitCreds()
  const now = Date.now()
  const existing = matches(list, key)[0]
  const next: store.StoredGitCredential = {
    id: existing?.id ?? `cred-${now}-${randomBytes(4).toString('hex')}`,
    protocol: key.protocol,
    host: key.host,
    username: key.username,
    secret: store.encryptSecret(password),
    updatedAt: now,
    usedAt: existing?.usedAt
  }
  store.setGitCreds([next, ...list.filter((c) => c.id !== next.id)])
}

/** Add an account, or edit one (an empty password keeps the saved one). */
export function saveCredential(input: GitCredentialInput): GitCredentialInfo[] {
  const key = parseRemote(input.url)
  if (!key) throw new Error('Enter the server address, for example https://github.com')
  if (!/^https?$/.test(key.protocol)) throw new Error('Saved accounts work for http:// and https:// remotes. SSH remotes use your SSH keys.')
  const username = input.username.trim()
  if (!username) throw new Error('Enter the username.')
  const list = store.getGitCreds()
  const editing = input.id ? list.find((c) => c.id === input.id) : undefined
  const password = input.password || (editing ? store.decryptSecret(editing.secret) : '') || ''
  if (!password) throw new Error('Enter the password or personal access token.')
  const clash = list.find((c) => c.id !== editing?.id && c.protocol === key.protocol && same(c.host, key.host) && same(c.username, username))
  const now = Date.now()
  const next: store.StoredGitCredential = {
    id: editing?.id ?? clash?.id ?? `cred-${now}-${randomBytes(4).toString('hex')}`,
    protocol: key.protocol,
    host: key.host,
    username,
    secret: store.encryptSecret(password),
    updatedAt: now,
    usedAt: editing?.usedAt
  }
  store.setGitCreds([next, ...list.filter((c) => c.id !== next.id && c.id !== clash?.id)])
  return listCredentials()
}

export function removeCredential(id: string): GitCredentialInfo[] {
  store.setGitCreds(store.getGitCreds().filter((c) => c.id !== id))
  return listCredentials()
}

/** The account Git should use for a remote; rejected ones are skipped so the user is asked again. */
export function findCredential(key: RemoteKey): { username: string; password: string } | null {
  for (const c of matches(store.getGitCreds(), key)) {
    if (c.rejected) continue
    const password = store.decryptSecret(c.secret)
    if (password) return { username: c.username, password }
  }
  return null
}

// Logins typed into Spoon's dialog with "Remember" ticked. They are saved only when Git
// reports that the remote accepted them.
const pending = new Map<string, { username: string; password: string; expires: number }>()
const pendingKey = (key: RemoteKey) => `${key.protocol}://${key.host}`.toLowerCase()

/** Pre-fill the sign-in dialog from a saved account, and say when its password was refused. */
export function describeRequest(request: CredentialRequest): CredentialRequest {
  const key = request.target ? parseRemote(request.target) : null
  if (!key) return request
  const saved = matches(store.getGitCreds(), key)[0]
  if (!saved) return request
  return { ...request, suggestedUsername: saved.username, rejected: saved.rejected || undefined }
}

/** Called with the user's answer to a credential dialog. */
export function noteAnswer(request: CredentialRequest, answer: CredentialAnswer | null): void {
  const key = request.target ? parseRemote(request.target) : null
  if (!key || !answer) return
  const username = request.kind === 'username' ? answer.value.trim() : key.username
  const password = request.kind === 'username' ? answer.password : answer.value
  if (!username || !password) return
  if (!answer.remember) return void pending.delete(pendingKey(key))
  pending.set(pendingKey(key), { username, password, expires: Date.now() + 10 * 60_000 })
}

function parseFields(input: string): Record<string, string> {
  const fields: Record<string, string> = {}
  for (const line of input.split(/\r?\n/)) {
    const at = line.indexOf('=')
    if (at > 0) fields[line.slice(0, at)] = line.slice(at + 1)
  }
  return fields
}

/** Spoon's side of Git's credential-helper protocol. Returns what the helper prints. */
export function credentialHelper(op: string, input: string): string {
  const fields = parseFields(input)
  const protocol = (fields.protocol ?? '').toLowerCase()
  const host = (fields.host ?? '').toLowerCase()
  if (!protocol || !host) return ''
  const key: RemoteKey = { protocol, host, username: fields.username || undefined }
  if (op === 'get') {
    if (fields.password) return ''
    const list = store.getGitCreds()
    const hit = matches(list, key).find((c) => !c.rejected)
    const password = hit ? store.decryptSecret(hit.secret) : null
    if (!hit || !password) return ''
    hit.usedAt = Date.now()
    store.setGitCreds(list)
    return `username=${hit.username}\npassword=${password}\n`
  }
  if (!fields.username || !fields.password) return ''
  const full = { protocol, host, username: fields.username }
  if (op === 'store') {
    const waiting = pending.get(pendingKey(key))
    pending.delete(pendingKey(key))
    const remembered = !!waiting && waiting.expires > Date.now() && same(waiting.username, fields.username) && waiting.password === fields.password
    const existing = matches(store.getGitCreds(), full)[0]
    // An account Spoon already has follows the login that worked (a renewed token, or one
    // another helper supplied after Spoon's copy was refused).
    const stale = !!existing && (existing.rejected || store.decryptSecret(existing.secret) !== fields.password)
    if (remembered || stale) upsert(full, fields.password)
    return ''
  }
  if (op === 'erase') {
    pending.delete(pendingKey(key))
    const list = store.getGitCreds()
    const hit = matches(list, full).find((c) => store.decryptSecret(c.secret) === fields.password)
    if (hit && !hit.rejected) {
      hit.rejected = true
      store.setGitCreds(list)
    }
  }
  return ''
}

type Runner = (file: string, args: string[]) => Promise<string>

const run: Runner = (file, args) =>
  new Promise((resolve, reject) =>
    execFile(file, args, { windowsHide: true, encoding: 'utf8', timeout: 15_000 }, (error, stdout) => (error ? reject(error) : resolve(stdout)))
  )

/** Read `cmdkey /list`. Labels are localized by Windows, so only the layout is relied on. */
export function parseCmdkey(output: string): SystemCredentialInfo[] {
  const found: SystemCredentialInfo[] = []
  for (const block of output.split(/\r?\n\s*\r?\n/)) {
    const lines = block.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
    const at = lines.findIndex((line) => /target=git:/i.test(line))
    if (at < 0) continue
    const target = lines[at].slice(lines[at].toLowerCase().indexOf('target=') + 7).trim()
    // Layout: target line, type line, then (optionally) the user line.
    const userLine = lines[at + 2]
    const username = userLine && userLine.includes(':') ? userLine.slice(userLine.indexOf(':') + 1).trim() : ''
    found.push({ target, url: target.replace(/^git:/i, ''), username })
  }
  return found.sort((a, b) => a.url.localeCompare(b.url))
}

const systemOff = () => process.platform !== 'win32' || !!process.env.SPOON_NO_SYSTEM_CREDS

/** Git logins kept by Windows Credential Manager (written by Git Credential Manager). */
export async function listSystemCredentials(runner: Runner = run): Promise<SystemCredentialInfo[]> {
  if (systemOff() && runner === run) return []
  try {
    return parseCmdkey(await runner('cmdkey.exe', ['/list']))
  } catch {
    return []
  }
}

export async function removeSystemCredential(target: string, runner: Runner = run): Promise<SystemCredentialInfo[]> {
  const known = await listSystemCredentials(runner)
  if (!/^git:/i.test(target) || !known.some((item) => item.target === target)) throw new Error('That login is no longer in Windows Credential Manager.')
  await runner('cmdkey.exe', [`/delete:${target}`])
  return listSystemCredentials(runner)
}
