/**
 * Branch / change-list reader — the read half of ompchamber's
 * `GET /api/fs/git`. The string parsers live in `git-parse.ts`; this module
 * only spawns git and joins their answers.
 */

import type { GitChange } from "../contract";
import { parsePorcelain, parseRefs, type RefsInfo } from "./git-parse";
import { gitOk, runGit } from "./shell";

export { parsePorcelain, parseRefs } from "./git-parse";
export type { RefsInfo } from "./git-parse";

export interface StatusRead {
  isRepo: boolean;
  changes: GitChange[];
  branch: string;
  branches: string[];
  remoteBranches: string[];
}

/**
 * Reads status + refs for one working tree in two spawns (one `status`, one
 * `for-each-ref`). A directory that is not a repository answers `isRepo:
 * false` with empty data instead of throwing — the panel shows "not a git
 * repository" rather than an error toast.
 */
export async function readStatus(targetDir: string): Promise<StatusRead> {
  const statusResult = await runGit(["status", "--porcelain=v1", "-uall"], {
    cwd: targetDir,
    maxBuffer: 1024 * 1024,
  });
  if (!gitOk(statusResult)) {
    return { isRepo: false, changes: [], branch: "", branches: [], remoteBranches: [] };
  }

  const refsResult = await runGit(
    ["for-each-ref", "--format=%(refname)%09%(refname:short)%09%(HEAD)", "refs/heads", "refs/remotes"],
    { cwd: targetDir },
  );
  const info: RefsInfo = gitOk(refsResult)
    ? parseRefs(refsResult.stdout)
    : { branch: "", branches: [], remoteBranches: [] };

  let { branch, branches, remoteBranches } = info;
  if (branch === "" && branches.length > 0) {
    // Detached HEAD: no local ref is marked. Ask for the sha `rev-parse`
    // prints rather than reporting a branch the checkout is not on.
    const headResult = await runGit(["rev-parse", "--abbrev-ref", "HEAD"], { cwd: targetDir });
    branch = gitOk(headResult) ? headResult.stdout.trim() : "";
  }
  if (branches.length === 0) {
    branches = branch !== "" ? [branch] : ["main"];
  } else if (branch !== "" && !branches.includes(branch)) {
    branches.unshift(branch);
  }

  return {
    isRepo: true,
    changes: parsePorcelain(statusResult.stdout),
    branch: branch || "main",
    branches,
    remoteBranches,
  };
}
