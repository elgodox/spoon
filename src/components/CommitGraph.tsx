import React from 'react';
import { GitCommit, GitBranch } from '../types';

interface CommitGraphProps {
  commits: GitCommit[];
  branches: GitBranch[];
  currentBranch?: string | null;
  onCheckout?: (commit: GitCommit) => void;
}

interface GraphCommit extends GitCommit {
  lane: number;
  x: number;
}

export const CommitGraph: React.FC<CommitGraphProps> = ({
  commits,
  currentBranch,
  onCheckout,
}) => {
  if (!commits.length) {
    return <div className="p-3 text-xs text-zinc-400">Sin historial de commits.</div>;
  }

  // We receive newest first from git log. Reverse to process oldest → newest for layout
  const reversed = [...commits].reverse();

  // Simple lane assignment (greedy)
  const hashToLane = new Map<string, number>();
  let maxLane = 0;

  const processed = reversed.map((c) => {
    let lane = hashToLane.get(c.hash);

    if (lane === undefined) {
      // Try to inherit from first parent if it already has lane
      if (c.parents.length > 0) {
        const parentLane = hashToLane.get(c.parents[0]);
        if (parentLane !== undefined) {
          lane = parentLane;
        }
      }
    }

    if (lane === undefined) {
      // Find a free lane or use next
      const used = new Set(Array.from(hashToLane.values()));
      let candidate = 0;
      while (used.has(candidate)) candidate++;
      lane = candidate;
    }

    hashToLane.set(c.hash, lane);
    maxLane = Math.max(maxLane, lane);

    // Pre-assign parents to same lane if they don't have one yet (helps linear history)
    c.parents.forEach((p, i) => {
      if (!hashToLane.has(p) && i === 0) {
        hashToLane.set(p, lane);
      }
    });

    return { ...c, lane, x: lane * 14 } as GraphCommit;
  });

  // Back to newest-first for display
  const displayCommits: GraphCommit[] = [...processed].reverse();

  const rowHeight = 42;
  const graphWidth = Math.max(70, (maxLane + 1) * 14 + 8);
  const svgHeight = displayCommits.length * rowHeight;

  // Build connections (from commit to its parents)
  const connections: Array<{
    fromY: number;
    fromX: number;
    toY: number;
    toX: number;
    color: string;
  }> = [];

  const laneColors = ['#a78bfa', '#60a5fa', '#f472b6', '#4ade80', '#fb923c', '#facc15'];

  displayCommits.forEach((commit, idx) => {
    const fromY = idx * rowHeight + rowHeight / 2;
    const fromX = commit.x + 7;

    commit.parents.forEach((parentHash) => {
      // Find parent in the display list
      const parentIdx = displayCommits.findIndex((c) => c.hash === parentHash);
      if (parentIdx === -1) return;

      const parent = displayCommits[parentIdx];
      const toY = parentIdx * rowHeight + rowHeight / 2;
      const toX = parent.x + 7;

      const color = laneColors[commit.lane % laneColors.length];

      connections.push({
        fromY,
        fromX,
        toY,
        toX,
        color,
      });
    });
  });

  return (
    <div className="flex h-full overflow-hidden text-xs">
      {/* Graph column */}
      <div className="relative flex-shrink-0 border-r border-[#2a2a2f] bg-[#0f0f11]" style={{ width: graphWidth }}>
        <svg width={graphWidth} height={svgHeight} className="block">
          {/* Vertical lane lines (faint) */}
          {Array.from({ length: maxLane + 1 }).map((_, lane) => (
            <line
              key={lane}
              x1={lane * 14 + 7}
              y1={0}
              x2={lane * 14 + 7}
              y2={svgHeight}
              stroke="#27272a"
              strokeWidth="1.5"
            />
          ))}

          {/* Connection lines */}
          {connections.map((conn, i) => {
            const isStraight = Math.abs(conn.fromX - conn.toX) < 2;
            return (
              <g key={i}>
                {isStraight ? (
                  <line
                    x1={conn.fromX}
                    y1={conn.fromY}
                    x2={conn.toX}
                    y2={conn.toY}
                    stroke={conn.color}
                    strokeWidth="2.5"
                    strokeOpacity={0.75}
                  />
                ) : (
                  // Fork / merge curve
                  <>
                    <line
                      x1={conn.fromX}
                      y1={conn.fromY}
                      x2={conn.fromX}
                      y2={conn.toY}
                      stroke={conn.color}
                      strokeWidth="2"
                      strokeOpacity={0.65}
                    />
                    <line
                      x1={conn.fromX}
                      y1={conn.toY}
                      x2={conn.toX}
                      y2={conn.toY}
                      stroke={conn.color}
                      strokeWidth="2"
                      strokeOpacity={0.65}
                    />
                  </>
                )}
              </g>
            );
          })}

          {/* Commit dots */}
          {displayCommits.map((c, index) => {
            const y = index * rowHeight + rowHeight / 2;
            const isCurrent = currentBranch && c.refs.some(r => r.includes(currentBranch));
            const color = laneColors[c.lane % laneColors.length];

            return (
              <g key={c.hash}>
                {/* Outer ring for HEAD */}
                {isCurrent && (
                  <circle
                    cx={c.x + 7}
                    cy={y}
                    r="8"
                    fill="none"
                    stroke="#22c55e"
                    strokeWidth="1.5"
                  />
                )}
                <circle
                  cx={c.x + 7}
                  cy={y}
                  r={isCurrent ? "5" : "4.5"}
                  fill={color}
                  stroke="#111113"
                  strokeWidth="1.5"
                />
              </g>
            );
          })}
        </svg>
      </div>

      {/* Commit list */}
      <div className="flex-1 overflow-auto custom-scrollbar">
        {displayCommits.map((commit) => {
          const isCurrent = currentBranch && commit.refs.some(r => r.includes(currentBranch || ''));

          return (
            <div
              key={commit.hash}
              onClick={() => onCheckout && onCheckout(commit)}
              className={`flex items-start gap-3 px-3 py-[7px] border-b border-[#1f1f23] hover:bg-[#1a1a1d] cursor-pointer group ${isCurrent ? 'bg-[#14532d]/30' : ''}`}
              style={{ minHeight: rowHeight }}
            >
              <div className="pt-1 w-[52px] flex-shrink-0 font-mono text-[10px] text-emerald-400/80 group-hover:text-emerald-400">
                {commit.short_hash}
              </div>

              <div className="flex-1 min-w-0">
                <div className="text-[#e5e5e5] leading-snug pr-2 line-clamp-2">
                  {commit.message}
                </div>
                <div className="flex items-center gap-2 text-[10px] text-zinc-400 mt-0.5">
                  <span>{commit.author.split(' ')[0]}</span>
                  <span>•</span>
                  <span>{new Date(commit.date).toLocaleDateString([], { month: 'short', day: 'numeric' })}</span>
                  {commit.refs.length > 0 && (
                    <span className="ml-1 text-[9px] px-1 py-px bg-zinc-800 rounded text-zinc-400">
                      {commit.refs[0]}
                    </span>
                  )}
                  {isCurrent && <span className="text-emerald-400 font-medium">HEAD</span>}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default CommitGraph;
