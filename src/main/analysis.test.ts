import { fallbackAnalysis, fileDependencies, parseAnalysis, repairCommitOrder } from './analysis.ts'
import type { ChangeBriefFile } from '../shared/types'

const known = ['src/app.ts', 'src/git.ts', 'README.md']
const parsed = parseAnalysis(
  '```json\n{"summary":"Two features.","commits":[{"subject":"feat: add app","body":"why","files":["src/app.ts","src/missing.ts"],"rationale":"app"},{"subject":"fix: git","files":["src/git.ts","src/app.ts"],"rationale":"git"}]}\n```',
  known
)
if (parsed.summary !== 'Two features.') throw new Error('summary')
if (parsed.commits.length !== 3) throw new Error('expected assigned commits plus remainder')
if (parsed.commits[0].files.join() !== 'src/app.ts') throw new Error('unknown file leaked or duplicate')
if (parsed.commits[1].files.join() !== 'src/git.ts') throw new Error('file reused')
if (parsed.commits[2].files.join() !== 'README.md') throw new Error('remainder missing')

const files: ChangeBriefFile[] = [
  { path: 'src/ui/App.tsx', status: 'unstaged M', patch: '' },
  { path: 'src/ui/styles.css', status: 'unstaged M', patch: '' },
  { path: 'README.md', status: 'untracked', patch: '' }
]
const grouped = fallbackAnalysis(files)
if (grouped.commits.length !== 2) throw new Error('folder groups')
const ui = grouped.commits.find((commit) => commit.files.includes('src/ui/App.tsx'))
if (!ui || !ui.files.includes('src/ui/styles.css')) throw new Error('ui files split')

let threw = false
try {
  parseAnalysis('not json', known)
} catch {
  threw = true
}
if (!threw) throw new Error('invalid analysis should fail')

function plan(summary: string, commits: { subject: string; files: string[] }[]) {
  return {
    summary,
    commits: commits.map((commit) => ({ ...commit, body: '', rationale: '' }))
  }
}

const callerFirst = repairCommitOrder(
  plan('Use the api before it exists.', [
    { subject: 'feat: use api', files: ['src/app.ts'] },
    { subject: 'feat: add api', files: ['src/api.ts'] }
  ]),
  [
    { path: 'src/app.ts', status: 'unstaged M', patch: "diff --git a/src/app.ts b/src/app.ts\n@@\n+import { api } from './api'\n" },
    { path: 'src/api.ts', status: 'untracked', patch: 'export const api = 1\n' }
  ]
)
const appAt = callerFirst.commits.findIndex((commit) => commit.files.includes('src/app.ts'))
const apiAt = callerFirst.commits.findIndex((commit) => commit.files.includes('src/api.ts'))
if (apiAt < 0 || apiAt > appAt) throw new Error('new api committed after its caller')
if (!callerFirst.summary.includes('Adjusted so each commit stays valid')) throw new Error('order note missing')

const alreadyOrdered = repairCommitOrder(
  plan('Api first.', [
    { subject: 'feat: add api', files: ['src/api.ts'] },
    { subject: 'feat: use api', files: ['src/app.ts'] }
  ]),
  [
    { path: 'src/api.ts', status: 'untracked', patch: 'export const api = 1\n' },
    { path: 'src/app.ts', status: 'unstaged M', patch: "diff --git a/src/app.ts b/src/app.ts\n@@\n+import { api } from './api'\n" }
  ]
)
if (alreadyOrdered.commits.length !== 2) throw new Error('valid order was merged')
if (alreadyOrdered.summary.includes('Adjusted')) throw new Error('valid order was marked adjusted')

const unrelated = repairCommitOrder(
  plan('Separate.', [
    { subject: 'feat: app', files: ['src/app.ts'] },
    { subject: 'feat: extra', files: ['src/api-extra.ts'] }
  ]),
  [
    { path: 'src/app.ts', status: 'unstaged M', patch: "diff --git a/src/app.ts b/src/app.ts\n@@\n+import { api } from './api'\n" },
    { path: 'src/api-extra.ts', status: 'untracked', patch: 'export const extra = 1\n' }
  ]
)
if (unrelated.commits.length !== 2) throw new Error('unrelated file was pulled in')

const nested = repairCommitOrder(
  plan('Caller only.', [{ subject: 'feat: screen', files: ['src/ui/App.tsx'] }]),
  [
    { path: 'src/ui/App.tsx', status: 'staged M', patch: "diff --git a/src/ui/App.tsx b/src/ui/App.tsx\n@@\n+import { x } from '../lib/x'\n" },
    { path: 'src/lib/x.ts', status: 'untracked', patch: 'export const x = 1\n' }
  ]
)
if (!nested.commits[0].files.includes('src/lib/x.ts')) throw new Error('parent import was not pulled forward')

const deletion = repairCommitOrder(
  plan('Delete first.', [
    { subject: 'chore: delete old', files: ['src/old.ts'] },
    { subject: 'refactor: drop import', files: ['src/app.ts'] }
  ]),
  [
    { path: 'src/old.ts', status: 'staged D', patch: 'diff --git a/src/old.ts b/src/old.ts\ndeleted file\n@@\n-export const old = 1\n' },
    { path: 'src/app.ts', status: 'unstaged M', patch: "diff --git a/src/app.ts b/src/app.ts\n@@\n-import { old } from './old'\n" }
  ]
)
const oldAt = deletion.commits.findIndex((commit) => commit.files.includes('src/old.ts'))
const dropAt = deletion.commits.findIndex((commit) => commit.files.includes('src/app.ts'))
if (oldAt < 0 || dropAt < 0 || oldAt < dropAt) throw new Error('deletion landed before its import was removed')

const chain = fileDependencies([
  { path: 'src/app.ts', status: 'staged M', patch: "diff --git a/src/app.ts b/src/app.ts\n@@\n+import { api } from './api'\n" },
  { path: 'src/api.ts', status: 'untracked', patch: "export { util } from './util'\n" },
  { path: 'src/util.ts', status: 'untracked', patch: 'export const util = 1\n' }
])
if (!chain.get('src/app.ts')?.includes('src/api.ts')) throw new Error('app dependency missing')
if (!chain.get('src/api.ts')?.includes('src/util.ts')) throw new Error('api dependency missing')
const chained = repairCommitOrder(
  plan('App only.', [{ subject: 'feat: app', files: ['src/app.ts'] }]),
  [
    { path: 'src/app.ts', status: 'staged M', patch: "diff --git a/src/app.ts b/src/app.ts\n@@\n+import { api } from './api'\n" },
    { path: 'src/api.ts', status: 'untracked', patch: "export { util } from './util'\n" },
    { path: 'src/util.ts', status: 'untracked', patch: 'export const util = 1\n' }
  ]
)
if (!chained.commits[0].files.includes('src/util.ts')) throw new Error('transitive dependency was left out')

console.log('analysis tests ok')
