import { findAiSite, openAiUrl } from '../shared/ai-catalog'
import { freeAiModelId } from '../shared/models'
import type { AiEndpointConfig, AiProviderId, ChangeAnalysis } from '../shared/types'
import { fallbackAnalysis, parseAnalysis } from './analysis'
import { changeBrief } from './git'
import { providerLabel, resolveCreds } from './oauth'
import { getSettings, type StoredAiCreds } from './store'

const SYSTEM = `You write Git commit messages for a desktop Git client.
Rules:
- First line: imperative subject, max 72 characters, no trailing period.
- Optional body after a blank line, wrapping near 72 chars, explaining why.
- Prefer Conventional Commits (feat, fix, refactor, docs, test, chore, style, perf) when it fits.
- Never wrap the message in quotes or markdown fences.
- Do not mention you are an AI.`

const ANALYZE_SYSTEM = `You split uncommitted Git changes into separate local commits, one per implementation.
Return JSON only, with no markdown fences:
{"summary":"short paragraph","commits":[{"subject":"imperative, max 72 chars","body":"why","files":["relative/path"],"rationale":"one sentence"}]}
Rules:
- Every listed file appears in exactly one commit.
- Group files that implement the same feature, fix, or refactor.
- Do not invent paths.
- Order commits so later ones can build on earlier ones.
- Do not mention pushing or that you are an AI.`

export async function generateCommitMessage(
  provider: AiProviderId,
  diff: string,
  extra?: string,
  model?: string
): Promise<string> {
  const snippet = diff.length > 24_000 ? diff.slice(0, 24_000) + '\n\n[diff truncated]' : diff
  if (!snippet.trim()) throw new Error('Nothing to commit. Stage changes first.')
  const user = `Write a commit message for this diff.\n${extra ? `\nContext: ${extra}\n` : ''}\n${snippet}`
  return complete(provider, user, SYSTEM, undefined, model)
}

export async function analyzeRepository(provider: AiProviderId, cwd: string, model?: string): Promise<ChangeAnalysis> {
  const files = await changeBrief(cwd)
  if (!files.length) throw new Error('No local changes to analyze.')
  const known = files.map((file) => file.path)
  const listing = files
    .map((file, index) => {
      const body = index < 30 ? file.patch : `(${file.status}, patch omitted)`
      return `### ${file.path} (${file.status})\n${body}`
    })
    .join('\n\n')
  const clipped = listing.length > 24_000 ? listing.slice(0, 24_000) + '\n\n[truncated]' : listing
  const user = `Group these uncommitted changes into one commit per implementation.\n\n${clipped}`
  try {
    const text = await complete(provider, user, ANALYZE_SYSTEM, 1600, model)
    return parseAnalysis(text, known)
  } catch (error) {
    const fallback = fallbackAnalysis(files)
    const reason = error instanceof Error ? error.message : String(error)
    return {
      ...fallback,
      summary: `${fallback.summary} AI grouping was not used (${reason}).`
    }
  }
}

function endpointFor(provider: AiProviderId): AiEndpointConfig | null {
  if (provider === 'chatgpt') {
    return {
      id: 'chatgpt',
      label: 'ChatGPT',
      baseUrl: 'https://api.openai.com/v1',
      defaultModel: 'gpt-4o',
      needsKey: true,
      consoleUrl: 'https://platform.openai.com/api-keys'
    }
  }
  return getSettings().aiEndpoints.find((item) => item.id === provider) ?? findAiSite(provider) ?? null
}

async function complete(
  provider: AiProviderId,
  user: string,
  system: string,
  maxTokens?: number,
  model?: string
): Promise<string> {
  if (provider === 'free') return freeComplete(user, system, maxTokens, model)
  try {
    const creds = await resolveCreds(provider)
    if (provider === 'grok') return grokComplete(creds, user, system, maxTokens, model)
    if (provider === 'claude') return claudeComplete(creds, user, system, maxTokens ?? 400, model)
    if (provider === 'chatgpt') return chatgptComplete(creds, user, system, maxTokens, model)
    const endpoint = endpointFor(provider)
    if (endpoint) return compatComplete(creds, endpoint, user, system, maxTokens, model)
    return chatgptComplete(creds, user, system, maxTokens, model)
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    if (/not connected|Connect /i.test(reason)) return freeComplete(user, system, maxTokens, model)
    throw error
  }
}

async function compatComplete(
  creds: StoredAiCreds,
  endpoint: AiEndpointConfig,
  user: string,
  system: string,
  maxTokens?: number,
  model = endpoint.defaultModel
): Promise<string> {
  const key = creds.apiKey || creds.accessToken
  if (endpoint.needsKey && !key) throw new Error(`${endpoint.label} is not connected.`)
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    ...(endpoint.extraHeaders ?? {})
  }
  if (key) headers.Authorization = `Bearer ${key}`
  const res = await fetch(openAiUrl(endpoint.baseUrl, 'chat/completions'), {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: model || endpoint.defaultModel,
      temperature: 0.2,
      ...(maxTokens ? { max_tokens: maxTokens } : {}),
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user }
      ]
    }),
    signal: AbortSignal.timeout(45_000)
  })
  const data = (await res.json().catch(() => ({}))) as {
    error?: { message?: string } | string
    choices?: { message?: { content?: string } }[]
  }
  if (!res.ok) {
    const err = data.error
    const message = typeof err === 'string' ? err : err?.message || `${res.status} ${res.statusText}`
    throw new Error(message)
  }
  const text = data.choices?.[0]?.message?.content?.trim()
  if (text) return cleanMessage(text)
  throw new Error(`${endpoint.label} returned an empty response.`)
}

async function freeComplete(
  user: string,
  system = SYSTEM,
  maxTokens?: number,
  model = 'openai'
): Promise<string> {
  const messages = [
    { role: 'system', content: system },
    { role: 'user', content: user }
  ]
  const chosen = freeAiModelId(model)
  const shared = {
    temperature: 0.2,
    ...(maxTokens ? { max_tokens: maxTokens } : {}),
    messages
  }
  // gen.pollinations.ai now requires a key. Anonymous text.pollinations.ai and llm7 still complete.
  const attempts: { url: string; headers: Record<string, string>; body: Record<string, unknown> }[] = [
    {
      url: 'https://text.pollinations.ai/openai',
      headers: {},
      body: { ...shared, model: chosen }
    },
    {
      url: 'https://api.llm7.io/v1/chat/completions',
      headers: { Authorization: 'Bearer unused' },
      body: { ...shared, model: 'default' }
    }
  ]
  const errors: string[] = []
  for (const attempt of attempts) {
    try {
      const res = await fetch(attempt.url, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          ...attempt.headers
        },
        body: JSON.stringify(attempt.body),
        signal: AbortSignal.timeout(45_000)
      })
      const data = (await res.json().catch(() => ({}))) as {
        error?: { message?: string } | string
      }
      if (!res.ok) {
        const err = data.error
        errors.push(typeof err === 'string' ? err : err?.message || `${res.status} ${res.statusText}`)
        continue
      }
      const text = completionText(data)
      if (text) return cleanMessage(text)
      errors.push('Empty Free AI response')
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error))
    }
  }
  const fallback = await pollinationsGetFallback(system, user, chosen)
  if (fallback) return cleanMessage(fallback)
  const first = errors[0] || 'No response'
  throw new Error(
    `Free AI could not generate a commit message. ${first} Add OpenRouter in Preferences → AI (https://openrouter.ai) and create a free account.`
  )
}

async function pollinationsGetFallback(system: string, user: string, model: string): Promise<string> {
  try {
    const prompt = `${system}\n\n${user}`.slice(0, 1200)
    const url = `https://text.pollinations.ai/${encodeURIComponent(prompt)}?model=${encodeURIComponent(model)}`
    const res = await fetch(url, {
      headers: { Accept: 'text/plain, application/json' },
      signal: AbortSignal.timeout(45_000)
    })
    const raw = (await res.text()).trim()
    if (!res.ok || !raw || raw.startsWith('<')) return ''
    if (raw.startsWith('{')) {
      try {
        return completionText(JSON.parse(raw) as object)
      } catch {
        return ''
      }
    }
    return raw
  } catch {
    return ''
  }
}

function completionText(data: unknown): string {
  if (!data || typeof data !== 'object') return ''
  const message = (data as { choices?: { message?: { content?: unknown } }[] }).choices?.[0]?.message
  const content = message?.content
  if (typeof content === 'string') return content.trim()
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') return part
        if (part && typeof part === 'object' && typeof (part as { text?: unknown }).text === 'string') {
          return (part as { text: string }).text
        }
        return ''
      })
      .join('')
      .trim()
  }
  return ''
}

async function grokComplete(
  creds: StoredAiCreds,
  user: string,
  system = SYSTEM,
  maxTokens?: number,
  model = 'grok-4.7'
): Promise<string> {
  const key = creds.apiKey || creds.accessToken
  if (!key) throw new Error('Grok is not connected.')
  const models = [model]
  let last = ''
  for (const model of models) {
    const res = await fetch('https://api.x.ai/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        ...(maxTokens ? { max_tokens: maxTokens } : {}),
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user }
        ]
      })
    })
    if (res.status === 404) throw new Error(`Grok model "${model}" is not available. Pick another model.`)
    const data = (await res.json()) as {
      error?: { message?: string }
      choices?: { message?: { content?: string } }[]
    }
    if (!res.ok) {
      last = data.error?.message || res.statusText
      throw new Error(last)
    }
    const text = data.choices?.[0]?.message?.content?.trim()
    if (text) return cleanMessage(text)
    last = 'Empty Grok response'
  }
  throw new Error(last || 'Grok could not generate a commit message.')
}

async function chatgptComplete(
  creds: StoredAiCreds,
  user: string,
  system = SYSTEM,
  maxTokens?: number,
  model = 'gpt-4o'
): Promise<string> {
  const key = creds.apiKey || creds.accessToken
  if (!key) throw new Error('ChatGPT is not connected.')
  const models = [model]
  let last = ''
  for (const model of models) {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        ...(maxTokens ? { max_tokens: maxTokens } : {}),
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user }
        ]
      })
    })
    if (res.status === 404) throw new Error(`ChatGPT model "${model}" is not available. Pick another model.`)
    const data = (await res.json()) as {
      error?: { message?: string }
      choices?: { message?: { content?: string } }[]
    }
    if (!res.ok) {
      last = data.error?.message || res.statusText
      if (res.status === 401 || res.status === 403) {
        throw new Error(
          `${last} ChatGPT OAuth sessions imported from Codex may require an OpenAI API key from platform.openai.com.`
        )
      }
      throw new Error(last)
    }
    const text = data.choices?.[0]?.message?.content?.trim()
    if (text) return cleanMessage(text)
  }
  throw new Error(last || 'ChatGPT could not generate a commit message.')
}

async function claudeComplete(
  creds: StoredAiCreds,
  user: string,
  system = SYSTEM,
  maxTokens = 400,
  model = 'claude-sonnet-4-5'
): Promise<string> {
  const token = creds.apiKey || creds.accessToken
  if (!token) throw new Error('Claude is not connected.')
  const models = [model]
  const oauth = !creds.apiKey && !!creds.accessToken
  let last = ''
  for (const model of models) {
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      'anthropic-version': '2023-06-01'
    }
    if (oauth) {
      headers.Authorization = `Bearer ${token}`
      headers['anthropic-beta'] = 'oauth-2025-04-20'
    } else {
      headers['x-api-key'] = token
    }
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        system,
        messages: [{ role: 'user', content: user }]
      })
    })
    if (res.status === 404) throw new Error(`Claude model "${model}" is not available. Pick another model.`)
    const data = (await res.json()) as {
      error?: { message?: string }
      content?: { type: string; text?: string }[]
    }
    if (!res.ok) {
      last = data.error?.message || res.statusText
      if (res.status === 401 || res.status === 403) throw new Error(last)
      continue
    }
    const text = data.content?.find((c) => c.type === 'text')?.text?.trim()
    if (text) return cleanMessage(text)
  }
  throw new Error(last || 'Claude could not generate a commit message.')
}

function cleanMessage(text: string): string {
  return text
    .replace(/^```[a-z]*\n?/i, '')
    .replace(/```$/i, '')
    .replace(/^["']|["']$/g, '')
    .trim()
}

export { providerLabel }
