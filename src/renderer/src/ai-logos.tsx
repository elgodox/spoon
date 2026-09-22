import cerebras from './assets/ai/cerebras.svg?url'
import claude from './assets/ai/claude.svg?url'
import cohere from './assets/ai/cohere.svg?url'
import deepseek from './assets/ai/deepseek.svg?url'
import fireworks from './assets/ai/fireworks.svg?url'
import gemini from './assets/ai/gemini.svg?url'
import grok from './assets/ai/grok.svg?url'
import groq from './assets/ai/groq.svg?url'
import huggingface from './assets/ai/huggingface.svg?url'
import lmstudio from './assets/ai/lmstudio.svg?url'
import mistral from './assets/ai/mistral.svg?url'
import nvidia from './assets/ai/nvidia.svg?url'
import ollama from './assets/ai/ollama.svg?url'
import openai from './assets/ai/openai.svg?url'
import openrouter from './assets/ai/openrouter.svg?url'
import perplexity from './assets/ai/perplexity.svg?url'
import pollinations from './assets/ai/pollinations.svg?url'
import together from './assets/ai/together.svg?url'

const LOGOS: Record<string, string> = {
  free: pollinations,
  grok,
  chatgpt: openai,
  claude,
  openrouter,
  groq,
  gemini,
  mistral,
  deepseek,
  together,
  fireworks,
  cerebras,
  perplexity,
  cohere,
  huggingface,
  nvidia,
  ollama,
  lmstudio
}

export function ProviderIcon({ id, label }: { id: string; label: string }) {
  const src = LOGOS[id]
  if (!src) {
    return (
      <svg viewBox="0 0 24 24" className="ai-logo" aria-hidden="true">
        <title>{label}</title>
        <path
          fill="currentColor"
          d="M7 7h4v2H9v6h2v2H7V7zm6 0h4a2 2 0 012 2v2a2 2 0 01-2 2h-2v4h-2V7zm2 2v2h2V9h-2z"
        />
      </svg>
    )
  }
  return <img className="ai-logo" src={src} alt="" draggable={false} />
}
