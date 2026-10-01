/**
 * Commit history and per-commit file diffs — ported from ompchamber's
 * `server/lib/fs/git-log.ts`, without its mock-data fallbacks: an empty
 * history answers with zero commits, which is what a fresh repo actually has.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import type { CommitPage, GitCommit, GitCommitFile } from "../contract";
import { gitOk, runGit } from "./shell.ts";

/**
 * Parses the `COMMIT_SPLIT|~|`-delimited `git log --numstat` stream into
 * commits. Header lines start with the marker; every other line is a numstat
 * row (`additions<TAB>deletions<TAB>file`) belonging to the commit above it.
 */
export function parseGitLogOutput(stdout: string): GitCommit[] {
  const commits: GitCommit[] = [];
  let current: GitCommit | null = null;

  for (const line of stdout.split("\n")) {
    if (line.startsWith("COMMIT_SPLIT|~|")) {
      if (current !== null) commits.push(current);
      const [, hash = "", shortHash = "", author = "", date = "", message = "", refStr = "", parentStr = ""] =
        line.split("|~|");

      const refs = refStr !== "" ? refStr.split(",").map((r) => r.trim()).filter(Boolean) : [];
      const parents = parentStr !== "" ? parentStr.split(/\s+/).map((p) => p.trim()).filter(Boolean) : [];

      current = {
        hash,
        shortHash: shortHash || hash.slice(0, 8),
        author: author || "Unknown",
        date,
        message,
        refs,
        parents,
        files: [],
      };
    } else if (current !== null && line.trim() !== "") {
      const parts = line.split("\t");
      if (parts.length >= 3) {
        const additions = parts[0] === "-" ? 0 : parseInt(parts[0], 10) || 0;
        const deletions = parts[1] === "-" ? 0 : parseInt(parts[1], 10) || 0;
        let file = parts[2].trim();
        if (file.startsWith("\"") && file.endsWith("\"")) {
          try {
            file = JSON.parse(file);
          } catch {
            // Keep the raw name rather than dropping the row.
          }
        }
        let status = "M";
        if (file.includes(" => ")) {
          status = "R";
        } else if (deletions > 0 && additions === 0) {
          status = "D";
        } else if (additions > 0 && deletions === 0) {
          status = "A";
        }
        current.files?.push({ file, status, additions, deletions });
      }
    }
  }
  if (current !== null) commits.push(current);

  return commits;
}

/**
 * Revision scope of the graph. A branch log would only ever show commits the
 * checked-out branch already contains — nothing to cherry-pick, nothing to
 * compare — so the graph walks every local branch, remote-tracking branch and
 * tag, the way GitKraken and VSCode's Source Control Graph do. `HEAD` keeps a
 * detached checkout visible; the stash and notes namespaces stay out.
 */
const GRAPH_REVISIONS = ["HEAD", "--branches", "--remotes", "--tags"];

/** One page of the graph, newest first. `hasMore` drives the Load-more button. */
export async function fetchGitCommits(
  targetDir: string,
  limit: number = 50,
  skip: number = 0,
): Promise<CommitPage> {
  let total = 0;
  const countResult = await runGit(["rev-list", "--count", ...GRAPH_REVISIONS], {
    cwd: targetDir,
    timeout: 10_000,
  });
  if (gitOk(countResult)) total = parseInt(countResult.stdout.trim(), 10) || 0;

  if (total === 0) return { commits: [], hasMore: false, total: 0 };

  const result = await runGit(
    [
      "log",
      `-n${limit}`,
      `--skip=${skip}`,
      "--numstat",
      "--date-order",
      "--pretty=format:COMMIT_SPLIT|~|%H|~|%h|~|%an|~|%ad|~|%s|~|%D|~|%p",
      "--date=format:%b %d, %Y, %I:%M %p",
      ...GRAPH_REVISIONS,
    ],
    { cwd: targetDir, timeout: 15_000 },
  );
  if (!gitOk(result)) return { commits: [], hasMore: false, total };

  const commits = parseGitLogOutput(result.stdout);
  const hasMore = total > 0 ? skip + commits.length < total : commits.length === limit;
  return { commits, hasMore, total };
}

/** Strips numstat's rename notation down to the "to" path git can address. */
function normalizeCommitPath(file: string): string {
  let clean = file.replace(/^\.\//, "").trim();
  if (clean.includes(" => ")) {
    if (clean.includes("{") && clean.includes("}")) {
      clean = clean.replace(/\{.*? => (.*?)\}/, "$1");
    } else {
      clean = clean.split(" => ")[1].trim();
    }
  }
  return clean;
}

/**
 * Diff of one file inside one commit, with a fallback ladder for the cases
 * `git show` alone misses: root commits (diff-tree --root), added files and
 * deleted files (whole blob rendered as +/− lines), and files read straight
 * off disk when the checkout matches the commit.
 */
export async function fetchFileDiff(
  targetDir: string,
  hash: string,
  file: string,
): Promise<string> {
  const cleanFile = normalizeCommitPath(file);
  if (cleanFile === "") return "";

  const showPatch = await runGit(
    ["show", "--pretty=format:", "--patch", hash, "--", cleanFile],
    { cwd: targetDir, timeout: 10_000 },
  );
  if (showPatch.stdout.trim() !== "") return showPatch.stdout.trim();

  const diffTree = await runGit(
    ["diff-tree", "-r", "-p", "--root", hash, "--", cleanFile],
    { cwd: targetDir, timeout: 10_000 },
  );
  if (diffTree.stdout.trim() !== "") return diffTree.stdout.trim();

  // Added file or root commit: the blob itself, rendered as additions.
  const showBlob = await runGit(["show", `${hash}:${cleanFile}`], { cwd: targetDir, timeout: 10_000 });
  if (showBlob.stdout !== "") {
    const lines = showBlob.stdout.split("\n");
    return `@@ -0,0 +1,${lines.length} @@\n${lines.map((l) => `+${l}`).join("\n")}`;
  }

  // Deleted file: the parent's blob, rendered as removals.
  const showParent = await runGit(["show", `${hash}^:${cleanFile}`], { cwd: targetDir, timeout: 10_000 });
  if (showParent.stdout !== "") {
    const lines = showParent.stdout.split("\n");
    return `@@ -1,${lines.length} +0,0 @@\n${lines.map((l) => `-${l}`).join("\n")}`;
  }

  // The checkout may still hold the file (e.g. history paging past HEAD).
  try {
    const content = await fs.readFile(path.join(targetDir, cleanFile), "utf8");
    const lines = content.split("\n");
    return `@@ -0,0 +1,${lines.length} @@\n${lines.map((l) => `+${l}`).join("\n")}`;
  } catch {
    return "";
  }
}

export type { GitCommitFile };
