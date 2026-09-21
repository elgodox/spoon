import type { ChangeAnalysis, ChangeBriefFile, PlannedCommit } from '../shared/types'

export function parseAnalysis(text: string, knownFiles: string[]): ChangeAnalysis {
  const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/```$/i, '').trim()
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  if (start < 0 || end <= start) throw new Error('The analysis was not JSON.')
  const data = JSON.parse(cleaned.slice(start, end + 1)) as {
    summary?: string
    commits?: { subject?: string; body?: string; files?: unknown; rationale?: string }[]
  }
  const known = new Set(knownFiles.map(normalizePath))
  const used = new Set<string>()
  const commits: PlannedCommit[] = []
  for (const item of data.commits ?? []) {
    const files = asFiles(item.files).filter((file) => known.has(file) && !used.has(file))
    for (const file of files) used.add(file)
    const subject = (item.subject ?? '').trim().replace(/\s+/g, ' ')
    if (!files.length || !subject) continue
    commits.push({
      subject: subject.slice(0, 72),
      body: (item.body ?? '').trim(),
      files,
      rationale: (item.rationale ?? '').trim()
    })
  }
  const left = knownFiles.map(normalizePath).filter((file) => !used.has(file))
  if (left.length) {
    commits.push({
      subject: 'chore: include remaining changes',
      body: '',
      files: left,
      rationale: 'Files the analysis did not assign.'
    })
  }
  if (!commits.length) throw new Error('The analysis did not name any commits.')
  return {
    summary: (data.summary ?? '').trim() || `${commits.length} proposed commit${commits.length === 1 ? '' : 's'}.`,
    commits
  }
}

export function fallbackAnalysis(files: ChangeBriefFile[]): ChangeAnalysis {
  const groups = new Map<string, ChangeBriefFile[]>()
  for (const file of files) {
    const parts = normalizePath(file.path).split('/')
    const key = parts.length > 1 ? parts.slice(0, Math.min(2, parts.length - 1)).join('/') : 'root'
    const list = groups.get(key) ?? []
    list.push(file)
    groups.set(key, list)
  }
  const commits = [...groups.entries()].map(([key, list]) => ({
    subject: subjectFor(key, list),
    body: list.map((file) => `- ${file.status} ${normalizePath(file.path)}`).join('\n'),
    files: list.map((file) => normalizePath(file.path)),
    rationale: key === 'root' ? 'Files at the repository root.' : `Changes under ${key}.`
  }))
  return {
    summary: `${files.length} changed file${files.length === 1 ? '' : 's'} in ${commits.length} group${commits.length === 1 ? '' : 's'}, split by folder.`,
    commits
  }
}

function subjectFor(key: string, files: ChangeBriefFile[]): string {
  const area = key === 'root' ? 'project' : key.split('/').pop() || key
  const statuses = files.map((file) => file.status.toLowerCase()).join(' ')
  const kind = statuses.includes('untracked')
    ? 'feat'
    : /\.(md|txt)$/i.test(files.map((file) => file.path).join(' '))
      ? 'docs'
      : statuses.includes('d')
        ? 'refactor'
        : 'chore'
  const name = files.length === 1 ? normalizePath(files[0].path).split('/').pop() : area
  return `${kind}(${area}): update ${name}`.slice(0, 72)
}

function asFiles(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string').map(normalizePath)
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\.\//, '')
}
