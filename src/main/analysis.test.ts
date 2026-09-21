import { fallbackAnalysis, parseAnalysis } from './analysis.ts'
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

console.log('analysis tests ok')
