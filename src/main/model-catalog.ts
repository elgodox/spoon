import { AI_MODELS } from '../shared/models'
import type { AiModelCatalog, AiModelChoice, AiProviderId } from '../shared/types'
import { resolveCreds } from './oauth'
import type { StoredAiCreds } from './store'

const TTL_MS = 2 * 60 * 1000
const cache = new Map<AiProviderId, { at: number; catalog: AiModelCatalog }>()

export async function listProviderModels(provider: AiProviderId, force = false): Promise<AiModelCatalog> {
  const hit = cache.get(provider)
  if (!force && hit && Date.now() - hit.at < TTL_MS) return hit.catalog
  try {
    const creds = await resolveCreds(provider)
    const models =
      provider === 'grok'
        ? await grokModels(creds)
        : provider === 'claude'
          ? await claudeModels(creds)
          : await openAiModels(creds)
    const catalog = catalogOf(provider, models.length ? dedupe(models) : AI_MODELS[provider], models.length > 0)
    cache.set(provider, { at: Date.now(), catalog })
    return catalog
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (hit) return { ...hit.catalog, error: message }
    return catalogOf(provider, AI_MODELS[provider], false, message)
  }
}

function catalogOf(
  provider: AiProviderId,
  models: AiModelChoice[],
  live: boolean,
  error?: string
): AiModelCatalog {
  return { provider, models, live, error }
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
