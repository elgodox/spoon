import {
  fallbackWorkspaceAnalysis,
  folderLabel,
  parentDir,
  parseWorkspaceAnalysis
} from '../shared/workspaces.ts'

const repos = [
  { path: 'D:/code/spoon/app', name: 'spoon' },
  { path: 'D:/code/spoon/api', name: 'spoon-api' },
  { path: 'D:/code/other/notes', name: 'notes' }
]

if (parentDir('D:\\code\\spoon\\app') !== 'D:/code/spoon') throw new Error('parentDir')
if (folderLabel('D:/code/spoon/app') !== 'spoon') throw new Error('folderLabel')

const parsed = parseWorkspaceAnalysis(
  '```json\n{"summary":"Related spoon apps.","workspaces":[{"name":"Spoon","repos":["D:/code/spoon/app","spoon-api"],"rationale":"same product"},{"name":"Notes","repos":["notes","missing"],"rationale":"solo"}]}\n```',
  repos
)
if (parsed.summary !== 'Related spoon apps.') throw new Error('summary')
if (parsed.workspaces.length !== 2) throw new Error('workspace count')
if (parsed.workspaces[0].repos.join() !== 'D:/code/spoon/app,D:/code/spoon/api') throw new Error('path resolve')
if (parsed.workspaces[1].repos.join() !== 'D:/code/other/notes') throw new Error('name resolve')

let threw = false
try {
  parseWorkspaceAnalysis('not json', repos)
} catch {
  threw = true
}
if (!threw) throw new Error('invalid analysis should fail')

const grouped = fallbackWorkspaceAnalysis(repos)
if (grouped.workspaces.length !== 1) throw new Error('fallback should keep multi-repo folder only')
if (grouped.workspaces[0].name !== 'spoon') throw new Error('fallback folder name')
if (!grouped.workspaces[0].repos.includes('D:/code/spoon/app')) throw new Error('fallback members')

console.log('workspace analysis tests ok')
