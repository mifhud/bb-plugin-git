/**
 * Commit-graph lane math — ported from ompchamber's
 * `shared/lib/fs/git-graph.ts`: lane assignment walks commits newest-first,
 * `computeGraphLinks` connects nodes (or runs a continuation line off the
 * bottom for parents beyond the loaded page), and `buildBezierPath` curves
 * lane changes. Pure functions; the renderer draws the result.
 */

import type { GitCommit } from "../shared";

export const LANE_COLORS = [
  "#38bdf8", // sky/blue
  "#f97316", // orange
  "#a855f7", // purple
  "#10b981", // emerald
  "#ec4899", // pink
  "#eab308", // amber
  "#06b6d4", // cyan
  "#6366f1", // indigo
];

export interface GraphLink {
  fromHash: string;
  toHash: string;
  fromLane: number;
  toLane: number;
  fromY: number;
  toY: number;
  color: string;
}

/** Match full hashes against short ones (7-char parent vs 40-char commit). */
function isSameHash(h1: string | null | undefined, h2: string | null | undefined): boolean {
  if (!h1 || !h2) return false;
  if (h1 === h2) return true;
  const minLen = Math.min(h1.length, h2.length);
  if (minLen >= 4) return h1.substring(0, minLen) === h2.substring(0, minLen);
  return false;
}

/**
 * Assigns a lane (column) to every commit, walking newest-first the way
 * `git log --graph` does. A lane holds the hash it expects to see next — a
 * pending parent — so a commit either claims the lane already waiting for it
 * or takes a free one.
 *
 * Two invariants keep the drawing honest:
 *
 * - **a hash is pending in at most one lane.** Without this, a second child
 *   of the same parent parks a lane on a parent another lane already owns;
 *   that lane is never claimed again, so it stays occupied forever and pushes
 *   every later branch one column to the right.
 * - **the first parent keeps the commit's own lane, unless another lane
 *   already owns it.** In that case the lane is released and the link becomes
 *   the fold-back curve: a branch rejoining the line it was cut from.
 */
export function computeCommitLanes(commits: GitCommit[]): Map<string, number> {
  const laneMap = new Map<string, number>();
  const pending: (string | null)[] = [];

  /** Lane already waiting for `hash`, else the first free lane. */
  const claim = (hash: string): number => {
    const waiting = pending.findIndex((target) => isSameHash(target, hash));
    if (waiting !== -1) return waiting;
    const free = pending.indexOf(null);
    if (free !== -1) {
      pending[free] = hash;
      return free;
    }
    pending.push(hash);
    return pending.length - 1;
  };

  for (const commit of commits) {
    const lane = claim(commit.hash);
    laneMap.set(commit.hash, lane);

    // Any other lane still waiting on this commit duplicates `lane`: release
    // it so the column can carry a different branch again.
    for (let i = 0; i < pending.length; i++) {
      if (i !== lane && isSameHash(pending[i], commit.hash)) pending[i] = null;
    }

    const [firstParent, ...otherParents] = commit.parents ?? [];
    if (firstParent === undefined || firstParent === "") {
      pending[lane] = null;
      continue;
    }

    const firstParentOwnedElsewhere = pending.some(
      (target, i) => i !== lane && isSameHash(target, firstParent),
    );
    pending[lane] = firstParentOwnedElsewhere ? null : firstParent;

    // Extra parents (merges) open a lane of their own unless one is already
    // waiting for them.
    for (const parent of otherParents) {
      if (parent !== "" && !pending.some((target) => isSameHash(target, parent))) {
        claim(parent);
      }
    }
  }

  return laneMap;
}

/** Generate continuous links connecting nodes (or tails off the loaded page). */
export function computeGraphLinks(
  commits: GitCommit[],
  laneMap: Map<string, number>,
  positions: Record<string, number>,
  totalHeight: number,
): GraphLink[] {
  const links: GraphLink[] = [];
  const hashToIndex = new Map<string, number>();

  commits.forEach((c, idx) => {
    hashToIndex.set(c.hash, idx);
    if (c.shortHash) hashToIndex.set(c.shortHash, idx);
    if (c.hash.length >= 7) hashToIndex.set(c.hash.substring(0, 7), idx);
  });

  for (const commit of commits) {
    const fromLane = laneMap.get(commit.hash) ?? 0;
    const fromY = positions[commit.hash] ?? 0;
    const color = LANE_COLORS[fromLane % LANE_COLORS.length];

    if (!commit.parents || commit.parents.length === 0) continue;

    for (const parentHash of commit.parents) {
      let parentIdx = hashToIndex.get(parentHash);
      if (typeof parentIdx !== "number" && parentHash.length >= 7) {
        parentIdx = hashToIndex.get(parentHash.substring(0, 7));
      }

      if (typeof parentIdx === "number") {
        const parentCommit = commits[parentIdx];
        const toLane = laneMap.get(parentCommit.hash) ?? fromLane;
        const toY = positions[parentCommit.hash] ?? fromY + 60;
        links.push({
          fromHash: commit.hash,
          toHash: parentCommit.hash,
          fromLane,
          toLane,
          fromY,
          toY,
          color: LANE_COLORS[fromLane % LANE_COLORS.length],
        });
      } else {
        // Parent is beyond the loaded commits: draw a continuation to the bottom.
        links.push({
          fromHash: commit.hash,
          toHash: `tail-${commit.hash}`,
          fromLane,
          toLane: fromLane,
          fromY,
          toY: Math.max(fromY + 80, totalHeight),
          color,
        });
      }
    }
  }

  return links;
}

/** Build a smooth cubic bezier path between two lane coordinates. */
export function buildBezierPath(x1: number, y1: number, x2: number, y2: number): string {
  if (Math.abs(x1 - x2) < 1) {
    return `M ${x1} ${y1} L ${x2} ${y2}`;
  }
  const dy = y2 - y1;
  const cp1Y = y1 + dy * 0.45;
  const cp2Y = y2 - dy * 0.45;
  return `M ${x1} ${y1} C ${x1} ${cp1Y}, ${x2} ${cp2Y}, ${x2} ${y2}`;
}
