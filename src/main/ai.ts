import { findAiSite, openAiUrl } from '../shared/ai-catalog'
import type { AiEndpointConfig, AiProviderId, ChangeAnalysis, ChangeBriefFile, RepoSummary, WorkspaceAnalysis } from '../shared/types'
import { fallbackWorkspaceAnalysis, parseWorkspaceAnalysis } from '../shared/workspaces'
import { fallbackAnalysis, fileDependencies, parseAnalysis, repairCommitOrder } from './analysis'
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
- Order commits so each one still works on top of the commits before it.
- A file that uses a new or changed file, symbol, or API belongs in the same commit or a later one.
- Do not delete a file before the other changes that stop using it.
- Do not mention pushing or that you are an AI.`

const REVIEW_SYSTEM = `You review a proposed sequence of local Git commits and fix any sequence that would break an intermediate tree.
Return JSON only, with no markdown fences:
{"summary":"short paragraph","commits":[{"subject":"imperative, max 72 chars","body":"why","files":["relative/path"],"rationale":"one sentence"}]}
Rules:
- Every listed file appears in exactly one commit.
- Do not invent paths.
- Checking out any prefix of the sequence must stay consistent. A change that uses a file, symbol, type, or API introduced or changed by another change must be in the same commit or a later one.
- A deletion or rename must not land before the other changed files that still reference it are updated.
- Merge commits when splitting them would break the previous commit. Keep them separate when each prefix stays valid.
- Rewrite subjects and bodies so they match the final groups.
- Do not mention pushing or that you are an AI.`

const WORKSPACE_SYSTEM = `You organize Git repositories into named workspaces for a desktop Git client.
Return JSON only, with no markdown fences:
{"summary":"short paragraph","workspaces":[{"name":"short label","repos":["exact/path or repo name"],"rationale":"one sentence"}]}
Rules:
- Group related repositories that a developer would open together (same product, monorepo siblings, client+api, shared folder, matching name prefixes).
- Prefer 2–8 repositories per workspace when possible.
- A repository may appear in at most one workspace.
- Use exact paths from the list when possible; repo names are allowed when unique.
- Do not invent repositories that are not listed.
- Name workspaces clearly (product, team, or folder theme), max 40 characters.
- Skip lonely repositories unless every repo is alone.
- Do not mention that you are an AI.`

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

const STASH_SYSTEM = `You name Git stashes for a desktop Git client.
Rules:
- Reply with one line only: a short description of the work in progress, max 60 characters.
- Start with a lowercase verb or noun phrase, no trailing period.
- Do not use quotes, markdown, prefixes like "WIP:" or "stash:", or mention you are an AI.`

/** A short label for `git stash push -m`, from the working changes (optionally limited to some paths). */
export async function generateStashMessage(
  provider: AiProviderId,
  cwd: string,
  model?: string,
  paths?: string[]
): Promise<string> {
  const all = await changeBrief(cwd)
  const wanted = paths?.length ? new Set(paths.map((p) => p.replace(/\\/g, '/'))) : null
  const files = wanted ? all.filter((file) => wanted.has(file.path)) : all
  if (!files.length) throw new Error('No local changes to stash.')
  const text = await complete(provider, `Name a stash holding these uncommitted changes.\n\n${briefListing(files, 12_000)}`, STASH_SYSTEM, 120, model)
  const line = text.split('\n').map((l) => l.trim()).find(Boolean) ?? ''
  return line.replace(/^["'`]+|["'`.]+$/g, '').slice(0, 72)
}

export async function analyzeRepository(
  provider: AiProviderId,
  cwd: string,
  model?: string,
  scope: 'all' | 'staged' = 'all'
): Promise<ChangeAnalysis> {
  const all = await changeBrief(cwd)
  const scoped = scope === 'staged' ? all.filter((file) => file.status.includes('staged')) : all
  if (!scoped.length) {
    throw new Error(scope === 'staged' ? 'No staged changes to analyze.' : 'No local changes to analyze.')
  }
  const known = scoped.map((file) => file.path)
  const kind = scope === 'staged' ? 'staged' : 'uncommitted'
  let analysis: ChangeAnalysis
  try {
    const text = await complete(
      provider,
      `Group these ${kind} changes into one commit per implementation.\n\n${briefListing(scoped)}`,
      ANALYZE_SYSTEM,
      1600,
      model
    )
    analysis = parseAnalysis(text, known)
  } catch (error) {
    const fallback = fallbackAnalysis(scoped)
    const reason = error instanceof Error ? error.message : String(error)
    analysis = {
      ...fallback,
      summary: `${fallback.summary} AI grouping was not used (${reason}).`
    }
  }
  analysis = repairCommitOrder(analysis, all)
  const involved = [...new Set(analysis.commits.flatMap((commit) => commit.files))]
  if (involved.length < 2) return analysis
  const related = all.filter((file) => involved.includes(file.path.replace(/\\/g, '/').replace(/^\.\//, '')))
  const depText = [...fileDependencies(related).entries()]
    .filter(([, needs]) => needs.length)
    .map(([file, needs]) => `- ${file} needs ${needs.join(', ')} in the same commit or earlier`)
    .join('\n')
  const proposed = JSON.stringify({ summary: analysis.summary, commits: analysis.commits })
  try {
    const text = await complete(
      provider,
      `Review this commit sequence. Reorder or merge commits so none of them breaks the tree left by the previous commit.\n\nProposed:\n${proposed}\n\nDependencies:\n${depText || '(none detected from imports)'}\n\nChanges:\n${briefListing(related, 16_000)}`,
      REVIEW_SYSTEM,
      1800,
      model
    )
    analysis = repairCommitOrder(parseAnalysis(text, involved), all)
  } catch {
    // The local order repair still keeps imports and deletions from breaking the previous commit.
  }
  return analysis
}

function briefListing(files: ChangeBriefFile[], limit = 24_000): string {
  const listing = files
    .map((file, index) => {
      const body = index < 30 ? file.patch : `(${file.status}, patch omitted)`
      return `### ${file.path} (${file.status})\n${body}`
    })
    .join('\n\n')
  return listing.length > limit ? listing.slice(0, limit) + '\n\n[truncated]' : listing
}

export async function analyzeWorkspaces(
  provider: AiProviderId,
  repos: Pick<RepoSummary, 'path' | 'name'>[],
  model?: string
): Promise<WorkspaceAnalysis> {
  if (repos.length < 2) throw new Error('Add at least two repositories before analyzing workspaces.')
  const listing = repos
    .slice(0, 200)
    .map((repo) => {
      const parent = repo.path.replace(/\\/g, '/').replace(/\/[^/]+$/, '') || repo.path
      return `- ${repo.name} | ${repo.path} | folder: ${parent.split('/').pop() || parent}`
    })
    .join('\n')
  const clipped = listing.length > 20_000 ? listing.slice(0, 20_000) + '\n\n[truncated]' : listing
  const user = `Group these repositories into workspaces a developer would open together.\n\n${clipped}`
  try {
    const text = await complete(provider, user, WORKSPACE_SYSTEM, 1800, model)
    return parseWorkspaceAnalysis(text, repos)
  } catch (error) {
    const fallback = fallbackWorkspaceAnalysis(repos)
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
  if (provider === 'free') throw new Error('Connect an AI provider in Preferences → AI.')
  const creds = await resolveCreds(provider)
  if (provider === 'grok') return grokComplete(creds, user, system, maxTokens, model)
  if (provider === 'claude') return claudeComplete(creds, user, system, maxTokens ?? 400, model)
  if (provider === 'chatgpt') return chatgptComplete(creds, user, system, maxTokens, model)
  const endpoint = endpointFor(provider)
  if (endpoint) return compatComplete(creds, endpoint, user, system, maxTokens, model)
  return chatgptComplete(creds, user, system, maxTokens, model)
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
