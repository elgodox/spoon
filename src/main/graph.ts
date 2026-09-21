import type { CommitInfo } from '../shared/types'

export function layoutGraph(commits: CommitInfo[]): CommitInfo[] {
  const lanes: (string | null)[] = []
  const assigned = new Map<string, number>()

  for (const commit of commits) {
    let lane = assigned.get(commit.hash)
    if (lane === undefined) {
      lane = firstEmpty(lanes)
      if (lane === -1) {
        lane = lanes.length
        lanes.push(commit.hash)
      } else {
        lanes[lane] = commit.hash
      }
      assigned.set(commit.hash, lane)
    }
    commit.lane = lane
    const lanesIn = occupied(lanes)
    if (!lanesIn.includes(lane)) lanesIn.push(lane)

    const [first, ...rest] = commit.parents
    if (first) {
      const existing = assigned.get(first)
      if (existing === undefined) {
        assigned.set(first, lane)
        lanes[lane] = first
        commit.parentLanes = [lane]
      } else {
        lanes[lane] = null
        commit.parentLanes = [existing]
      }
    } else {
      lanes[lane] = null
      commit.parentLanes = []
    }

    const mergeLanes: number[] = []
    for (const parent of rest) {
      let pl = assigned.get(parent)
      if (pl === undefined) {
        pl = firstEmpty(lanes)
        if (pl === -1) {
          pl = lanes.length
          lanes.push(parent)
        } else {
          lanes[pl] = parent
        }
        assigned.set(parent, pl)
      }
      mergeLanes.push(pl)
    }
    commit.mergeLanes = mergeLanes
    while (lanes.length && lanes[lanes.length - 1] === null) lanes.pop()
    const lanesOut = occupied(lanes)
    commit.lanesIn = lanesIn
    commit.lanesOut = lanesOut
    commit.maxLane = Math.max(lanes.length - 1, commit.lane, ...lanesIn, ...lanesOut, 0)
  }

  let globalMax = 0
  for (const c of commits) globalMax = Math.max(globalMax, c.maxLane)
  for (const c of commits) c.maxLane = globalMax
  return commits
}

function occupied(lanes: (string | null)[]): number[] {
  const out: number[] = []
  for (let i = 0; i < lanes.length; i++) if (lanes[i] !== null) out.push(i)
  return out
}

function firstEmpty(lanes: (string | null)[]): number {
  for (let i = 0; i < lanes.length; i++) if (lanes[i] === null) return i
  return -1
}
