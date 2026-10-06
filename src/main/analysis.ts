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

const ORDER_NOTE = 'Adjusted so each commit stays valid on top of the previous one.'

/** Files that must land in the same commit or an earlier one, so a later commit cannot break the previous tree. */
export function fileDependencies(files: ChangeBriefFile[]): Map<string, string[]> {
  const known = new Set(files.map((file) => normalizePath(file.path)))
  const deleted = new Set(files.filter((file) => isDeleted(file.status)).map((file) => normalizePath(file.path)))
  const deps = new Map<string, Set<string>>()
  const add = (file: string, need: string) => {
    if (!file || !need || file === need || !known.has(need)) return
    const set = deps.get(file) ?? new Set<string>()
    set.add(need)
    deps.set(file, set)
  }
  for (const file of files) {
    const path = normalizePath(file.path)
    for (const spec of specsIn(addedText(file.patch))) {
      const target = resolveSpec(path, spec, known)
      if (target) add(path, target)
    }
    for (const spec of specsIn(removedText(file.patch))) {
      const target = resolveSpec(path, spec, deleted)
      if (target) add(target, path)
    }
  }
  return new Map([...deps.entries()].map(([file, set]) => [file, [...set]]))
}

export function repairCommitOrder(analysis: ChangeAnalysis, files: ChangeBriefFile[]): ChangeAnalysis {
  const available = new Set(files.map((file) => normalizePath(file.path)))
  const deps = fileDependencies(files)
  const commits = analysis.commits.map((commit) => ({
    ...commit,
    files: [] as string[]
  }))
  const indexOf = new Map<string, number>()
  analysis.commits.forEach((commit, index) => {
    for (const file of commit.files.map(normalizePath)) {
      if (indexOf.has(file)) continue
      indexOf.set(file, index)
      commits[index].files.push(file)
    }
  })
  const before = commits.map((commit) => commit.files.join('|')).join('||')
  const grown = new Set<number>()
  let guard = 0
  let changed = true
  while (changed && guard++ < files.length * Math.max(commits.length, 1) + 2) {
    changed = false
    for (const [file, needs] of deps) {
      let at = indexOf.get(file)
      if (at == null) continue
      for (const dep of needs) {
        if (!available.has(dep)) continue
        const depAt = indexOf.get(dep)
        if (depAt != null && depAt <= at) continue
        if (depAt != null) commits[depAt].files = commits[depAt].files.filter((item) => item !== dep)
        if (!commits[at].files.includes(dep)) commits[at].files.push(dep)
        indexOf.set(dep, at)
        grown.add(at)
        changed = true
        at = indexOf.get(file) ?? at
      }
    }
  }
  const note = 'Includes changes required for this commit to stay valid.'
  for (const index of grown) {
    if (!commits[index].files.length) continue
    if (!commits[index].rationale.includes(note)) {
      commits[index].rationale = [commits[index].rationale, note].filter(Boolean).join(' ')
    }
  }
  const kept = commits.filter((commit) => commit.files.length)
  const after = kept.map((commit) => commit.files.join('|')).join('||')
  return {
    summary: before === after ? analysis.summary : withOrderNote(analysis.summary),
    commits: kept.length ? kept : analysis.commits
  }
}

function withOrderNote(summary: string): string {
  if (summary.includes(ORDER_NOTE)) return summary
  const base = summary.trim()
  return base ? `${base.endsWith('.') ? base : `${base}.`} ${ORDER_NOTE}` : ORDER_NOTE
}

function isDeleted(status: string): boolean {
  return /(?:^|[\s,])D(?:$|[\s,])/.test(status)
}

function addedText(patch: string): string {
  if (!isDiff(patch)) return patch
  return patch
    .split('\n')
    .filter((line) => line.startsWith('+') && !line.startsWith('+++'))
    .map((line) => line.slice(1))
    .join('\n')
}

function removedText(patch: string): string {
  if (!isDiff(patch)) return ''
  return patch
    .split('\n')
    .filter((line) => line.startsWith('-') && !line.startsWith('---'))
    .map((line) => line.slice(1))
    .join('\n')
}

function isDiff(patch: string): boolean {
  return /(^|\n)(@@|diff |\+\+\+|--- )/m.test(patch)
}

function specsIn(text: string): string[] {
  const specs: string[] = []
  for (const match of text.matchAll(/(?:^|[^\w.])(?:from\s+|import\s*\(\s*|require\(\s*|import\s+)['"](\.[^'"]+)['"]/g)) {
    specs.push(match[1])
  }
  for (const match of text.matchAll(/@import\s+['"](\.[^'"]+)['"]/g)) specs.push(match[1])
  for (const match of text.matchAll(/#include\s*"([^"]+)"/g)) specs.push(match[1])
  for (const match of text.matchAll(/(?:^|\n)\s*from\s+(\.+[\w.]*)\s+import\b/g)) {
    const spec = pythonSpec(match[1])
    if (spec) specs.push(spec)
  }
  return specs
}

function pythonSpec(mod: string): string | null {
  const dots = /^(\.+)/.exec(mod)?.[1].length ?? 0
  if (!dots) return null
  const rest = mod.slice(dots).replace(/\./g, '/')
  const ups = dots - 1
  const prefix = ups === 0 ? '.' : Array.from({ length: ups }, () => '..').join('/')
  return rest ? `${prefix}/${rest}` : prefix
}

function resolveSpec(fromFile: string, spec: string, known: Set<string>): string | null {
  const clean = spec.split('?')[0].replace(/\\/g, '/')
  if (clean.startsWith('.')) {
    const dir = fromFile.includes('/') ? fromFile.slice(0, fromFile.lastIndexOf('/')) : ''
    return matchKnown(normalizeRel(dir ? `${dir}/${clean}` : clean), known)
  }
  const hits = [...known].filter((file) => file === clean || file.endsWith(`/${clean}`))
  return hits.length === 1 ? hits[0] : null
}

function matchKnown(base: string, known: Set<string>): string | null {
  const exts = ['', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts', '.vue', '.svelte', '.py', '.css', '.scss', '.json', '.h', '.hpp']
  for (const ext of exts) {
    if (known.has(base + ext)) return base + ext
  }
  for (const ext of ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.py']) {
    const index = `${base}/index${ext}`
    if (known.has(index)) return index
  }
  return null
}

function normalizeRel(path: string): string {
  const parts: string[] = []
  for (const part of path.replace(/\\/g, '/').split('/')) {
    if (!part || part === '.') continue
    if (part === '..') parts.pop()
    else parts.push(part)
  }
  return parts.join('/')
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
