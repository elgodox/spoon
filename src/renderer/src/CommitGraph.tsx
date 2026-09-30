import type { CommitInfo } from '../../shared/types'
import { laneColor, laneGlow } from './lib'

// Shared by the SVG, rows and virtual scroller so connections meet exactly.
export const COMMIT_ROW_HEIGHT = 38
export const GRAPH_LANE_WIDTH = 22
export const graphWidth = (maxLane: number) => Math.max(66, (maxLane + 1) * GRAPH_LANE_WIDTH + 20)

export function CommitGraph({ commit: c, width, focused, pulseKey, connected = true }: {
  commit: CommitInfo
  width: number
  focused: boolean
  pulseKey: number
  connected?: boolean
}) {
  const mid = COMMIT_ROW_HEIGHT / 2
  const x = (lane: number) => 20 + lane * GRAPH_LANE_WIDTH
  const ins = c.lanesIn ?? [c.lane]
  const outs = c.lanesOut ?? []
  const lanes = new Set([...ins, ...outs, c.lane])
  const curve = (to: number) => `M${x(c.lane)} ${mid} C${x(c.lane)} ${COMMIT_ROW_HEIGHT}, ${x(to)} ${mid}, ${x(to)} ${COMMIT_ROW_HEIGHT}`
  const paths = connected ? [...lanes].flatMap((lane) => {
    const segments: { key: string; d: string; lane: number }[] = []
    if (ins.includes(lane)) segments.push({ key: `in-${lane}`, d: `M${x(lane)} 0V${mid}`, lane })
    if (outs.includes(lane) && (lane === c.lane ? c.parentLanes?.includes(lane) : ins.includes(lane))) {
      segments.push({ key: `out-${lane}`, d: `M${x(lane)} ${mid}V${COMMIT_ROW_HEIGHT}`, lane })
    }
    return segments
  }) : []
  if (connected) {
    for (const lane of [...(c.parentLanes ?? []), ...(c.mergeLanes ?? [])]) {
      if (lane !== c.lane) paths.push({ key: `edge-${lane}`, d: curve(lane), lane })
    }
  }
  const current = c.refs.some((ref) => ref.current)
  return (
    <svg className={`commit-graph ${focused ? 'focused' : ''}`} width={width} height={COMMIT_ROW_HEIGHT} aria-hidden="true">
      {paths.map(({ key, d, lane }) => (
        <g key={key}>
          <path d={d} fill="none" stroke={laneGlow(lane, focused ? .32 : .12)} strokeWidth={7} />
          <path key={`${key}-${focused ? pulseKey : 'idle'}`} d={d} fill="none" stroke={laneColor(lane)}
            strokeWidth={focused ? 2.8 : 2} className={focused && lane === c.lane ? 'lane-pulse' : undefined} />
        </g>
      ))}
      {(current || focused) && <circle cx={x(c.lane)} cy={mid} r={10} fill={laneGlow(c.lane, .22)} />}
      <circle cx={x(c.lane)} cy={mid} r={current ? 6 : 4.5} fill="var(--graph-cutout)" stroke={laneColor(c.lane)} strokeWidth={2.5} />
      {(current || c.parents.length > 1) && <circle cx={x(c.lane)} cy={mid} r={2} fill={laneColor(c.lane)} />}
    </svg>
  )
}
