/**
 * Which commit-level actions the graph can offer — decided from the loaded
 * page alone.
 *
 * `git cherry-pick` is the constrained one. It "requires your working tree to
 * be clean" (git-cherry-pick(1)); it "usually cannot cherry-pick a merge
 * because you do not know which side of the merge should be considered the
 * mainline" without `-m <parent>`; and replaying a commit that is already in
 * HEAD's history applies nothing, so git stops with "the previous cherry-pick
 * is now empty" and leaves CHERRY_PICK_HEAD behind. The first two are
 * permanent for a given commit — the button is not offered at all. The third
 * is temporary, so it renders disabled with the reason.
 */

import type { GitCommit } from "../contract";

/** Hash-prefix match: the log carries abbreviated parents against full hashes. */
function isSameHash(h1: string | null | undefined, h2: string | null | undefined): boolean {
  if (!h1 || !h2) return false;
  if (h1 === h2) return true;
  const minLen = Math.min(h1.length, h2.length);
  if (minLen >= 4) return h1.substring(0, minLen) === h2.substring(0, minLen);
  return false;
}

/**
 * Commits reachable from the checked-out HEAD by walking parents inside the
 * loaded page — "already in this branch".
 *
 * `git log` is ordered children-before-parents, and the page is a prefix of
 * that order, so every ancestor of a commit in the page is also in the page:
 * the walk is exact for what the renderer can see. A page that does not hold
 * HEAD (only possible when the caller skipped past it) yields an empty set.
 */
export function reachableFromHead(commits: GitCommit[]): Set<string> {
  const byPrefix = new Map<string, GitCommit>();
  for (const commit of commits) byPrefix.set(commit.hash.substring(0, 7), commit);

  const head = commits.find((commit) => (commit.refs ?? []).some((ref) => ref.startsWith("HEAD")));
  const reachable = new Set<string>();
  if (head === undefined) return reachable;

  const queue: GitCommit[] = [head];
  while (queue.length > 0) {
    const commit = queue.pop() as GitCommit;
    if (reachable.has(commit.hash)) continue;
    reachable.add(commit.hash);
    for (const parent of commit.parents ?? []) {
      const next = byPrefix.get(parent.substring(0, 7));
      if (next !== undefined) queue.push(next);
    }
  }
  return reachable;
}

export interface CherryPickState {
  /** Render the button at all; false when a pick can never apply to this commit. */
  show: boolean;
  /** …and let it run: false while the graph is dirty or another action is busy. */
  enabled: boolean;
  /** Why it is unavailable, for the button's tooltip. */
  reason: string | null;
}

/**
 * @param commits the loaded page, newest first
 * @param hash the selected commit's full hash
 * @param dirty the working tree has uncommitted changes to tracked files
 */
export function computeCherryPickState(
  commits: GitCommit[],
  hash: string,
  dirty: boolean,
): CherryPickState {
  const commit = commits.find((candidate) => isSameHash(candidate.hash, hash));
  if (commit === undefined) return { show: false, enabled: false, reason: null };

  if ((commit.parents?.length ?? 0) > 1) {
    return {
      show: false,
      enabled: false,
      reason: "Cherry-picking a merge needs a mainline parent.",
    };
  }

  if (reachableFromHead(commits).has(commit.hash)) {
    return { show: false, enabled: false, reason: "Already in the current branch." };
  }

  if (dirty) {
    return { show: true, enabled: false, reason: "Commit or stash your changes first." };
  }

  return { show: true, enabled: true, reason: null };
}
