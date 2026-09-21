import type { AiProviderId } from './types'

export const AI_MODELS: Record<AiProviderId, { id: string; label: string }[]> = {
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

export const DEFAULT_AI_MODELS: Record<AiProviderId, string> = {
  grok: 'grok-4.7',
  chatgpt: 'gpt-4o',
  claude: 'claude-sonnet-4-5'
}
