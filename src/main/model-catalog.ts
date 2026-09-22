import { findAiSite, openAiUrl } from '../shared/ai-catalog'
import { AI_MODELS, defaultModelFor } from '../shared/models'
import type { AiEndpointConfig, AiModelCatalog, AiModelChoice, AiProviderId } from '../shared/types'
import { resolveCreds } from './oauth'
import { getSettings, type StoredAiCreds } from './store'

const TTL_MS = 2 * 60 * 1000
const cache = new Map<AiProviderId, { at: number; catalog: AiModelCatalog }>()

export async function listProviderModels(provider: AiProviderId, force = false): Promise<AiModelCatalog> {
  const hit = cache.get(provider)
  if (!force && hit && Date.now() - hit.at < TTL_MS) return hit.catalog
  try {
    const models =
      provider === 'free'
        ? await freeModels()
        : provider === 'grok'
          ? await grokModels(await resolveCreds(provider))
          : provider === 'claude'
            ? await claudeModels(await resolveCreds(provider))
            : provider === 'chatgpt'
              ? await openAiModels(await resolveCreds(provider))
              : await compatModels(provider)
    const catalog = catalogOf(
      provider,
      models.length ? dedupe(models) : fallbackModels(provider),
      models.length > 0
    )
    cache.set(provider, { at: Date.now(), catalog })
    return catalog
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (hit) return { ...hit.catalog, error: message }
    return catalogOf(provider, fallbackModels(provider), false, message)
  }
}

function fallbackModels(provider: AiProviderId): AiModelChoice[] {
  if (AI_MODELS[provider]?.length) return AI_MODELS[provider]
  const id = defaultModelFor(provider, getSettings())
  return id ? [{ id, label: id }] : []
}

function endpointFor(provider: AiProviderId): AiEndpointConfig | null {
  return getSettings().aiEndpoints.find((item) => item.id === provider) ?? findAiSite(provider) ?? null
}

async function compatModels(provider: AiProviderId): Promise<AiModelChoice[]> {
  const endpoint = endpointFor(provider)
  if (!endpoint) throw new Error('Unknown AI provider.')
  const creds = await resolveCreds(provider).catch(() => null)
  const key = creds?.apiKey || creds?.accessToken
  if (endpoint.needsKey && !key) throw new Error(`${endpoint.label} is not connected.`)
  const headers: Record<string, string> = {
    accept: 'application/json',
    ...(endpoint.extraHeaders ?? {})
  }
  if (key) headers.Authorization = `Bearer ${key}`
  const data = await getJson(openAiUrl(endpoint.baseUrl, 'models'), headers)
  return readEntries(data)
    .map((row) => row.id)
    .sort((a, b) => a.localeCompare(b))
    .map((id) => choice(id))
}

function catalogOf(
  provider: AiProviderId,
  models: AiModelChoice[],
  live: boolean,
  error?: string
): AiModelCatalog {
  return { provider, models, live, error }
}

async function freeModels(): Promise<AiModelChoice[]> {
  const res = await fetch('https://text.pollinations.ai/models', {
    headers: { accept: 'application/json', Referer: 'https://pollinations.ai/' },
    signal: AbortSignal.timeout(20_000)
  })
  const data = (await res.json().catch(() => [])) as unknown
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
  const rows = Array.isArray(data) ? data : []
  const models: AiModelChoice[] = []
  const seen = new Set<string>()
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue
    const item = row as { name?: unknown; description?: unknown; aliases?: unknown }
    const id = typeof item.name === 'string' ? item.name : ''
    if (!id || seen.has(id)) continue
    seen.add(id)
    const description = typeof item.description === 'string' ? item.description : ''
    models.push(choice(id, description ? `${description}` : id))
    if (Array.isArray(item.aliases)) {
      for (const alias of item.aliases) {
        if (typeof alias !== 'string' || !alias || seen.has(alias)) continue
        seen.add(alias)
        models.push(choice(alias, description ? `${description} (${alias})` : alias))
      }
    }
  }
  return models
}

async function grokModels(creds: StoredAiCreds): Promise<AiModelChoice[]> {
  const key = creds.apiKey || creds.accessToken
  if (!key) throw new Error('Grok is not connected.')
  const data = await getJson('https://api.x.ai/v1/models', {
    Authorization: `Bearer ${key}`
  })
  return readEntries(data).map((row) => choice(row.id))
}

async function openAiModels(creds: StoredAiCreds): Promise<AiModelChoice[]> {
  const key = creds.apiKey || creds.accessToken
  if (!key) throw new Error('ChatGPT is not connected.')
  const data = await getJson('https://api.openai.com/v1/models', {
    Authorization: `Bearer ${key}`
  })
  return readEntries(data)
    .map((row) => row.id)
    .filter(isOpenAiChatModel)
    .sort((a, b) => b.localeCompare(a))
    .map((id) => choice(id))
}

async function claudeModels(creds: StoredAiCreds): Promise<AiModelChoice[]> {
  const token = creds.apiKey || creds.accessToken
  if (!token) throw new Error('Claude is not connected.')
  const oauth = !creds.apiKey && !!creds.accessToken
  const headers: Record<string, string> = { 'anthropic-version': '2023-06-01' }
  if (oauth) {
    headers.Authorization = `Bearer ${token}`
    headers['anthropic-beta'] = 'oauth-2025-04-20'
  } else {
    headers['x-api-key'] = token
  }
  const models: AiModelChoice[] = []
  let after = ''
  for (let page = 0; page < 10; page++) {
    const url = new URL('https://api.anthropic.com/v1/models')
    url.searchParams.set('limit', '100')
    if (after) url.searchParams.set('after_id', after)
    const data = await getJson(url.toString(), headers)
    const rows = readEntries(data)
    for (const row of rows) models.push(choice(row.id, row.display_name))
    const more = Boolean(data.has_more)
    const last = typeof data.last_id === 'string' ? data.last_id : rows.at(-1)?.id
    if (!more || !last) break
    after = last
  }
  return models
}

function isOpenAiChatModel(id: string): boolean {
  const name = id.toLowerCase()
  if (
    /embed|whisper|tts|dall-e|dalle|moderation|realtime|transcri|audio|image|sora|babbage|davinci|^text-|similarity|^ada|search-/.test(
      name
    )
  ) {
    return false
  }
  return true
}

function choice(id: string, display?: string): AiModelChoice {
  const label = display?.trim() && display.trim() !== id ? `${display.trim()} (${id})` : id
  return { id, label }
}

function dedupe(models: AiModelChoice[]): AiModelChoice[] {
  const seen = new Set<string>()
  const out: AiModelChoice[] = []
  for (const model of models) {
    if (!model.id || seen.has(model.id)) continue
    seen.add(model.id)
    out.push(model)
  }
  return out
}

async function getJson(url: string, headers: Record<string, string>): Promise<Record<string, unknown>> {
  const res = await fetch(url, {
    headers: { ...headers, accept: 'application/json' },
    signal: AbortSignal.timeout(20_000)
  })
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>
  if (!res.ok) {
    const error = data.error as { message?: string } | string | undefined
    const message = typeof error === 'string' ? error : error?.message
    throw new Error(message || `${res.status} ${res.statusText}`)
  }
  return data
}

function readEntries(data: Record<string, unknown>): { id: string; display_name?: string }[] {
  const rows = Array.isArray(data.data) ? data.data : Array.isArray(data.models) ? data.models : []
  const out: { id: string; display_name?: string }[] = []
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue
    const item = row as { id?: unknown; display_name?: unknown; name?: unknown }
    const id = typeof item.id === 'string' ? item.id : typeof item.name === 'string' ? item.name : ''
    if (!id) continue
    out.push({ id, display_name: typeof item.display_name === 'string' ? item.display_name : undefined })
  }
  return out
}
