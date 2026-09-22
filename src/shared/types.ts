export type ThemeMode = 'light' | 'dark' | 'system'

export type AiProviderId = string

export interface AiModelChoice {
  id: string
  label: string
}

export interface AiModelCatalog {
  provider: AiProviderId
  models: AiModelChoice[]
  live: boolean
  error?: string
}

export type AiCommitMode = 'fill' | 'commit' | 'commit-push'

export type FileStatusCode =
  | 'M'
  | 'A'
  | 'D'
  | 'R'
  | 'C'
  | 'U'
  | '?'
  | '!'
  | 'T'
  | '.'

export interface RepoSummary {
  path: string
  name: string
  lastOpened: number
  color?: string
  folder?: string
}

export interface BranchInfo {
  name: string
  fullName: string
  hash: string
  current: boolean
  remote: boolean
  upstream?: string
  ahead: number
  behind: number
  starred?: boolean
}

export interface TagInfo {
  name: string
  hash: string
  message?: string
}

export interface RemoteInfo {
  name: string
  url: string
}

export interface StashInfo {
  index: number
  selector: string
  hash: string
  message: string
  date: number
}

export interface SubmoduleInfo {
  path: string
  hash: string
  status: 'ok' | 'uninitialized' | 'modified' | 'untracked'
  url?: string
}

export interface RefLabel {
  name: string
  type: 'local' | 'remote' | 'tag' | 'head' | 'stash'
  current?: boolean
  color?: string
}

export interface CommitInfo {
  hash: string
  shortHash: string
  parents: string[]
  author: string
  email: string
  committer: string
  committerEmail: string
  date: number
  subject: string
  body: string
  refs: RefLabel[]
  lane: number
  maxLane: number
  parentLanes: number[]
  mergeLanes: number[]
  lanesIn: number[]
  lanesOut: number[]
}

export interface StatusEntry {
  path: string
  origPath?: string
  index: FileStatusCode | ' '
  worktree: FileStatusCode | ' '
  staged: boolean
  unstaged: boolean
  untracked: boolean
  conflict: boolean
  isBinary?: boolean
  isImage?: boolean
}

export interface RepoStatus {
  path: string
  name: string
  branch: string
  detached: boolean
  ahead: number
  behind: number
  upstream?: string
  merging: boolean
  rebasing: boolean
  cherryPicking: boolean
  reverting: boolean
  bisecting: boolean
  staged: StatusEntry[]
  unstaged: StatusEntry[]
  untracked: StatusEntry[]
  conflicted: StatusEntry[]
  stagedCount: number
  unstagedCount: number
}

export interface DiffLine {
  type: 'context' | 'add' | 'del' | 'hunk' | 'meta'
  text: string
  oldNo?: number
  newNo?: number
}

export interface DiffHunk {
  header: string
  oldStart: number
  oldCount: number
  newStart: number
  newCount: number
  lines: DiffLine[]
}

export interface FileDiff {
  path: string
  origPath?: string
  status: string
  binary: boolean
  image: boolean
  hunks: DiffHunk[]
  oldContent?: string
  newContent?: string
  patch: string
}

export interface BlameLine {
  hash: string
  author: string
  date: number
  line: string
  number: number
}

export interface FileTreeNode {
  path: string
  name: string
  type: 'file' | 'dir'
  children?: FileTreeNode[]
}

export interface ActivityItem {
  id: string
  time: number
  title: string
  command?: string
  output?: string
  status: 'running' | 'ok' | 'error'
}

export interface AiAccount {
  provider: AiProviderId
  connected: boolean
  method?: 'oauth' | 'api-key' | 'imported'
  label?: string
  email?: string
}

export interface AiEndpointConfig {
  id: string
  label: string
  baseUrl: string
  defaultModel: string
  consoleUrl?: string
  extraHeaders?: Record<string, string>
  needsKey: boolean
  blurb?: string
  accent?: string
}

export interface Settings {
  theme: ThemeMode
  gitPath?: string
  fetchIntervalMin: number
  autoFetch: boolean
  aiProvider: AiProviderId
  aiModels: Record<string, string>
  aiEndpoints: AiEndpointConfig[]
  aiCommitMode: AiCommitMode
  aiStageAll: boolean
  recentMessages: string[]
  starred: Record<string, string[]>
  sidebarWidth: number
  changesListWidth: number
  changesSplit: number
  detailsHeight: number
  commitBoxHeight: number
  hideUntracked: boolean
  ignoreWhitespace: boolean
  diffMode: 'unified' | 'split'
  showAvatars: boolean
  glass: number
}

export interface RebaseTodoItem {
  action: 'pick' | 'reword' | 'edit' | 'squash' | 'fixup' | 'drop'
  hash: string
  subject: string
}

export interface ConflictFile {
  path: string
  ours: string
  theirs: string
  base?: string
  working: string
}

export interface CloneOptions {
  url: string
  directory: string
  name?: string
  recursive?: boolean
}

export interface FetchOptions {
  remote?: string
  prune?: boolean
  all?: boolean
  tags?: boolean
}

export interface PullOptions {
  remote?: string
  rebase?: boolean
  prune?: boolean
  stash?: boolean
}

export interface PushOptions {
  remote?: string
  branch?: string
  setUpstream?: boolean
  forceWithLease?: boolean
  tags?: boolean
}

export type MediaKind = 'image' | 'video' | 'audio' | 'pdf' | 'binary'

export interface MediaSide {
  kind: MediaKind
  mime: string
  base64?: string
  bytes: number
  tooLarge?: boolean
  missing?: boolean
}

export interface MediaPair {
  before: MediaSide
  after: MediaSide
}

export interface CommitOptions {
  message: string
  amend?: boolean
  noVerify?: boolean
  signOff?: boolean
}

export interface PlannedCommit {
  subject: string
  body: string
  files: string[]
  rationale: string
}

export interface ChangeAnalysis {
  summary: string
  commits: PlannedCommit[]
}

export interface ChangeBriefFile {
  path: string
  status: string
  patch: string
}
