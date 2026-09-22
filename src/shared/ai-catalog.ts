import type { AiEndpointConfig } from './types'

export type { AiEndpointConfig }

export const AI_SITE_CATALOG: AiEndpointConfig[] = [
  {
    id: 'openrouter',
    label: 'OpenRouter',
    blurb: 'One key for hundreds of models, including free routes.',
    baseUrl: 'https://openrouter.ai/api/v1',
    defaultModel: 'openai/gpt-4o-mini',
    consoleUrl: 'https://openrouter.ai/keys',
    extraHeaders: {
      'HTTP-Referer': 'https://github.com/elgodox/spoon',
      'X-Title': 'Spoon'
    },
    needsKey: true,
    accent: '#6b4eff'
  },
  {
    id: 'groq',
    label: 'Groq',
    blurb: 'Very fast open models. Free key, no credit card.',
    baseUrl: 'https://api.groq.com/openai/v1',
    defaultModel: 'openai/gpt-oss-20b',
    consoleUrl: 'https://console.groq.com/keys',
    needsKey: true,
    accent: '#f55000'
  },
  {
    id: 'gemini',
    label: 'Google Gemini',
    blurb: 'Gemini Flash on Google AI Studio’s free tier.',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    defaultModel: 'gemini-2.5-flash',
    consoleUrl: 'https://aistudio.google.com/apikey',
    needsKey: true,
    accent: '#1a73e8'
  },
  {
    id: 'mistral',
    label: 'Mistral',
    blurb: 'European open-weight and commercial models.',
    baseUrl: 'https://api.mistral.ai/v1',
    defaultModel: 'mistral-small-latest',
    consoleUrl: 'https://console.mistral.ai/api-keys',
    needsKey: true,
    accent: '#ff7000'
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    blurb: 'Strong coding models at low cost.',
    baseUrl: 'https://api.deepseek.com',
    defaultModel: 'deepseek-chat',
    consoleUrl: 'https://platform.deepseek.com/api_keys',
    needsKey: true,
    accent: '#4d6bfe'
  },
  {
    id: 'together',
    label: 'Together AI',
    blurb: 'Hosted open models with an OpenAI-compatible API.',
    baseUrl: 'https://api.together.xyz/v1',
    defaultModel: 'meta-llama/Llama-3.3-70B-Instruct-Turbo',
    consoleUrl: 'https://api.together.xyz/settings/api-keys',
    needsKey: true,
    accent: '#0f6fff'
  },
  {
    id: 'fireworks',
    label: 'Fireworks',
    blurb: 'Fast inference for Llama, Qwen, DeepSeek, and more.',
    baseUrl: 'https://api.fireworks.ai/inference/v1',
    defaultModel: 'accounts/fireworks/models/llama-v3p3-70b-instruct',
    consoleUrl: 'https://fireworks.ai/account/api-keys',
    needsKey: true,
    accent: '#7c3aed'
  },
  {
    id: 'cerebras',
    label: 'Cerebras',
    blurb: 'Very large open models on a free tier.',
    baseUrl: 'https://api.cerebras.ai/v1',
    defaultModel: 'llama3.1-8b',
    consoleUrl: 'https://cloud.cerebras.ai',
    needsKey: true,
    accent: '#ff6a00'
  },
  {
    id: 'perplexity',
    label: 'Perplexity',
    blurb: 'Sonar models with web-aware answers.',
    baseUrl: 'https://api.perplexity.ai',
    defaultModel: 'sonar',
    consoleUrl: 'https://www.perplexity.ai/settings/api',
    needsKey: true,
    accent: '#22b8cf'
  },
  {
    id: 'cohere',
    label: 'Cohere',
    blurb: 'Command models via the OpenAI-compatible endpoint.',
    baseUrl: 'https://api.cohere.ai/compatibility/v1',
    defaultModel: 'command-r-plus',
    consoleUrl: 'https://dashboard.cohere.com/api-keys',
    needsKey: true,
    accent: '#d13b2f'
  },
  {
    id: 'huggingface',
    label: 'Hugging Face',
    blurb: 'Router for hosted open models.',
    baseUrl: 'https://router.huggingface.co/v1',
    defaultModel: 'Qwen/Qwen2.5-7B-Instruct',
    consoleUrl: 'https://huggingface.co/settings/tokens',
    needsKey: true,
    accent: '#ff9d00'
  },
  {
    id: 'nvidia',
    label: 'NVIDIA NIM',
    blurb: 'Build.nvidia.com models, OpenAI-compatible.',
    baseUrl: 'https://integrate.api.nvidia.com/v1',
    defaultModel: 'meta/llama-3.3-70b-instruct',
    consoleUrl: 'https://build.nvidia.com/settings/api-key',
    needsKey: true,
    accent: '#76b900'
  },
  {
    id: 'ollama',
    label: 'Ollama',
    blurb: 'Local models on this machine. No API key.',
    baseUrl: 'http://127.0.0.1:11434/v1',
    defaultModel: 'llama3.2',
    consoleUrl: 'https://ollama.com/library',
    needsKey: false,
    accent: '#1e1e1e'
  },
  {
    id: 'lmstudio',
    label: 'LM Studio',
    blurb: 'Local OpenAI-compatible server. No API key.',
    baseUrl: 'http://127.0.0.1:1234/v1',
    defaultModel: 'local-model',
    consoleUrl: 'https://lmstudio.ai',
    needsKey: false,
    accent: '#6d5dfc'
  }
]

export function findAiSite(id: string): AiEndpointConfig | undefined {
  return AI_SITE_CATALOG.find((site) => site.id === id)
}

export function openAiUrl(baseUrl: string, path: 'chat/completions' | 'models'): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, '')
  const base = trimmed.replace(/\/(chat\/completions|models)$/i, '')
  return `${base}/${path}`
}

export function customProviderId(label: string, taken: string[]): string {
  const slug = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32) || 'endpoint'
  let id = `custom-${slug}`
  let n = 2
  while (taken.includes(id)) {
    id = `custom-${slug}-${n}`
    n += 1
  }
  return id
}
