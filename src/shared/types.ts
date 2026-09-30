export type ThemeMode = 'light' | 'dark'
export type ThemePack = 'spoon' | 'classic' | 'colored' | 'spacex'
export type IconStyle = 'mono' | 'color'
export type AccentId = 'blue' | 'violet' | 'red' | 'teal' | 'amber' | 'silver' | 'custom'

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

export interface RepoWorkspace {
  id: string
  name: string
  color: string
  repos: string[]
}

export interface SessionTab {
  path: string
  name: string
  workspaceId?: string
  color?: string
}

export interface AppSession {
  tabs: SessionTab[]
  activePath?: string | null
  collapsedGroups?: Record<string, boolean>
}

export interface WorkspaceSuggestion {
  name: string
  repos: string[]
  rationale: string
}

export interface WorkspaceAnalysis {
  summary: string
  workspaces: WorkspaceSuggestion[]
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

export type WindowMaterial = 'mica' | 'acrylic' | 'none'
export type RepoSort = 'name' | 'opened' | 'changes' | 'behind' | 'ahead' | 'status'

export interface Settings {
  avatarOverrides?: Record<string, string>
  avatarRevision?: number
  profileEmail?: string
  theme: ThemeMode
  themePack: ThemePack
  appearanceVersion?: number
  iconStyle: IconStyle
  accentId: AccentId
  accentCustom?: string
  gitPath?: string
  fetchIntervalMin: number
  autoFetch: boolean
  autoFetchAll: boolean
  autoUpdate: boolean
  material: WindowMaterial
  watchedRoots: string[]
  pinned: string[]
  onboarded: boolean
  editor: 'code' | 'cursor' | 'explorer'
  /** Preferred external launcher id (IDE, agent, CLI, or system). */
  defaultLauncher?: string
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
  historyLayout?: 'bottom' | 'side' | 'columns'
  commitBoxHeight: number
  hideUntracked: boolean
  ignoreWhitespace: boolean
  diffMode: 'unified' | 'split'
  showAvatars: boolean
  glass: number
  windowBounds?: { x: number; y: number; width: number; height: number }
  repoSort: RepoSort
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

export interface RepoOverview {
  path: string
  name: string
  exists: boolean
  unsafe: boolean
  branch: string
  detached: boolean
  upstream?: string
  ahead: number
  behind: number
  staged: number
  unstaged: number
  untracked: number
  conflicts: number
  operation?: 'merge' | 'rebase' | 'cherry-pick' | 'revert' | 'bisect'
  remoteUrl?: string
  lastCommit?: { subject: string; author: string; date: number }
  error?: string
  checkedAt: number
}

export type RepoFixId =
  | 'safe-directory'
  | 'remove-lock'
  | 'abort-operation'
  | 'publish-branch'
  | 'track-upstream'
  | 'pull-ff'
  | 'prune'
  | 'gc'
  | 'submodules'
  | 'delete-gone-branches'
  | 'checkout-default'
  | 'set-identity'
  | 'remove-missing'

export interface RepoIssue {
  id: string
  severity: 'error' | 'warn' | 'info'
  title: string
  detail: string
  fix?: { id: RepoFixId; label: string; destructive?: boolean }
}

export interface RepoHealth {
  path: string
  issues: RepoIssue[]
  checkedAt: number
}

export type BulkAction = 'fetch' | 'pull' | 'push' | 'refresh'

export interface BulkResult {
  path: string
  name: string
  ok: boolean
  skipped?: boolean
  message: string
}

export interface UpdateState {
  status: 'idle' | 'checking' | 'available' | 'downloading' | 'ready' | 'none' | 'error' | 'disabled'
  version?: string
  notes?: string
  percent?: number
  error?: string
}

export interface AboutInfo {
  version: string
  electron: string
  chrome: string
  node: string
}

export interface ChangeBriefFile {
  path: string
  status: string
  patch: string
}
