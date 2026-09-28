/**
 * Pure parsers for `git status --porcelain` and `git for-each-ref` output —
 * split out of `git-status.ts` so they carry no runtime imports (the reader
 * spawns processes; the parsers only answer for a string) and stay unit
 * testable under plain `node --test`.
 */

import type { GitChange } from "../contract";

/**
 * Parses `git status --porcelain=v1 -uall` output into panel changes.
 * Quoted paths are JSON-unquoted, renames resolve to their "to" side, and the
 * staged flag mirrors the porcelain columns: column one is the index
 * (staged), column two is the worktree.
 */
export function parsePorcelain(statusOut: string): GitChange[] {
  return statusOut
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const status = line.slice(0, 2);
      let file = line.slice(3);

      if (file.startsWith("\"") && file.endsWith("\"")) {
        try {
          file = JSON.parse(file);
        } catch {
          // Malformed quoting — keep the raw name rather than dropping the row.
        }
      }
      if (file.includes(" -> ")) {
        file = file.split(" -> ")[1].trim();
      }

      const isStaged = status[0] !== " " && status[0] !== "?";
      return { status, file: file.trim(), staged: isStaged };
    })
    .filter((change) => change.file !== "");
}

export interface RefsInfo {
  branch: string;
  branches: string[];
  remoteBranches: string[];
}

/**
 * Parses one `git for-each-ref` listing covering refs/heads and refs/remotes.
 * Classification reads the FULL refname: `%(refname:short)` maps
 * `refs/remotes/origin/HEAD` to the bare `origin`, which has no slash and
 * would otherwise be listed as a local branch. `%(HEAD)` marks the
 * checked-out branch with `*`.
 */
export function parseRefs(refsOut: string): RefsInfo {
  let branch = "";
  const branches: string[] = [];
  const remoteBranches: string[] = [];
  let sawHead = false;

  for (const line of refsOut.split("\n")) {
    const [full, short, head] = line.split("\t");
    if (!full || !short) continue;
    if (full.endsWith("/HEAD")) continue; // symbolic alias, not a branch
    if (full.startsWith("refs/remotes/")) {
      remoteBranches.push(short);
      continue;
    }
    branches.push(short);
    if (head === "*") {
      branch = short;
      sawHead = true;
    }
  }
  return { branch: sawHead ? branch : "", branches, remoteBranches };
}
