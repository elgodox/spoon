import { AI_SITE_CATALOG, findAiSite } from './ai-catalog'
import type { AiEndpointConfig, AiProviderId, Settings } from './types'

export const BUILTIN_AI_IDS: AiProviderId[] = ['free', 'grok', 'chatgpt', 'claude']
export const AI_PROVIDER_IDS = BUILTIN_AI_IDS
export const PAID_AI_PROVIDERS: AiProviderId[] = ['grok', 'chatgpt', 'claude']

/** Anonymous Pollinations text models (and aliases). Anything else 404s. */
export const FREE_AI_MODEL_IDS = ['openai', 'openai-fast', 'gpt-oss', 'gpt-oss-20b', 'ovh-reasoning'] as const

export function isFreeAiModel(id: string): boolean {
  return (FREE_AI_MODEL_IDS as readonly string[]).includes(id.trim())
}

export function freeAiModelId(model?: string): string {
  const id = (model || 'openai').trim()
  if (id === 'openai-fast') return 'openai-fast'
  return 'openai'
}

export const AI_MODELS: Record<string, { id: string; label: string }[]> = {
  free: [
    { id: 'openai', label: 'Free (GPT-OSS 20B)' },
    { id: 'openai-fast', label: 'Free fast' }
  ],
  grok: [
    { id: 'grok-4.7', label: 'Grok 4.7' },
    { id: 'grok-4.6', label: 'Grok 4.6' },
    { id: 'grok-4.5', label: 'Grok 4.5' },
    { id: 'grok-4', label: 'Grok 4' },
    { id: 'grok-3', label: 'Grok 3' }
  ],
  chatgpt: [
    { id: 'gpt-4o', label: 'GPT-4o' },
    { id: 'gpt-4.1', label: 'GPT-4.1' },
    { id: 'gpt-4.1-mini', label: 'GPT-4.1 mini' },
    { id: 'gpt-4o-mini', label: 'GPT-4o mini' }
  ],
  claude: [
    { id: 'claude-sonnet-4-5', label: 'Claude Sonnet 4.5' },
    { id: 'claude-opus-4-8', label: 'Claude Opus 4.8' },
    { id: 'claude-sonnet-4-20250514', label: 'Claude Sonnet 4' },
    { id: 'claude-3-5-sonnet-latest', label: 'Claude 3.5 Sonnet' }
  ]
}

export const DEFAULT_AI_MODELS: Record<string, string> = {
  free: 'openai',
  grok: 'grok-4.7',
  chatgpt: 'gpt-4o',
  claude: 'claude-sonnet-4-5'
}

export function listedProviderIds(settings?: Settings | null): AiProviderId[] {
  const extra = settings?.aiEndpoints?.map((item) => item.id) ?? []
  return [...BUILTIN_AI_IDS, ...extra.filter((id) => !BUILTIN_AI_IDS.includes(id))]
}

export function defaultModelFor(id: AiProviderId, settings?: Settings | null): string {
  const saved = settings?.aiModels?.[id]
  if (saved) {
    if (id === 'free' && !isFreeAiModel(saved)) return DEFAULT_AI_MODELS.free
    return saved
  }
  if (DEFAULT_AI_MODELS[id]) return DEFAULT_AI_MODELS[id]
  const endpoint = settings?.aiEndpoints?.find((item) => item.id === id) ?? findAiSite(id)
  return endpoint?.defaultModel || 'gpt-4o-mini'
}

export function providerLabel(id: AiProviderId, endpoints: AiEndpointConfig[] = []): string {
  if (id === 'free') return 'Free AI'
  if (id === 'grok') return 'Grok'
  if (id === 'claude') return 'Claude'
  if (id === 'chatgpt') return 'ChatGPT'
  const site = findAiSite(id) ?? AI_SITE_CATALOG.find((item) => item.id === id)
  if (site) return site.label
  const custom = endpoints.find((item) => item.id === id)
  if (custom) return custom.label
  return id
}
