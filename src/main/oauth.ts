import { BrowserWindow, shell } from 'electron'
import { createServer } from 'node:http'
import { createHash, randomBytes } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { AiAccount, AiProviderId } from '../shared/types'
import { clearCreds, loadCreds, saveCreds, type StoredAiCreds } from './store'

const GROK_CLIENT = 'b1a00492-073a-47ea-816f-4c329264a828'
const GROK_AUTH = 'https://auth.x.ai/oauth2/authorize'
const GROK_TOKEN = 'https://auth.x.ai/oauth2/token'
const GROK_DEVICE = 'https://auth.x.ai/oauth2/device/code'
const GROK_SCOPES = 'openid profile email offline_access api:access'

export interface DeviceFlow {
  provider: AiProviderId
  userCode: string
  verificationUrl: string
  expiresIn: number
  deviceCode: string
  interval: number
}

function b64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function pkce(): { verifier: string; challenge: string } {
  const verifier = b64url(randomBytes(32))
  const challenge = b64url(createHash('sha256').update(verifier).digest())
  return { verifier, challenge }
}

function home(...parts: string[]): string {
  return join(homedir(), ...parts)
}

export function detectLocalSessions(): Record<AiProviderId, { available: boolean; label?: string }> {
  const grok = readGrokLocal()
  const claude = readClaudeLocal()
  const chatgpt = readCodexLocal()
  return {
    grok: { available: !!grok, label: grok?.email || grok?.label },
    claude: { available: !!claude, label: claude?.label },
    chatgpt: { available: !!chatgpt, label: chatgpt?.label }
  }
}

function readJson(path: string): Record<string, unknown> | null {
  try {
    if (!existsSync(path)) return null
    return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>
  } catch {
    return null
  }
}

function readGrokLocal(): StoredAiCreds | null {
  const data = readJson(home('.grok', 'auth.json'))
  if (!data) return null
  for (const [key, value] of Object.entries(data)) {
    if (!key.startsWith('https://auth.x.ai') || typeof value !== 'object' || !value) continue
    const v = value as Record<string, unknown>
    const access = String(v.key || v.access_token || '')
    const refresh = String(v.refresh_token || '')
    if (!access && !refresh) continue
    return {
      provider: 'grok',
      method: 'imported',
      accessToken: access,
      refreshToken: refresh || undefined,
      expiresAt: v.expires_at ? Date.parse(String(v.expires_at)) : undefined,
      clientId: String(v.oidc_client_id || GROK_CLIENT),
      email: v.email ? String(v.email) : undefined,
      label: v.email ? String(v.email) : 'Grok'
    }
  }
  return null
}

function readClaudeLocal(): StoredAiCreds | null {
  const data = readJson(home('.claude', '.credentials.json'))
  const oauth = data?.claudeAiOauth as Record<string, unknown> | undefined
  if (!oauth?.accessToken) return null
  return {
    provider: 'claude',
    method: 'imported',
    accessToken: String(oauth.accessToken),
    refreshToken: oauth.refreshToken ? String(oauth.refreshToken) : undefined,
    expiresAt: typeof oauth.expiresAt === 'number' ? oauth.expiresAt : undefined,
    label: oauth.subscriptionType ? `Claude ${oauth.subscriptionType}` : 'Claude'
  }
}

function readCodexLocal(): StoredAiCreds | null {
  const data = readJson(home('.codex', 'auth.json'))
  const tokens = data?.tokens as Record<string, unknown> | undefined
  if (!tokens?.access_token) return null
  return {
    provider: 'chatgpt',
    method: 'imported',
    accessToken: String(tokens.access_token),
    refreshToken: tokens.refresh_token ? String(tokens.refresh_token) : undefined,
    apiKey: data?.OPENAI_API_KEY ? String(data.OPENAI_API_KEY) : undefined,
    label: data?.auth_mode === 'chatgpt' ? 'ChatGPT' : 'OpenAI'
  }
}

export function importLocal(provider: AiProviderId): StoredAiCreds {
  const creds =
    provider === 'grok' ? readGrokLocal() : provider === 'claude' ? readClaudeLocal() : readCodexLocal()
  if (!creds) throw new Error(`No local ${provider} session found.`)
  saveCreds(creds)
  return creds
}

export function saveApiKey(provider: AiProviderId, apiKey: string): StoredAiCreds {
  const creds: StoredAiCreds = {
    provider,
    method: 'api-key',
    apiKey: apiKey.trim(),
    label: provider === 'grok' ? 'xAI API key' : provider === 'claude' ? 'Anthropic API key' : 'OpenAI API key'
  }
  saveCreds(creds)
  return creds
}

export function accounts(): AiAccount[] {
  const local = detectLocalSessions()
  return (['grok', 'chatgpt', 'claude'] as AiProviderId[]).map((provider) => {
    const stored = loadCreds(provider)
    return {
      provider,
      connected: !!stored,
      method: stored?.method,
      label: stored?.label,
      email: stored?.email ?? local[provider].label
    }
  })
}

export function disconnect(provider: AiProviderId): void {
  clearCreds(provider)
}

export async function startGrokDevice(): Promise<DeviceFlow> {
  const body = new URLSearchParams({
    client_id: GROK_CLIENT,
    scope: GROK_SCOPES
  })
  const res = await fetch(GROK_DEVICE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  })
  if (!res.ok) {
    const t = await res.text()
    throw new Error(`Grok device login failed: ${res.status} ${t}`)
  }
  const data = (await res.json()) as {
    device_code: string
    user_code: string
    verification_uri: string
    verification_uri_complete?: string
    expires_in: number
    interval?: number
  }
  const url = data.verification_uri_complete || data.verification_uri
  await shell.openExternal(url)
  return {
    provider: 'grok',
    userCode: data.user_code,
    verificationUrl: url,
    expiresIn: data.expires_in,
    deviceCode: data.device_code,
    interval: data.interval ?? 5
  }
}

export async function pollGrokDevice(flow: DeviceFlow): Promise<StoredAiCreds> {
  const deadline = Date.now() + flow.expiresIn * 1000
  while (Date.now() < deadline) {
    await sleep((flow.interval || 5) * 1000)
    const res = await fetch(GROK_TOKEN, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        device_code: flow.deviceCode,
        client_id: GROK_CLIENT
      })
    })
    const data = (await res.json()) as Record<string, string>
    if (data.access_token) {
      const creds: StoredAiCreds = {
        provider: 'grok',
        method: 'oauth',
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
        expiresAt: data.expires_in ? Date.now() + Number(data.expires_in) * 1000 : undefined,
        clientId: GROK_CLIENT,
        label: 'Grok OAuth'
      }
      saveCreds(creds)
      return creds
    }
    if (data.error && data.error !== 'authorization_pending' && data.error !== 'slow_down') {
      throw new Error(data.error_description || data.error)
    }
  }
  throw new Error('Grok sign-in timed out.')
}

export async function startGrokPkce(parent?: BrowserWindow): Promise<StoredAiCreds> {
  const { verifier, challenge } = pkce()
  const port = 56121
  const redirect = `http://127.0.0.1:${port}/callback`
  const state = b64url(randomBytes(16))
  const url = new URL(GROK_AUTH)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('client_id', GROK_CLIENT)
  url.searchParams.set('redirect_uri', redirect)
  url.searchParams.set('scope', GROK_SCOPES)
  url.searchParams.set('code_challenge', challenge)
  url.searchParams.set('code_challenge_method', 'S256')
  url.searchParams.set('state', state)

  const code = await waitForCode(url.toString(), port, state, parent)
  const res = await fetch(GROK_TOKEN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirect,
      client_id: GROK_CLIENT,
      code_verifier: verifier
    })
  })
  const data = (await res.json()) as Record<string, string>
  if (!data.access_token) throw new Error(data.error_description || data.error || 'Grok OAuth failed')
  const creds: StoredAiCreds = {
    provider: 'grok',
    method: 'oauth',
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: data.expires_in ? Date.now() + Number(data.expires_in) * 1000 : undefined,
    clientId: GROK_CLIENT,
    label: 'Grok OAuth'
  }
  saveCreds(creds)
  return creds
}

function waitForCode(authUrl: string, port: number, state: string, parent?: BrowserWindow): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    const server = createServer((req, res) => {
      try {
        const u = new URL(req.url || '/', `http://127.0.0.1:${port}`)
        if (u.pathname !== '/callback') {
          res.writeHead(404)
          res.end()
          return
        }
        const err = u.searchParams.get('error')
        const code = u.searchParams.get('code')
        const st = u.searchParams.get('state')
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
        res.end(
          '<html><body style="font-family:Segoe UI,sans-serif;padding:40px">You can close this window and return to Spoon.</body></html>'
        )
        server.close()
        child?.close()
        if (err) reject(new Error(err))
        else if (!code || st !== state) reject(new Error('Invalid OAuth response'))
        else resolvePromise(code)
      } catch (e) {
        reject(e)
      }
    })
    server.listen(port, '127.0.0.1', () => {
      void shell.openExternal(authUrl)
    })
    server.on('error', reject)
    const child = parent
      ? new BrowserWindow({
          width: 520,
          height: 720,
          parent,
          autoHideMenuBar: true,
          title: 'Sign in'
        })
      : null
    if (child) {
      child.loadURL(authUrl)
      child.on('closed', () => {
        /* callback server still running */
      })
    }
    setTimeout(() => {
      server.close()
      reject(new Error('OAuth timed out'))
    }, 5 * 60 * 1000)
  })
}

export async function refreshGrok(creds: StoredAiCreds): Promise<StoredAiCreds> {
  if (!creds.refreshToken) return creds
  if (creds.expiresAt && creds.expiresAt - 60_000 > Date.now()) return creds
  const res = await fetch(GROK_TOKEN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: creds.refreshToken,
      client_id: creds.clientId || GROK_CLIENT
    })
  })
  const data = (await res.json()) as Record<string, string>
  if (!data.access_token) return creds
  const next: StoredAiCreds = {
    ...creds,
    accessToken: data.access_token,
    refreshToken: data.refresh_token || creds.refreshToken,
    expiresAt: data.expires_in ? Date.now() + Number(data.expires_in) * 1000 : creds.expiresAt
  }
  saveCreds(next)
  return next
}

export async function openProviderConsole(provider: AiProviderId): Promise<void> {
  const urls: Record<AiProviderId, string> = {
    grok: 'https://console.x.ai/team/default/api-keys',
    chatgpt: 'https://platform.openai.com/api-keys',
    claude: 'https://console.anthropic.com/settings/keys'
  }
  await shell.openExternal(urls[provider])
}

export async function resolveCreds(provider: AiProviderId): Promise<StoredAiCreds> {
  let creds = loadCreds(provider)
  if (!creds) {
    try {
      creds = importLocal(provider)
    } catch {
      throw new Error(`Connect ${providerLabel(provider)} in Spoon → Preferences → AI.`)
    }
  }
  if (provider === 'grok') creds = await refreshGrok(creds)
  return creds
}

export function providerLabel(id: AiProviderId): string {
  return id === 'grok' ? 'Grok' : id === 'claude' ? 'Claude' : 'ChatGPT'
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}
