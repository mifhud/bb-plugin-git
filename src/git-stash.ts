/**
 * Stash reader — the read half of the Git stash panel. The pure line parser
 * lives in `git-parse.ts`; this module only spawns git and joins the answer,
 * mirroring `git-status.ts` (same "non-repo → empty, never throw" contract).
 */

import type { GitStash, GitStashFile } from "../contract";
import { parseStash } from "./git-parse.ts";
import { gitOk, runGit } from "./shell.ts";

export { parseStash } from "./git-parse.ts";
export type { GitStash } from "../contract";

/**
 * Lists stashes for one working tree via `git stash list`. A non-zero exit
 * (folder is not a repository, or any other failure) answers `[]` rather than
 * throwing — the panel shows an empty list, the same "not a git repository"
 * contract `readStatus` keeps for its data.
 */
export async function readStashList(targetDir: string): Promise<GitStash[]> {
  const result = await runGit(["stash", "list"], { cwd: targetDir });
  if (!gitOk(result)) return [];
  return parseStash(result.stdout);
}

/**
 * Lists files changed by one stash via `git stash show --numstat`.
 * Returns an empty array on failure (same non-throwing contract as readStashList).
 */
export async function fetchStashFiles(targetDir: string, ref: string): Promise<GitStashFile[]> {
  const result = await runGit(["stash", "show", "--numstat", "--format=", ref], { cwd: targetDir });
  if (!gitOk(result)) return [];
  const files: GitStashFile[] = [];
  for (const line of result.stdout.split("\n")) {
    if (line.trim() === "") continue;
    const parts = line.split("\t");
    if (parts.length !== 3) continue;
    const [addStr, delStr, file] = parts;
    const additions = addStr === "-" ? undefined : parseInt(addStr, 10);
    const deletions = delStr === "-" ? undefined : parseInt(delStr, 10);
    files.push({
      file,
      ...(additions !== undefined ? { additions } : {}),
      ...(deletions !== undefined ? { deletions } : {}),
    });
  }
  return files;
}

/**
 * Diff of one file inside one stash via `git diff <ref>^1 <ref> -- <file>`.
 * A stash commit is a merge (index + worktree parents), so `git show`
 * refuses to emit a plain per-file diff; `git stash show` likewise rejects
 * a `-- <pathspec>` ("Too many revisions"). Diffing `ref^1` (the stashed
 * HEAD) against `ref` yields exactly the change `git stash show -p` shows,
 * but accepts a pathspec filter.
 * Throws with git's stderr on failure; the RPC layer turns that into ok:false.
 */
export async function fetchStashFileDiff(targetDir: string, ref: string, file: string): Promise<string> {
  const result = await runGit(["diff", `${ref}^1`, ref, "--", file], { cwd: targetDir });
  if (!gitOk(result)) {
    throw new Error(result.stderr.trim() || "Could not read stash diff.");
  }
  return result.stdout;
}
