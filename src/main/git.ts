import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { homedir } from 'node:os'
import type {
  BlameLine,
  BranchInfo,
  ChangeBriefFile,
  CloneOptions,
  CommitInfo,
  CommitOptions,
  ConflictFile,
  DiffHunk,
  DiffLine,
  FetchOptions,
  FileDiff,
  FileTreeNode,
  MediaPair,
  MediaSide,
  PullOptions,
  PushOptions,
  RefLabel,
  RemoteInfo,
  RepoFixId,
  RepoHealth,
  RepoIssue,
  RepoOverview,
  RepoStatus,
  StashInfo,
  StatusEntry,
  SubmoduleInfo,
  TagInfo
} from '../shared/types'
import { dayKeyFromUnix } from '../shared/activity'
import { classifyMedia } from '../shared/media'
import { layoutGraph } from './graph'

const IMAGE_EXT = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.jfif',
  '.gif',
  '.webp',
  '.bmp',
  '.ico',
  '.svg',
  '.svgz',
  '.avif',
  '.apng',
  '.tif',
  '.tiff',
  '.tga',
  '.heic',
  '.heif'
])

export interface GitResult {
  stdout: string
  stderr: string
  code: number
}

let gitExe = 'git'

export function setGitPath(path?: string): void {
  gitExe = path && existsSync(path) ? path : 'git'
}

export async function findGit(): Promise<string> {
  const candidates = [
    gitExe,
    'git',
    join(process.env['ProgramFiles'] ?? 'C:\\Program Files', 'Git', 'cmd', 'git.exe'),
    join(process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)', 'Git', 'cmd', 'git.exe'),
    join(homedir(), 'AppData', 'Local', 'Programs', 'Git', 'cmd', 'git.exe')
  ]
  for (const c of candidates) {
    try {
      const r = await runGitRaw(undefined, ['--version'], { git: c })
      if (r.code === 0) {
        gitExe = c
        return c
      }
    } catch {
      /* try next */
    }
  }
  throw new Error('Git was not found. Install Git for Windows and restart Spoon.')
}

function runGitRaw(
  cwd: string | undefined,
  args: string[],
  opts?: { stdin?: string; git?: string; env?: NodeJS.ProcessEnv; timeoutMs?: number }
): Promise<GitResult> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(opts?.git ?? gitExe, args, {
      cwd,
      windowsHide: true,
      env: {
        ...process.env,
        ...opts?.env,
        GIT_OPTIONAL_LOCKS: '0',
        GIT_TERMINAL_PROMPT: '0',
        LANG: 'en_US.UTF-8',
        LC_ALL: 'C.UTF-8'
      }
    })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (d) => {
      stdout += d
    })
    child.stderr.on('data', (d) => {
      stderr += d
    })
    if (opts?.stdin != null) {
      child.stdin.write(opts.stdin)
      child.stdin.end()
    } else {
      child.stdin.end()
    }
    let timedOut = false
    const killer = opts?.timeoutMs
      ? setTimeout(() => {
          timedOut = true
          child.kill()
        }, opts.timeoutMs)
      : null
    child.on('error', (err) => {
      if (killer) clearTimeout(killer)
      reject(err)
    })
    child.on('close', (code) => {
      if (killer) clearTimeout(killer)
      resolvePromise({ stdout, stderr: timedOut ? `${stderr}\ntimed out` : stderr, code: timedOut ? 124 : (code ?? 1) })
    })
  })
}

export async function git(
  cwd: string,
  args: string[],
  opts?: { stdin?: string; allowFail?: boolean; env?: NodeJS.ProcessEnv; timeoutMs?: number }
): Promise<GitResult> {
  const r = await runGitRaw(cwd, ['-c', 'core.quotepath=false', '-c', 'i18n.logoutputencoding=utf-8', ...args], opts)
  if (r.code !== 0 && !opts?.allowFail) {
    const msg = (r.stderr || r.stdout || `git ${args.join(' ')} failed`).trim()
    const err = new Error(msg)
    ;(err as Error & { result: GitResult }).result = r
    throw err
  }
  return r
}

const SCAN_SKIP = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  'out',
  '.next',
  '.nuxt',
  '.cache',
  'vendor',
  'target',
  'bin',
  'obj',
  '$recycle.bin',
  'system volume information',
  'windows',
  'program files',
  'program files (x86)',
  'programdata',
  'appdata',
  'application data'
])

export async function scanRepos(
  roots: string[],
  onProgress?: (info: { found: number; looking: string }) => void
): Promise<{ path: string; name: string }[]> {
  const found: { path: string; name: string }[] = []
  const seen = new Set<string>()
  const readLimit = limiter(24)
  let lastProgress = 0

  const progress = (looking: string) => {
    const now = Date.now()
    if (now - lastProgress < 80) return
    lastProgress = now
    onProgress?.({ found: found.length, looking })
  }

  function addFound(dir: string): void {
    const full = resolve(dir)
    const key = full.toLowerCase()
    if (seen.has(key)) return
    seen.add(key)
    found.push({ path: full, name: basename(full) })
    onProgress?.({ found: found.length, looking: full })
  }

  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > 8) return
    progress(dir)
    let entries
    try {
      entries = await readLimit(() => readdir(dir, { withFileTypes: true }))
    } catch {
      return
    }
    if (entries.some((entry) => entry.name === '.git')) {
      // Checking the folder name is enough; resolving the real root costs a git spawn per repo.
      addFound(dir)
      return
    }
    await Promise.all(
      entries
        .filter(
          (entry) =>
            entry.isDirectory() &&
            !entry.isSymbolicLink() &&
            !entry.name.startsWith('.') &&
            !SCAN_SKIP.has(entry.name.toLowerCase())
        )
        .map((entry) => walk(join(dir, entry.name), depth + 1))
    )
  }

  await Promise.all(
    roots.filter((root) => root && existsSync(root)).map(async (root) => {
      const resolved = resolve(root)
      if (await isRepo(resolved)) {
        const top = await repoRoot(resolved)
        if (top.toLowerCase() === resolved.toLowerCase()) {
          addFound(top)
          return
        }
      }
      return walk(resolved, 0)
    })
  )
  found.sort((a, b) => a.name.localeCompare(b.name))
  return found
}

export function limiter(max: number) {
  let active = 0
  const queue: (() => void)[] = []
  return async function run<T>(fn: () => Promise<T>): Promise<T> {
    if (active >= max) await new Promise<void>((r) => queue.push(r))
    active++
    try {
      return await fn()
    } finally {
      active--
      queue.shift()?.()
    }
  }
}

export async function isRepo(path: string): Promise<boolean> {
  if (!path || !existsSync(path)) return false
  const r = await git(path, ['rev-parse', '--is-inside-work-tree'], { allowFail: true })
  return r.code === 0 && r.stdout.trim() === 'true'
}

/** One `git rev-parse` for everything opening a repository needs. */
export async function repoInfo(path: string): Promise<{ root: string; gitDir: string } | null> {
  if (!path || !existsSync(path)) return null
  const r = await git(path, ['rev-parse', '--is-inside-work-tree', '--show-toplevel', '--absolute-git-dir'], { allowFail: true })
  if (r.code !== 0) return null
  const [inside, top, dir] = r.stdout.split(/\r?\n/).map((line) => line.trim())
  if (inside !== 'true' || !top) return null
  const root = resolve(top)
  const gitDir = dir ? resolve(dir) : join(root, '.git')
  gitDirs.set(root, gitDir)
  return { root, gitDir }
}

export async function repoRoot(path: string): Promise<string> {
  const r = await git(path, ['rev-parse', '--show-toplevel'])
  return resolve(r.stdout.trim())
}

export async function repoName(path: string): Promise<string> {
  return basename(await repoRoot(path))
}

export async function initRepo(directory: string, initialCommit = false): Promise<string> {
  mkdirSync(directory, { recursive: true })
  await git(directory, ['init', '-b', 'main'])
  if (initialCommit) {
    const readme = join(directory, 'README.md')
    if (!existsSync(readme)) writeFileSync(readme, `# ${basename(directory)}\n`, 'utf8')
    await git(directory, ['add', '-A'])
    await git(directory, ['commit', '-m', 'Initial commit'], { allowFail: true })
  }
  return directory
}

export async function cloneRepo(
  opts: CloneOptions,
  onProgress?: (line: string) => void
): Promise<string> {
  mkdirSync(opts.directory, { recursive: true })
  const target = opts.name ? join(opts.directory, opts.name) : join(opts.directory, guessCloneName(opts.url))
  const args = ['clone', '--progress']
  if (opts.recursive) args.push('--recurse-submodules')
  args.push(opts.url, target)
  const r = await new Promise<GitResult>((resolvePromise, reject) => {
    const child = spawn(gitExe, args, {
      windowsHide: true,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }
    })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (d: string) => {
      stdout += d
      onProgress?.(d)
    })
    child.stderr.on('data', (d: string) => {
      stderr += d
      onProgress?.(d)
    })
    child.on('error', reject)
    child.on('close', (code) => resolvePromise({ stdout, stderr, code: code ?? 1 }))
  })
  if (r.code !== 0) throw new Error((r.stderr || r.stdout).trim() || 'Clone failed')
  return target
}

function guessCloneName(url: string): string {
  const clean = url.replace(/\.git$/, '').replace(/\/$/, '')
  const part = clean.split('/').pop() || clean.split(':').pop() || 'repo'
  return part
}

const gitDirs = new Map<string, string>()

export async function gitDirOf(cwd: string): Promise<string> {
  const cached = gitDirs.get(cwd)
  if (cached) return cached
  const fast = gitDirFast(cwd)
  if (fast && existsSync(join(fast, 'HEAD'))) {
    gitDirs.set(cwd, fast)
    return fast
  }
  const r = await git(cwd, ['rev-parse', '--absolute-git-dir'], { allowFail: true })
  const dir = r.code === 0 && r.stdout.trim() ? resolve(r.stdout.trim()) : join(cwd, '.git')
  gitDirs.set(cwd, dir)
  return dir
}

function gitDirFast(cwd: string): string | null {
  const dot = join(cwd, '.git')
  if (!existsSync(dot)) return null
  try {
    if (statSync(dot).isDirectory()) return dot
    const text = readFileSync(dot, 'utf8')
    const match = text.match(/^gitdir:\s*(.+)$/m)
    if (!match) return null
    const target = match[1].trim()
    return isAbsolute(target) ? target : resolve(cwd, target)
  } catch {
    return null
  }
}

function fileMark(file: string, read = false): string {
  try {
    const st = statSync(file)
    if (!st.isFile()) return `dir:${Math.round(st.mtimeMs)}`
    const body = read ? readFileSync(file, 'utf8').trim() : ''
    return `${body}:${Math.round(st.mtimeMs)}:${st.size}`
  } catch {
    return '-'
  }
}

/** Cheap fingerprint of commits, the index, refs, and in-progress Git operations. */
export function repoStamp(cwd: string): string {
  if (!cwd || !existsSync(cwd)) return 'missing'
  const gitDir = gitDirFast(cwd)
  if (!gitDir || !existsSync(gitDir)) return 'nogit'
  const head = fileMark(join(gitDir, 'HEAD'), true)
  const refName = head.startsWith('ref: ') ? head.slice(5).split(':')[0].trim() : ''
  return [
    head,
    refName ? fileMark(join(gitDir, refName), true) : '',
    fileMark(join(gitDir, 'index')),
    fileMark(join(gitDir, 'logs', 'HEAD')),
    fileMark(join(gitDir, 'packed-refs')),
    fileMark(join(gitDir, 'refs', 'heads')),
    fileMark(join(gitDir, 'refs', 'remotes')),
    existsSync(join(gitDir, 'MERGE_HEAD')) ? 'merge' : '',
    existsSync(join(gitDir, 'rebase-merge')) || existsSync(join(gitDir, 'rebase-apply')) ? 'rebase' : '',
    existsSync(join(gitDir, 'CHERRY_PICK_HEAD')) ? 'cherry' : '',
    existsSync(join(gitDir, 'REVERT_HEAD')) ? 'revert' : '',
    existsSync(join(gitDir, 'BISECT_LOG')) ? 'bisect' : ''
  ].join('|')
}

function operationIn(gitDir: string): RepoOverview['operation'] {
  if (existsSync(join(gitDir, 'rebase-merge')) || existsSync(join(gitDir, 'rebase-apply'))) return 'rebase'
  if (existsSync(join(gitDir, 'MERGE_HEAD'))) return 'merge'
  if (existsSync(join(gitDir, 'CHERRY_PICK_HEAD'))) return 'cherry-pick'
  if (existsSync(join(gitDir, 'REVERT_HEAD'))) return 'revert'
  if (existsSync(join(gitDir, 'BISECT_LOG'))) return 'bisect'
  return undefined
}

export async function getStatus(cwd: string): Promise<RepoStatus> {
  const [porcelain, gitDir] = await Promise.all([
    git(cwd, ['status', '--porcelain=v2', '-b', '--untracked-files=all', '--ignore-submodules=untracked']),
    gitDirOf(cwd)
  ])
  const inMerge = existsSync(join(gitDir, 'MERGE_HEAD'))
  const inRebase = existsSync(join(gitDir, 'rebase-merge')) || existsSync(join(gitDir, 'rebase-apply'))
  const inCherry = existsSync(join(gitDir, 'CHERRY_PICK_HEAD'))
  const inRevert = existsSync(join(gitDir, 'REVERT_HEAD'))
  const inBisect = existsSync(join(gitDir, 'BISECT_LOG'))

  let branch = 'HEAD'
  let detached = false
  let ahead = 0
  let behind = 0
  let upstream: string | undefined
  const staged: StatusEntry[] = []
  const unstaged: StatusEntry[] = []
  const untracked: StatusEntry[] = []
  const conflicted: StatusEntry[] = []

  for (const line of porcelain.stdout.split('\n')) {
    if (!line) continue
    if (line.startsWith('# branch.head ')) {
      const name = line.slice('# branch.head '.length).trim()
      if (name === '(detached)') detached = true
      else branch = name
    } else if (line.startsWith('# branch.upstream ')) {
      upstream = line.slice('# branch.upstream '.length).trim()
    } else if (line.startsWith('# branch.ab ')) {
      const m = line.match(/\+(\d+) -(\d+)/)
      if (m) {
        ahead = Number(m[1])
        behind = Number(m[2])
      }
    } else if (line.startsWith('1 ') || line.startsWith('2 ')) {
      const entry = parseOrdinary(line)
      if (entry.conflict) conflicted.push(entry)
      if (entry.staged) staged.push(entry)
      if (entry.unstaged) unstaged.push(entry)
    } else if (line.startsWith('u ')) {
      const entry = parseUnmerged(line)
      conflicted.push(entry)
      unstaged.push(entry)
    } else if (line.startsWith('? ')) {
      const p = line.slice(2)
      const e: StatusEntry = {
        path: p,
        index: ' ',
        worktree: '?',
        staged: false,
        unstaged: true,
        untracked: true,
        conflict: false,
        isImage: isImage(p)
      }
      untracked.push(e)
      unstaged.push(e)
    }
  }

  return {
    path: cwd,
    name: basename(cwd),
    branch: detached ? 'HEAD' : branch,
    detached,
    ahead,
    behind,
    upstream,
    merging: inMerge,
    rebasing: inRebase,
    cherryPicking: inCherry,
    reverting: inRevert,
    bisecting: inBisect,
    staged,
    unstaged,
    untracked,
    conflicted,
    stagedCount: staged.length,
    unstagedCount: unstaged.length
  }
}

function parseOrdinary(line: string): StatusEntry {
  // 1 XY sub mH mI mW hH hI path
  // 2 XY sub mH mI mW hH hI Xscore origPath \t path
  const renamed = line.startsWith('2 ')
  const rest = line.slice(2)
  const xy = rest.slice(0, 2)
  const index = xy[0] as StatusEntry['index']
  const worktree = xy[1] as StatusEntry['worktree']
  let origPath: string | undefined
  let path: string
  if (renamed) {
    const [left, right] = rest.split('\t')
    const tokens = (left ?? '').split(' ')
    path = tokens.slice(8).join(' ')
    origPath = right
  } else {
    const parts = rest.split(' ')
    path = parts.slice(7).join(' ')
  }
  const conflict = index === 'U' || worktree === 'U'
  return {
    path,
    origPath,
    index,
    worktree,
    staged: index !== '.' && index !== ' ',
    unstaged: worktree !== '.' && worktree !== ' ',
    untracked: false,
    conflict,
    isImage: isImage(path)
  }
}

function parseUnmerged(line: string): StatusEntry {
  const rest = line.slice(2)
  const path = rest.split(' ').slice(10).join(' ')
  return {
    path,
    index: 'U',
    worktree: 'U',
    staged: false,
    unstaged: true,
    untracked: false,
    conflict: true,
    isImage: isImage(path)
  }
}

function isImage(path: string): boolean {
  return IMAGE_EXT.has(extname(path).toLowerCase())
}

function authorPattern(email: string): string {
  return email.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&')
}

/** Commit counts per local calendar day for the recent history window. */
export async function activityDays(cwd: string, author?: string, spanDays = 30): Promise<Record<string, number>> {
  const since = new Date()
  since.setHours(0, 0, 0, 0)
  since.setDate(since.getDate() - Math.max(0, spanDays - 1))
  const day = `${since.getFullYear()}-${String(since.getMonth() + 1).padStart(2, '0')}-${String(since.getDate()).padStart(2, '0')}`
  const args = ['log', '--all', `--since=${day}`, '--pretty=format:%ct']
  if (author) args.push(`--author=${authorPattern(author)}`)
  const r = await git(cwd, args, { allowFail: true })
  if (r.code !== 0 || !r.stdout.trim()) return {}
  const days: Record<string, number> = {}
  for (const line of r.stdout.split('\n')) {
    const seconds = Number(line.trim())
    if (!seconds) continue
    const key = dayKeyFromUnix(seconds)
    days[key] = (days[key] ?? 0) + 1
  }
  return days
}

export async function getCommits(cwd: string, max = 400, extraArgs: string[] = []): Promise<CommitInfo[]> {
  const fmt = ['%H', '%P', '%an', '%ae', '%cn', '%ce', '%at', '%s', '%b', '%D'].join('%x1f') + '%x1e'
  const r = await git(cwd, [
    'log',
    '--date-order',
    `--pretty=format:${fmt}`,
    `--max-count=${max}`,
    '--decorate=short',
    ...extraArgs
  ], { allowFail: true })
  if (r.code !== 0) return []
  const commits: CommitInfo[] = []
  for (const rec of r.stdout.split('\x1e')) {
    const t = rec.trim()
    if (!t) continue
    const [hash, parents, author, email, committer, committerEmail, at, subject, body, deco] = t.split('\x1f')
    if (!hash) continue
    commits.push({
      hash,
      shortHash: hash.slice(0, 7),
      parents: parents ? parents.split(' ').filter(Boolean) : [],
      author: author || '',
      email: email || '',
      committer: committer || '',
      committerEmail: committerEmail || '',
      date: Number(at) * 1000,
      subject: (subject || '').replace(/\n/g, ' '),
      body: (body || '').trim(),
      refs: parseDecorations(deco || ''),
      lane: 0,
      maxLane: 0,
      parentLanes: [],
      mergeLanes: [],
      lanesIn: [],
      lanesOut: []
    })
  }
  return layoutGraph(commits)
}

function parseDecorations(raw: string): RefLabel[] {
  if (!raw) return []
  const refs: RefLabel[] = []
  for (const part of raw.split(', ')) {
    const s = part.trim()
    if (!s) continue
    if (s === 'HEAD' || s.startsWith('HEAD ->')) {
      const name = s.includes('->') ? s.split('->')[1].trim() : 'HEAD'
      refs.push({ name, type: 'head', current: true })
      if (s.includes('->')) refs.push({ name, type: 'local', current: true })
      continue
    }
    if (s.startsWith('tag: ')) refs.push({ name: s.slice(5), type: 'tag' })
    else if (s.startsWith('refs/stash') || s === 'refs/stash' || s.includes('stash@{'))
      refs.push({ name: s, type: 'stash' })
    else if (s.includes('/')) refs.push({ name: s, type: 'remote' })
    else refs.push({ name: s, type: 'local' })
  }
  return refs
}

export async function getBranches(cwd: string): Promise<BranchInfo[]> {
  const r = await git(cwd, [
    'for-each-ref',
    '--format=%(refname)%09%(objectname)%09%(upstream:short)%09%(HEAD)%09%(refname:short)%09%(upstream:track)',
    'refs/heads',
    'refs/remotes'
  ])
  const list: BranchInfo[] = []
  for (const line of r.stdout.split('\n')) {
    if (!line.trim()) continue
    const [full, hash, upstream, head, short, track = ''] = line.split('\t')
    const remote = full.startsWith('refs/remotes/')
    const ahead = Number(track.match(/ahead (\d+)/)?.[1] ?? 0)
    const behind = Number(track.match(/behind (\d+)/)?.[1] ?? 0)
    list.push({
      name: short,
      fullName: full,
      hash,
      current: head === '*',
      remote,
      upstream: upstream || undefined,
      ahead,
      behind
    })
  }
  return list
}

export async function getTags(cwd: string): Promise<TagInfo[]> {
  const r = await git(cwd, [
    'for-each-ref',
    '--sort=-creatordate',
    '--format=%(refname:short)%09%(objectname:short)%09%(contents:subject)',
    'refs/tags'
  ])
  return r.stdout
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [name, hash, message] = line.split('\t')
      return { name, hash, message }
    })
}

export async function getRemotes(cwd: string): Promise<RemoteInfo[]> {
  const r = await git(cwd, ['remote', '-v'])
  const map = new Map<string, string>()
  for (const line of r.stdout.split('\n')) {
    const m = line.match(/^(\S+)\s+(\S+)\s+\(fetch\)/)
    if (m) map.set(m[1], m[2])
  }
  return [...map.entries()].map(([name, url]) => ({ name, url }))
}

export async function getStashes(cwd: string): Promise<StashInfo[]> {
  const dir = gitDirFast(cwd)
  if (dir && !existsSync(join(dir, 'logs', 'refs', 'stash')) && !existsSync(join(dir, 'refs', 'stash'))) return []
  const r = await git(cwd, ['stash', 'list', '--pretty=format:%gd%x1f%H%x1f%s%x1f%at'], { allowFail: true })
  if (r.code !== 0 || !r.stdout.trim()) return []
  return r.stdout
    .split('\n')
    .filter(Boolean)
    .map((line, index) => {
      const [selector, hash, message, at] = line.split('\x1f')
      return { index, selector, hash, message, date: Number(at) * 1000 }
    })
}

export async function getSubmodules(cwd: string): Promise<SubmoduleInfo[]> {
  if (!existsSync(join(cwd, '.gitmodules'))) return []
  const r = await git(cwd, ['submodule', 'status'], { allowFail: true })
  if (r.code !== 0 || !r.stdout.trim()) return []
  return r.stdout
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const m = line.match(/^([ U+-])([0-9a-f]+)\s+(\S+)(?:\s+\((.+)\))?/)
      const flag = m?.[1] ?? ' '
      const status: SubmoduleInfo['status'] =
        flag === '-' ? 'uninitialized' : flag === '+' ? 'modified' : flag === 'U' ? 'modified' : 'ok'
      return { path: m?.[3] ?? line.trim(), hash: m?.[2] ?? '', status }
    })
}

export async function submoduleUpdate(cwd: string, subpath?: string): Promise<void> {
  const args = ['submodule', 'update', '--init', '--recursive']
  if (subpath) args.push('--', subpath)
  await git(cwd, args)
}

export async function stage(cwd: string, paths: string[]): Promise<void> {
  if (!paths.length) return
  await git(cwd, ['add', '--', ...paths])
}

export async function unstage(cwd: string, paths: string[]): Promise<void> {
  if (!paths.length) return
  await git(cwd, ['restore', '--staged', '--', ...paths], { allowFail: true })
  await git(cwd, ['reset', '-q', 'HEAD', '--', ...paths], { allowFail: true })
}

export async function stageAll(cwd: string): Promise<void> {
  await git(cwd, ['add', '-A'])
}

export async function unstageAll(cwd: string): Promise<void> {
  await git(cwd, ['reset', '-q', 'HEAD'], { allowFail: true })
}

export async function discard(cwd: string, paths: string[]): Promise<void> {
  const untracked: string[] = []
  const tracked: string[] = []
  const st = await getStatus(cwd)
  const u = new Set(st.untracked.map((e) => e.path))
  for (const p of paths) (u.has(p) ? untracked : tracked).push(p)
  if (tracked.length) await git(cwd, ['checkout', '--', ...tracked])
  if (untracked.length) await git(cwd, ['clean', '-f', '--', ...untracked])
}

export async function commit(cwd: string, opts: CommitOptions): Promise<string> {
  const args = ['commit', '-m', opts.message]
  if (opts.amend) args.push('--amend', '--no-edit')
  if (opts.amend && opts.message) {
    args.splice(args.indexOf('--no-edit'), 1)
  }
  if (opts.noVerify) args.push('--no-verify')
  if (opts.signOff) args.push('--signoff')
  const r = await git(cwd, args)
  return r.stdout
}

export async function fetchRemote(cwd: string, opts: FetchOptions = {}): Promise<GitResult> {
  const args = ['fetch']
  if (opts.all || !opts.remote) args.push('--all')
  else args.push(opts.remote)
  if (opts.prune) args.push('--prune')
  if (opts.tags) args.push('--tags')
  return git(cwd, args)
}

export async function pullRemote(cwd: string, opts: PullOptions = {}): Promise<GitResult> {
  if (opts.stash) await git(cwd, ['stash', 'push', '-u', '-m', 'spoon: auto-stash before pull'], { allowFail: true })
  const args = ['pull']
  if (opts.rebase) args.push('--rebase')
  if (opts.prune) args.push('--prune')
  if (opts.remote) args.push(opts.remote)
  const r = await git(cwd, args)
  if (opts.stash) await git(cwd, ['stash', 'pop'], { allowFail: true })
  return r
}

export async function pushRemote(cwd: string, opts: PushOptions = {}): Promise<GitResult> {
  const args = ['push']
  if (opts.forceWithLease) args.push('--force-with-lease')
  if (opts.tags) args.push('--tags')
  if (opts.setUpstream) args.push('-u')
  if (opts.remote) args.push(opts.remote)
  if (opts.branch) args.push(opts.branch)
  return git(cwd, args)
}

export async function checkout(cwd: string, ref: string, create = false): Promise<void> {
  const args = ['checkout']
  if (create) args.push('-b')
  args.push(ref)
  await git(cwd, args)
}

export async function createBranch(cwd: string, name: string, checkoutBranch = true, startPoint?: string): Promise<void> {
  if (checkoutBranch) await git(cwd, ['checkout', '-b', name, ...(startPoint ? [startPoint] : [])])
  else await git(cwd, ['branch', name, ...(startPoint ? [startPoint] : [])])
}

export async function deleteBranch(cwd: string, name: string, force = false, remoteName?: string): Promise<void> {
  if (remoteName) await git(cwd, ['push', remoteName, '--delete', name])
  else await git(cwd, ['branch', force ? '-D' : '-d', name])
}

export async function renameBranch(cwd: string, from: string, to: string): Promise<void> {
  await git(cwd, ['branch', '-m', from, to])
}

export async function mergeBranch(cwd: string, ref: string, noFf = false, squash = false): Promise<GitResult> {
  const args = ['merge']
  if (noFf) args.push('--no-ff')
  if (squash) args.push('--squash')
  args.push(ref)
  return git(cwd, args, { allowFail: true })
}

export async function rebaseOnto(cwd: string, ref: string): Promise<GitResult> {
  return git(cwd, ['rebase', ref], { allowFail: true })
}

export async function rebaseContinue(cwd: string): Promise<GitResult> {
  return git(cwd, ['-c', 'core.editor=true', 'rebase', '--continue'], { allowFail: true })
}

export async function rebaseAbort(cwd: string): Promise<void> {
  await git(cwd, ['rebase', '--abort'])
}

export async function cherryPick(cwd: string, hashes: string[]): Promise<GitResult> {
  return git(cwd, ['cherry-pick', ...hashes], { allowFail: true })
}

export async function revertCommits(cwd: string, hashes: string[]): Promise<GitResult> {
  return git(cwd, ['revert', '--no-edit', ...hashes], { allowFail: true })
}

export async function resetTo(cwd: string, hash: string, mode: 'soft' | 'mixed' | 'hard'): Promise<void> {
  await git(cwd, ['reset', `--${mode}`, hash])
}

export async function createTag(cwd: string, name: string, message?: string, hash?: string): Promise<void> {
  const args = message ? ['tag', '-a', name, '-m', message] : ['tag', name]
  if (hash) args.push(hash)
  await git(cwd, args)
}

export async function deleteTag(cwd: string, name: string): Promise<void> {
  await git(cwd, ['tag', '-d', name])
}

export async function stashPush(cwd: string, message?: string, paths?: string[]): Promise<void> {
  const args = ['stash', 'push', '-u']
  if (message) args.push('-m', message)
  if (paths?.length) args.push('--', ...paths)
  await git(cwd, args)
}

export async function stashApply(cwd: string, selector: string, pop = false): Promise<GitResult> {
  return git(cwd, ['stash', pop ? 'pop' : 'apply', selector], { allowFail: true })
}

export async function stashDrop(cwd: string, selector: string): Promise<void> {
  await git(cwd, ['stash', 'drop', selector])
}

export async function addRemote(cwd: string, name: string, url: string): Promise<void> {
  await git(cwd, ['remote', 'add', name, url])
}

export async function removeRemote(cwd: string, name: string): Promise<void> {
  await git(cwd, ['remote', 'remove', name])
}

export async function setRemoteUrl(cwd: string, name: string, url: string): Promise<void> {
  await git(cwd, ['remote', 'set-url', name, url])
}

export async function renameRemote(cwd: string, from: string, to: string): Promise<void> {
  await git(cwd, ['remote', 'rename', from, to])
}

export async function getDiff(
  cwd: string,
  opts: {
    staged?: boolean
    path?: string
    commit?: string
    stash?: string
    ignoreWhitespace?: boolean
    context?: number
  } = {}
): Promise<FileDiff[]> {
  if (opts.stash) return stashDiff(cwd, opts.stash, opts)
  const args = ['diff', `--unified=${opts.context ?? 3}`, '--find-renames']
  if (opts.ignoreWhitespace) args.push('-w')
  if (opts.staged) args.push('--cached')
  if (opts.commit) {
    args.length = 0
    args.push('show', '--pretty=format:', `--unified=${opts.context ?? 3}`, '--find-renames', opts.commit)
    if (opts.ignoreWhitespace) args.push('-w')
  }
  if (opts.path) args.push('--', opts.path)
  const r = await git(cwd, args, { allowFail: true })
  const diffs = parseDiffs(r.stdout)
  // `git diff` never lists untracked files, so new files would have no preview.
  if (!opts.staged && !opts.commit) diffs.push(...(await untrackedDiffs(cwd, opts.path)))
  return diffs
}

const MAX_UNTRACKED_DIFFS = 200
const MAX_UNTRACKED_TEXT = 1024 * 1024

async function untrackedDiffs(cwd: string, path?: string): Promise<FileDiff[]> {
  const args = ['ls-files', '--others', '--exclude-standard']
  if (path) args.push('--', path)
  const r = await git(cwd, args, { allowFail: true })
  const files = r.stdout.split('\n').filter(Boolean).slice(0, MAX_UNTRACKED_DIFFS)
  return files.map((file) => newFileDiff(cwd, file))
}

function newFileDiff(cwd: string, file: string): FileDiff {
  const base = { path: file, status: 'A', image: isImage(file), untracked: true }
  let buf: Buffer
  try {
    const abs = worktreeFile(cwd, file)
    const info = statSync(abs)
    if (!info.isFile() || info.size > MAX_UNTRACKED_TEXT) return { ...base, binary: true, hunks: [], patch: '' }
    buf = readFileSync(abs)
  } catch {
    return { ...base, binary: true, hunks: [], patch: '' }
  }
  if (buf.subarray(0, 8000).includes(0)) return { ...base, binary: true, hunks: [], patch: '' }
  const text = buf.toString('utf8')
  const lines = text ? text.split('\n') : []
  if (text.endsWith('\n')) lines.pop()
  const header = `@@ -0,0 +1,${lines.length} @@`
  const hunk: DiffHunk = {
    header,
    oldStart: 0,
    oldCount: 0,
    newStart: 1,
    newCount: lines.length,
    lines: [{ type: 'hunk', text: header }, ...lines.map((line, i) => ({ type: 'add' as const, text: line.replace(/\r$/, ''), newNo: i + 1 }))]
  }
  const patch = `diff --git a/${file} b/${file}\nnew file mode 100644\n--- /dev/null\n+++ b/${file}\n${header}\n${lines.map((l) => `+${l}`).join('\n')}\n`
  return { ...base, binary: false, hunks: lines.length ? [hunk] : [], patch }
}

async function stashDiff(cwd: string, selector: string, opts: { ignoreWhitespace?: boolean; context?: number }): Promise<FileDiff[]> {
  const args = ['stash', 'show', '-p', `--unified=${opts.context ?? 3}`, '--find-renames']
  if (opts.ignoreWhitespace) args.push('-w')
  // --include-untracked needs Git 2.32+; older Git still shows the tracked part.
  const withUntracked = await git(cwd, [...args, '--include-untracked', selector], { allowFail: true })
  if (withUntracked.code === 0) return parseDiffs(withUntracked.stdout)
  return parseDiffs((await git(cwd, [...args, selector], { allowFail: true })).stdout)
}

export function parseDiffs(patch: string): FileDiff[] {
  const files: FileDiff[] = []
  const chunks = patch.split(/^diff --git /m).filter((c) => c.trim())
  for (const chunk of chunks) {
    const text = 'diff --git ' + chunk
    const { origPath, path } = diffPaths(text)
    const binary = /Binary files /.test(text)
    const status = /^new file/m.test(text) ? 'A' : /^deleted file/m.test(text) ? 'D' : origPath !== path ? 'R' : 'M'
    const hunks = parseHunks(text)
    files.push({
      path,
      origPath: origPath !== path ? origPath : undefined,
      status,
      binary,
      image: isImage(path),
      hunks,
      patch: text
    })
  }
  return files
}

/** Paths from a diff header. A lazy regex breaks on names like "a b/c", so prefer the explicit lines. */
function diffPaths(text: string): { origPath?: string; path: string } {
  const renameFrom = text.match(/^rename from (.+)$/m)?.[1]
  const renameTo = text.match(/^rename to (.+)$/m)?.[1]
  if (renameFrom && renameTo) return { origPath: renameFrom, path: renameTo }
  const header = text.match(/^diff --git (.+)$/m)?.[1] ?? ''
  // Unchanged names make the header symmetric: "a/<p> b/<p>".
  if (header.length % 2 === 1) {
    const half = (header.length - 1) / 2
    const left = header.slice(0, half)
    const right = header.slice(half + 1)
    if (left.startsWith('a/') && right.startsWith('b/') && left.slice(2) === right.slice(2)) {
      return { origPath: left.slice(2), path: right.slice(2) }
    }
  }
  // Git appends a tab to these lines when the name contains a space.
  const minus = text.match(/^--- a\/(.+)$/m)?.[1]?.replace(/\t$/, '')
  const plus = text.match(/^\+\+\+ b\/(.+)$/m)?.[1]?.replace(/\t$/, '')
  if (minus || plus) return { origPath: minus ?? plus, path: plus ?? minus ?? '' }
  const m = header.match(/^a\/(.+?) b\/(.+)$/)
  return { origPath: m?.[1], path: m?.[2] ?? m?.[1] ?? '' }
}

export function parseHunks(patch: string): DiffHunk[] {
  const hunks: DiffHunk[] = []
  const lines = patch.split('\n')
  let current: DiffHunk | null = null
  let oldNo = 0
  let newNo = 0
  for (const line of lines) {
    const hm = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/)
    if (hm) {
      current = {
        header: line,
        oldStart: Number(hm[1]),
        oldCount: Number(hm[2] ?? 1),
        newStart: Number(hm[3]),
        newCount: Number(hm[4] ?? 1),
        lines: [{ type: 'hunk', text: line }]
      }
      oldNo = current.oldStart
      newNo = current.newStart
      hunks.push(current)
      continue
    }
    // Real context lines start with a space; a bare empty string is the patch's trailing newline.
    if (!current || line === '') continue
    if (line.startsWith('+')) {
      current.lines.push({ type: 'add', text: line.slice(1), newNo: newNo++ })
    } else if (line.startsWith('-')) {
      current.lines.push({ type: 'del', text: line.slice(1), oldNo: oldNo++ })
    } else if (line.startsWith('\\')) {
      current.lines.push({ type: 'meta', text: line })
    } else if (line.startsWith('diff ') || line.startsWith('index ') || line.startsWith('---') || line.startsWith('+++')) {
      continue
    } else {
      const t = line.startsWith(' ') ? line.slice(1) : line
      current.lines.push({ type: 'context', text: t, oldNo: oldNo++, newNo: newNo++ })
    }
  }
  return hunks
}

export async function applyHunk(
  cwd: string,
  file: string,
  hunk: DiffHunk,
  mode: 'stage' | 'unstage' | 'discard'
): Promise<void> {
  const header = `diff --git a/${file} b/${file}\n--- a/${file}\n+++ b/${file}\n`
  const body = hunk.lines
    .filter((l) => l.type !== 'meta')
    .map((l) => {
      if (l.type === 'hunk') return l.text.startsWith('@@') ? l.text : `@@ ${l.text}`
      if (l.type === 'add') return '+' + l.text
      if (l.type === 'del') return '-' + l.text
      return ' ' + l.text
    })
    .join('\n') + '\n'
  const patch = header + (body.startsWith('@@') ? body : hunk.header + '\n' + body)
  const args = ['apply', '--unidiff-zero', '--whitespace=nowarn']
  if (mode === 'stage') args.push('--cached')
  if (mode === 'unstage') args.push('--cached', '--reverse')
  if (mode === 'discard') args.push('--reverse')
  const r = await git(cwd, args, { stdin: patch, allowFail: true })
  if (r.code !== 0) {
    args.splice(args.indexOf('--unidiff-zero'), 1)
    await git(cwd, args, { stdin: patch })
  }
}

export async function blame(cwd: string, file: string, rev?: string): Promise<BlameLine[]> {
  const args = ['blame', '--line-porcelain']
  if (rev) args.push(rev)
  args.push('--', file)
  const r = await git(cwd, args)
  const lines: BlameLine[] = []
  let hash = ''
  let author = ''
  let date = 0
  let number = 0
  for (const line of r.stdout.split('\n')) {
    if (line.startsWith('\t')) {
      lines.push({ hash, author, date, line: line.slice(1), number })
    } else if (/^[0-9a-f]{8,}/.test(line)) {
      const parts = line.split(' ')
      hash = parts[0]
      number = Number(parts[2] || parts[1])
    } else if (line.startsWith('author ')) author = line.slice(7)
    else if (line.startsWith('author-time ')) date = Number(line.slice(12)) * 1000
  }
  return lines
}

export async function fileHistory(cwd: string, file: string): Promise<CommitInfo[]> {
  return getCommits(cwd, 200, ['--follow', '--', file])
}

export async function fileTree(cwd: string, rev = 'HEAD'): Promise<FileTreeNode[]> {
  const r = await git(cwd, ['ls-tree', '-r', '--name-only', rev], { allowFail: true })
  if (r.code !== 0) return []
  const root: FileTreeNode[] = []
  const dirs = new Map<string, FileTreeNode>()
  const ensure = (dir: string): FileTreeNode[] => {
    if (!dir) return root
    let node = dirs.get(dir)
    if (!node) {
      const parent = dirname(dir).replace(/\\/g, '/')
      const name = basename(dir)
      node = { path: dir, name, type: 'dir', children: [] }
      dirs.set(dir, node)
      const siblings = parent === '.' ? root : ensure(parent)
      siblings.push(node)
    }
    return node.children!
  }
  for (const p of r.stdout.split('\n')) {
    if (!p) continue
    const norm = p.replace(/\\/g, '/')
    const parent = dirname(norm).replace(/\\/g, '/')
    const list = parent === '.' ? root : ensure(parent)
    list.push({ path: norm, name: basename(norm), type: 'file' })
  }
  const sort = (nodes: FileTreeNode[]) => {
    nodes.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'dir' ? -1 : 1))
    for (const n of nodes) if (n.children) sort(n.children)
  }
  sort(root)
  return root
}

export async function showFile(cwd: string, rev: string, file: string): Promise<Buffer> {
  const blob = await gitBinary(cwd, ['cat-file', 'blob', `${rev}:${file}`])
  return blob?.buf ?? Buffer.alloc(0)
}

const MAX_MEDIA = 12 * 1024 * 1024

export function worktreeFile(cwd: string, file: string): string {
  const root = resolve(cwd)
  const abs = resolve(root, file)
  const rel = relative(root, abs)
  if (rel.startsWith('..') || isAbsolute(rel)) throw new Error('That path is outside the repository.')
  return abs
}

export async function previewMedia(
  cwd: string,
  file: string,
  opts: { rev?: string; origPath?: string; staged?: boolean } = {}
): Promise<MediaPair> {
  const beforePath = opts.origPath || file
  const blob = (spec: string) => gitBinary(cwd, ['cat-file', 'blob', spec])
  if (opts.rev) {
    const [before, after] = await Promise.all([blob(`${opts.rev}^:${beforePath}`), blob(`${opts.rev}:${file}`)])
    // A stash keeps its untracked files in a third parent.
    const stashed = !after && opts.rev.startsWith('stash@{') ? await blob(`${opts.rev}^3:${file}`) : null
    return { before: toMediaSide(beforePath, before), after: toMediaSide(file, after ?? stashed) }
  }
  if (opts.staged) {
    const [before, after] = await Promise.all([blob(`HEAD:${beforePath}`), blob(`:${file}`)])
    return { before: toMediaSide(beforePath, before), after: toMediaSide(file, after) }
  }
  // Unstaged changes are measured against the index, which falls back to HEAD for files not staged.
  const before = (await blob(`:${beforePath}`)) ?? (await blob(`HEAD:${beforePath}`))
  return { before: toMediaSide(beforePath, before), after: toMediaSide(file, readWorktreeMedia(cwd, file)) }
}

function readWorktreeMedia(cwd: string, file: string): { buf: Buffer; tooLarge: boolean; bytes: number } | null {
  let abs: string
  try {
    abs = worktreeFile(cwd, file)
  } catch {
    return null
  }
  if (!existsSync(abs)) return null
  const info = statSync(abs)
  if (!info.isFile()) return null
  if (info.size > MAX_MEDIA) return { buf: Buffer.alloc(0), tooLarge: true, bytes: info.size }
  return { buf: readFileSync(abs), tooLarge: false, bytes: info.size }
}

function gitBinary(cwd: string, args: string[]): Promise<{ buf: Buffer; tooLarge: boolean; bytes: number } | null> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(gitExe, args, {
      cwd,
      windowsHide: true,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }
    })
    const chunks: Buffer[] = []
    let size = 0
    let tooLarge = false
    child.stderr.resume()
    child.stdout.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (tooLarge) return
      if (size > MAX_MEDIA) {
        tooLarge = true
        chunks.length = 0
        child.kill()
        return
      }
      chunks.push(chunk)
    })
    child.on('error', reject)
    child.on('close', (code) => {
      if (tooLarge) resolvePromise({ buf: Buffer.alloc(0), tooLarge: true, bytes: size })
      else if (code !== 0) resolvePromise(null)
      else resolvePromise({ buf: Buffer.concat(chunks), tooLarge: false, bytes: size })
    })
  })
}

function toMediaSide(file: string, data: { buf: Buffer; tooLarge: boolean; bytes: number } | null): MediaSide {
  const info = classifyMedia(file)
  const kind = info?.kind ?? 'binary'
  const mime = info?.mime ?? 'application/octet-stream'
  if (!data) return { kind, mime, bytes: 0, missing: true }
  if (data.tooLarge) return { kind, mime, bytes: data.bytes, tooLarge: true }
  return { kind, mime, bytes: data.bytes, base64: data.buf.toString('base64') }
}

export async function reflog(cwd: string): Promise<CommitInfo[]> {
  const r = await git(cwd, ['reflog', '--pretty=format:%H%x1f%P%x1f%an%x1f%ae%x1f%cn%x1f%ce%x1f%at%x1f%s%x1f%gd%x1f%gs', '-n', '200'])
  const commits: CommitInfo[] = []
  for (const line of r.stdout.split('\n')) {
    if (!line.trim()) continue
    const [hash, parents, author, email, committer, committerEmail, at, subject, gd, gs] = line.split('\x1f')
    commits.push({
      hash,
      shortHash: hash.slice(0, 7),
      parents: parents ? parents.split(' ').filter(Boolean) : [],
      author,
      email,
      committer,
      committerEmail,
      date: Number(at) * 1000,
      subject: `${gd}: ${gs || subject}`,
      body: '',
      refs: [],
      lane: 0,
      maxLane: 0,
      parentLanes: [],
      mergeLanes: [],
      lanesIn: [],
      lanesOut: []
    })
  }
  return commits
}

export async function readConflict(cwd: string, file: string): Promise<ConflictFile> {
  const working = existsSync(join(cwd, file)) ? readFileSync(join(cwd, file), 'utf8') : ''
  const show = async (stage: string) => {
    const r = await git(cwd, ['show', `:${stage}:${file}`], { allowFail: true })
    return r.code === 0 ? r.stdout : ''
  }
  const [base, ours, theirs] = await Promise.all([show('1'), show('2'), show('3')])
  return { path: file, working, ours, theirs, base }
}

export async function writeResolved(cwd: string, file: string, content: string): Promise<void> {
  const full = join(cwd, file)
  mkdirSync(dirname(full), { recursive: true })
  writeFileSync(full, content, 'utf8')
  await git(cwd, ['add', '--', file])
}

export async function abortMerge(cwd: string): Promise<void> {
  await git(cwd, ['merge', '--abort'], { allowFail: true })
}

export async function continueMerge(cwd: string): Promise<GitResult> {
  return git(cwd, ['commit', '--no-edit'], { allowFail: true })
}

export async function gitConfig(cwd: string, key: string): Promise<string> {
  const r = await git(cwd, ['config', '--get', key], { allowFail: true })
  return r.stdout.trim()
}

export async function identity(cwd: string): Promise<{ name: string; email: string }> {
  const r = await git(cwd, ['config', '--get-regexp', '^user\\.(name|email)$'], { allowFail: true })
  let name = ''
  let email = ''
  for (const line of r.stdout.split(/\r?\n/)) {
    const m = line.match(/^user\.(name|email)\s+(.*)$/i)
    if (!m) continue
    if (m[1].toLowerCase() === 'name') name = m[2].trim()
    else email = m[2].trim()
  }
  return { name, email }
}

/** HEAD as written on disk: a symbolic ref or a detached hash. */
export function headMark(cwd: string): string {
  const dir = gitDirFast(cwd)
  if (!dir) return ''
  try {
    return readFileSync(join(dir, 'HEAD'), 'utf8').trim()
  } catch {
    return ''
  }
}

export async function getStagedPatch(cwd: string): Promise<string> {
  const r = await git(cwd, ['diff', '--cached', '--find-renames'], { allowFail: true })
  return r.stdout
}

export async function changeBrief(cwd: string): Promise<ChangeBriefFile[]> {
  const st = await getStatus(cwd)
  const order: string[] = []
  const statusOf = new Map<string, string>()
  const note = (p: string, s: string) => {
    const path = p.replace(/\\/g, '/')
    if (!statusOf.has(path)) order.push(path)
    const prev = statusOf.get(path)
    statusOf.set(path, prev ? `${prev}, ${s}` : s)
  }
  for (const entry of st.staged) note(entry.path, `staged ${entry.index}`)
  for (const entry of st.unstaged) note(entry.path, entry.untracked ? 'untracked' : `worktree ${entry.worktree}`)
  const patches = new Map<string, string>()
  if (order.some((path) => !statusOf.get(path)?.includes('untracked'))) {
    const diff = await git(cwd, ['diff', 'HEAD', '--find-renames', '--unified=1'], { allowFail: true })
    for (const file of parseDiffs(diff.stdout)) {
      const text = file.patch.length > 1600 ? file.patch.slice(0, 1600) + '\n[diff truncated]' : file.patch
      patches.set(file.path.replace(/\\/g, '/'), text)
      if (file.origPath) patches.set(file.origPath.replace(/\\/g, '/'), text)
    }
  }
  return order.map((path, index) => {
    const status = statusOf.get(path) || 'changed'
    let patch = patches.get(path) || ''
    if (!patch && status.includes('untracked') && index < 30) patch = readChangeSnippet(join(cwd, path))
    if (!patch) patch = `(${status})`
    return { path, status, patch }
  })
}

function readChangeSnippet(file: string): string {
  try {
    const info = statSync(file)
    if (!info.isFile() || info.size > 200_000) return `[file omitted, ${info.size} bytes]`
    const buf = readFileSync(file)
    if (buf.includes(0)) return `[binary file, ${info.size} bytes]`
    return buf.toString('utf8').split('\n').slice(0, 80).join('\n').slice(0, 1600)
  } catch {
    return ''
  }
}

export async function getWorkingPatch(cwd: string): Promise<string> {
  const r = await git(cwd, ['diff', 'HEAD', '--find-renames'], { allowFail: true })
  const untracked = await git(cwd, ['ls-files', '--others', '--exclude-standard'])
  let extra = r.stdout
  for (const p of untracked.stdout.split('\n').filter(Boolean)) {
    extra += `\nUntracked: ${p}\n`
  }
  return extra
}

export function isBinaryPath(p: string): boolean {
  const ext = extname(p).toLowerCase()
  return IMAGE_EXT.has(ext) || ['.pdf', '.zip', '.exe', '.dll', '.pdb', '.woff', '.woff2'].includes(ext)
}

export function relativeTo(cwd: string, file: string): string {
  return relative(cwd, file).split(sep).join('/')
}

export async function lfsFiles(cwd: string): Promise<string[]> {
  const r = await git(cwd, ['lfs', 'ls-files', '-n'], { allowFail: true })
  if (r.code !== 0) return []
  return r.stdout.split('\n').filter(Boolean)
}

export async function worktrees(cwd: string): Promise<{ path: string; branch: string }[]> {
  const r = await git(cwd, ['worktree', 'list', '--porcelain'], { allowFail: true })
  if (r.code !== 0) return []
  const out: { path: string; branch: string }[] = []
  let path = ''
  for (const line of r.stdout.split('\n')) {
    if (line.startsWith('worktree ')) path = line.slice(9)
    if (line.startsWith('branch ')) out.push({ path, branch: line.slice(7).replace('refs/heads/', '') })
  }
  return out
}

function firstLine(text: string): string {
  return (
    text
      .split('\n')
      .map((l) => l.replace(/^(fatal|error|warning):\s*/i, '').trim())
      .find(Boolean) ?? ''
  )
}

const isDubious = (stderr: string) => /dubious ownership/i.test(stderr)

export async function overview(path: string): Promise<RepoOverview> {
  const base: RepoOverview = {
    path,
    name: basename(path),
    exists: existsSync(path),
    unsafe: false,
    branch: '',
    detached: false,
    ahead: 0,
    behind: 0,
    staged: 0,
    unstaged: 0,
    untracked: 0,
    conflicts: 0,
    checkedAt: Date.now()
  }
  if (!base.exists) return { ...base, error: 'Folder not found' }
  const statusArgs = (untracked: 'all' | 'normal') => [
    'status',
    '--porcelain=v2',
    '-b',
    `--untracked-files=${untracked}`,
    '--ignore-submodules=untracked'
  ]
  let st = await git(path, statusArgs('all'), { allowFail: true, timeoutMs: 15000 })
  // Listing every untracked file can take minutes in a folder full of unignored build output; fall back to folders.
  if (st.code === 124) st = await git(path, statusArgs('normal'), { allowFail: true, timeoutMs: 30000 })
  if (st.code !== 0) {
    const unsafe = isDubious(st.stderr)
    return { ...base, unsafe, error: unsafe ? 'Git blocks this folder (dubious ownership)' : firstLine(st.stderr) || 'Not a Git repository' }
  }
  const out = { ...base }
  for (const line of st.stdout.split('\n')) {
    if (line.startsWith('# branch.head ')) {
      const name = line.slice(14).trim()
      out.detached = name === '(detached)'
      out.branch = out.detached ? 'HEAD' : name
    } else if (line.startsWith('# branch.upstream ')) out.upstream = line.slice(18).trim()
    else if (line.startsWith('# branch.ab ')) {
      const m = line.match(/\+(\d+) -(\d+)/)
      if (m) {
        out.ahead = Number(m[1])
        out.behind = Number(m[2])
      }
    } else if (line.startsWith('1 ') || line.startsWith('2 ')) {
      if (line[2] !== '.') out.staged++
      if (line[3] !== '.') out.unstaged++
    } else if (line.startsWith('u ')) out.conflicts++
    else if (line.startsWith('? ')) out.untracked++
  }
  const [log, urls, gitDir] = await Promise.all([
    git(path, ['log', '-1', '--format=%s%x1f%an%x1f%at'], { allowFail: true }),
    git(path, ['config', '--get-regexp', '^remote\\..*\\.url$'], { allowFail: true }),
    gitDirOf(path)
  ])
  if (log.code === 0 && log.stdout.trim()) {
    const [subject, author, at] = log.stdout.trim().split('\x1f')
    out.lastCommit = { subject, author, date: Number(at) * 1000 }
  }
  const remotes = urls.stdout
    .split('\n')
    .map((l) => l.match(/^remote\.(.+)\.url\s+(.+)$/))
    .filter((m): m is RegExpMatchArray => !!m)
  out.remoteUrl = (remotes.find((m) => m[1] === 'origin') ?? remotes[0])?.[2]?.trim()
  out.operation = operationIn(gitDir)
  return out
}

async function defaultBranch(path: string): Promise<string | undefined> {
  const head = await git(path, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'], { allowFail: true })
  if (head.code === 0 && head.stdout.trim()) return head.stdout.trim().replace(/^origin\//, '')
  for (const name of ['main', 'master', 'develop']) {
    const r = await git(path, ['show-ref', '--verify', '--quiet', `refs/heads/${name}`], { allowFail: true })
    if (r.code === 0) return name
  }
  return undefined
}

async function goneBranches(path: string): Promise<string[]> {
  const r = await git(path, ['for-each-ref', '--format=%(refname:short)%09%(upstream:track)%09%(HEAD)', 'refs/heads'], {
    allowFail: true
  })
  return r.stdout
    .split('\n')
    .map((l) => l.split('\t'))
    .filter(([name, track, head]) => name && track === '[gone]' && head !== '*')
    .map(([name]) => name)
}

function preferredRemote(remotes: RemoteInfo[]): string | undefined {
  return (remotes.find((r) => r.name === 'origin') ?? remotes[0])?.name
}

export async function health(path: string, deep = false): Promise<RepoHealth> {
  const issues: RepoIssue[] = []
  const done = () => ({ path, issues, checkedAt: Date.now() })
  if (!existsSync(path)) {
    issues.push({
      id: 'missing',
      severity: 'error',
      title: 'Folder not found',
      detail: 'This repository was moved or deleted. Remove it from the list, or scan its new location.',
      fix: { id: 'remove-missing', label: 'Remove from list' }
    })
    return done()
  }
  const probe = await git(path, ['rev-parse', '--is-inside-work-tree'], { allowFail: true })
  if (probe.code !== 0) {
    if (isDubious(probe.stderr)) {
      issues.push({
        id: 'unsafe',
        severity: 'error',
        title: 'Git does not trust this folder',
        detail: 'The folder belongs to another Windows user, so Git refuses to run here ("dubious ownership").',
        fix: { id: 'safe-directory', label: 'Trust this folder' }
      })
    } else {
      issues.push({
        id: 'not-repo',
        severity: 'error',
        title: 'Not a Git repository anymore',
        detail: firstLine(probe.stderr) || 'The .git folder is missing or unreadable.',
        fix: { id: 'remove-missing', label: 'Remove from list' }
      })
    }
    return done()
  }

  const gitDir = await gitDirOf(path)
  const lock = join(gitDir, 'index.lock')
  if (existsSync(lock)) {
    const ageMin = Math.max(1, Math.round((Date.now() - statSync(lock).mtimeMs) / 60_000))
    issues.push({
      id: 'lock',
      severity: 'error',
      title: 'Stale lock file',
      detail: `Git left index.lock behind ${ageMin} min ago, usually after a crash. Every command fails until it is removed.`,
      fix: { id: 'remove-lock', label: 'Delete index.lock' }
    })
  }

  const [status, remotes, ident, subs, gone, objects] = await Promise.all([
    getStatus(path),
    getRemotes(path),
    identity(path),
    getSubmodules(path),
    goneBranches(path),
    git(path, ['count-objects', '-v'], { allowFail: true })
  ])

  const op = operationIn(gitDir)
  if (op && op !== 'bisect') {
    issues.push({
      id: 'operation',
      severity: 'warn',
      title: `${op[0].toUpperCase()}${op.slice(1)} in progress`,
      detail: status.conflicted.length
        ? `${status.conflicted.length} file(s) still have conflicts. Resolve them in Changes, or abort to go back to where you were.`
        : 'Continue it from Changes, or abort to go back to where you were.',
      fix: { id: 'abort-operation', label: `Abort ${op}`, destructive: true }
    })
  }

  if (status.detached) {
    const def = await defaultBranch(path)
    issues.push({
      id: 'detached',
      severity: 'warn',
      title: 'Detached HEAD',
      detail: 'You are not on a branch. New commits here are easy to lose.',
      fix: def ? { id: 'checkout-default', label: `Checkout ${def}` } : undefined
    })
  }

  const remote = preferredRemote(remotes)
  if (!remote) {
    issues.push({
      id: 'no-remote',
      severity: 'info',
      title: 'No remote',
      detail: 'This repository only exists on this machine. Add a remote to back it up.'
    })
  } else if (!status.detached && !status.upstream) {
    const exists = await git(path, ['show-ref', '--verify', '--quiet', `refs/remotes/${remote}/${status.branch}`], {
      allowFail: true
    })
    issues.push(
      exists.code === 0
        ? {
            id: 'no-upstream',
            severity: 'warn',
            title: 'Branch is not tracking its remote',
            detail: `${remote}/${status.branch} exists, but ${status.branch} is not linked to it. Pull and push will not know where to go.`,
            fix: { id: 'track-upstream', label: `Track ${remote}/${status.branch}` }
          }
        : {
            id: 'unpublished',
            severity: 'info',
            title: 'Branch not published',
            detail: `${status.branch} only exists locally.`,
            fix: { id: 'publish-branch', label: `Publish to ${remote}` }
          }
    )
  }

  const dirty = status.stagedCount + status.unstagedCount
  if (status.behind && status.ahead) {
    issues.push({
      id: 'diverged',
      severity: 'warn',
      title: 'Branch has diverged',
      detail: `${status.ahead} local and ${status.behind} remote commit(s) differ. Pull with merge or rebase to reconcile.`
    })
  } else if (status.behind && !dirty && !op) {
    issues.push({
      id: 'behind',
      severity: 'info',
      title: `${status.behind} commit(s) behind`,
      detail: `${status.upstream} has new commits and your working tree is clean.`,
      fix: { id: 'pull-ff', label: 'Fast-forward' }
    })
  }

  if (gone.length) {
    issues.push({
      id: 'gone',
      severity: 'info',
      title: `${gone.length} branch(es) deleted on the remote`,
      detail: `${gone.slice(0, 6).join(', ')}${gone.length > 6 ? '…' : ''} track remote branches that no longer exist.`,
      fix: { id: 'delete-gone-branches', label: 'Delete local copies', destructive: true }
    })
  }

  if (!ident.name || !ident.email) {
    issues.push({
      id: 'identity',
      severity: 'warn',
      title: 'Commit identity missing',
      detail: 'user.name or user.email is not set, so commits will fail or use a placeholder.',
      fix: { id: 'set-identity', label: 'Set name and email' }
    })
  }

  const uninit = subs.filter((s) => s.status === 'uninitialized')
  if (uninit.length) {
    issues.push({
      id: 'submodules',
      severity: 'warn',
      title: `${uninit.length} submodule(s) not initialized`,
      detail: `${uninit.map((s) => s.path).slice(0, 4).join(', ')} are empty folders until they are checked out.`,
      fix: { id: 'submodules', label: 'Initialize submodules' }
    })
  }

  const count = Number(objects.stdout.match(/^count: (\d+)/m)?.[1] ?? 0)
  const garbage = Number(objects.stdout.match(/^size-garbage: (\d+)/m)?.[1] ?? 0)
  if (count > 6000 || garbage > 0) {
    issues.push({
      id: 'gc',
      severity: 'info',
      title: 'Repository can be compacted',
      detail: `${count.toLocaleString()} loose objects${garbage ? ' and leftover garbage' : ''}. Packing them makes Git faster.`,
      fix: { id: 'gc', label: 'Compact (git gc)' }
    })
  }

  if (deep) {
    const fsck = await git(path, ['fsck', '--no-dangling', '--connectivity-only', '--no-progress'], { allowFail: true })
    if (fsck.code !== 0) {
      issues.push({
        id: 'fsck',
        severity: 'error',
        title: 'Repository data is damaged',
        detail: `${firstLine(fsck.stderr || fsck.stdout)}. Fetch from the remote may restore missing objects; otherwise re-clone.`,
        fix: remote ? { id: 'prune', label: 'Fetch and prune' } : undefined
      })
    }
  }

  const order = { error: 0, warn: 1, info: 2 }
  issues.sort((a, b) => order[a.severity] - order[b.severity])
  return done()
}

export async function applyFix(path: string, fix: RepoFixId, input?: { name?: string; email?: string }): Promise<string> {
  const remotes = () => getRemotes(path).then(preferredRemote)
  switch (fix) {
    case 'safe-directory': {
      const r = await runGitRaw(undefined, ['config', '--global', '--add', 'safe.directory', path.replace(/\\/g, '/')])
      if (r.code !== 0) throw new Error(firstLine(r.stderr) || 'Could not update safe.directory')
      return 'Folder trusted'
    }
    case 'remove-lock': {
      const lock = join(await gitDirOf(path), 'index.lock')
      if (existsSync(lock)) unlinkSync(lock)
      return 'Lock removed'
    }
    case 'abort-operation': {
      const op = operationIn(await gitDirOf(path))
      if (!op || op === 'bisect') return 'Nothing to abort'
      await git(path, [op, '--abort'])
      return `${op} aborted`
    }
    case 'publish-branch': {
      const remote = await remotes()
      if (!remote) throw new Error('No remote to publish to')
      await git(path, ['push', '-u', remote, 'HEAD'])
      return `Published to ${remote}`
    }
    case 'track-upstream': {
      const remote = await remotes()
      const branch = (await git(path, ['rev-parse', '--abbrev-ref', 'HEAD'])).stdout.trim()
      await git(path, ['branch', `--set-upstream-to=${remote}/${branch}`])
      return `Tracking ${remote}/${branch}`
    }
    case 'pull-ff':
      await git(path, ['pull', '--ff-only'])
      return 'Up to date'
    case 'prune':
      await git(path, ['fetch', '--all', '--prune'])
      return 'Fetched and pruned'
    case 'gc':
      await git(path, ['gc', '--prune=now', '--quiet'])
      return 'Repository compacted'
    case 'submodules':
      await submoduleUpdate(path)
      return 'Submodules initialized'
    case 'delete-gone-branches': {
      const gone = await goneBranches(path)
      for (const name of gone) await git(path, ['branch', '-D', name])
      return `Deleted ${gone.length} branch(es)`
    }
    case 'checkout-default': {
      const def = await defaultBranch(path)
      if (!def) throw new Error('No default branch found')
      await git(path, ['checkout', def])
      return `On ${def}`
    }
    case 'set-identity': {
      if (!input?.name?.trim() || !input?.email?.trim()) throw new Error('Name and email are required')
      await runGitRaw(undefined, ['config', '--global', 'user.name', input.name.trim()])
      await runGitRaw(undefined, ['config', '--global', 'user.email', input.email.trim()])
      return 'Identity saved'
    }
    case 'remove-missing':
      return 'Removed'
  }
}


