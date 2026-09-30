import type { DiffHunk, DiffLine, FileDiff } from './types'

/** Map a deletion to the next surviving line in the working file. */
export function workingLine(hunk: DiffHunk, line: DiffLine): number {
  let next = Math.max(1, hunk.newStart)
  for (const candidate of hunk.lines) {
    if (candidate === line) return Math.max(1, candidate.newNo ?? next)
    if (candidate.newNo !== undefined) next = candidate.newNo + 1
  }
  return next
}

export function firstChangedLine(diff?: FileDiff): number {
  for (const hunk of diff?.hunks ?? []) {
    const line = hunk.lines.find((item) => item.type === 'add' || item.type === 'del')
    if (line) return workingLine(hunk, line)
  }
  return 1
}

/** Translate an index line through additional unstaged edits before opening the working file. */
export function mapIndexLine(line: number, working?: FileDiff): number {
  let offset = 0
  for (const hunk of working?.hunks ?? []) {
    if (hunk.oldCount === 0) {
      if (line > hunk.oldStart) offset += hunk.newCount
      continue
    }
    if (line < hunk.oldStart) break
    if (line >= hunk.oldStart + hunk.oldCount) { offset += hunk.newCount - hunk.oldCount; continue }
    const target = hunk.lines.find((item) => item.oldNo === line)
    return target ? workingLine(hunk, target) : Math.max(1, hunk.newStart)
  }
  return Math.max(1, line + offset)
}
