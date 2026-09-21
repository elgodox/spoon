import type { AiProviderId, ChangeAnalysis } from '../shared/types'
import { fallbackAnalysis, parseAnalysis } from './analysis'
import { changeBrief } from './git'
import { resolveCreds, providerLabel } from './oauth'
import type { StoredAiCreds } from './store'

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

async function complete(
  provider: AiProviderId,
  user: string,
  system: string,
  maxTokens?: number,
  model?: string
): Promise<string> {
  const creds = await resolveCreds(provider)
  if (provider === 'grok') return grokComplete(creds, user, system, maxTokens, model)
  if (provider === 'claude') return claudeComplete(creds, user, system, maxTokens ?? 400, model)
  return chatgptComplete(creds, user, system, maxTokens, model)
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
