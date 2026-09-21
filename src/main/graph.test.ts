import { layoutGraph } from './graph.ts'
import type { CommitInfo } from '../shared/types'

function c(hash: string, parents: string[]): CommitInfo {
  return {
    hash,
    shortHash: hash.slice(0, 7),
    parents,
    author: 'a',
    email: 'a@b.c',
    committer: 'a',
    committerEmail: 'a@b.c',
    date: 0,
    subject: hash,
    body: '',
    refs: [],
    lane: 0,
    maxLane: 0,
    parentLanes: [],
    mergeLanes: [],
    lanesIn: [],
    lanesOut: []
  }
}

const linear = layoutGraph([c('c3', ['c2']), c('c2', ['c1']), c('c1', [])])
if (linear[0].lane !== 0 || linear[2].lane !== 0) throw new Error('linear lanes')

const merge = layoutGraph([c('m', ['a', 'b']), c('a', ['r']), c('b', ['r']), c('r', [])])
if (merge[0].mergeLanes.length !== 1) throw new Error('merge lane missing')
if (!merge[1].lanesIn.includes(0) || !merge[1].lanesOut.includes(0)) throw new Error('through lane missing')

console.log('graph tests ok')
