/**
 * Nested-repository discovery for the repo picker — ported from ompchamber's
 * `server/lib/fs/git-repos.ts` unchanged in behaviour: a workspace is often a
 * folder OF repositories, so the picker lists every repo under the pinned
 * root. The walk runs in the BACKGROUND after the first status answer and the
 * client polls until `pending` clears; results are cached per root for the
 * life of the process. `node_modules` is pruned (the one directory guaranteed
 * to hold unrelated `.git` folders) and the walk stops at MAX_GIT_DEPTH.
 */

import fs from "node:fs";
import path from "node:path";

const MAX_GIT_DEPTH = 8;

/**
 * Repos under `rootDir`, as root-relative POSIX paths (`.` for the root
 * itself). `depth` is the depth of `dir` itself, so MAX_GIT_DEPTH bounds an
 * entry's own depth exactly as `find -maxdepth` does.
 */
async function findGitDirs(dir: string, rel: string, depth: number, out: string[]): Promise<void> {
  let entries: fs.Dirent[];
  try {
    entries = await fs.promises.readdir(dir, { withFileTypes: true });
  } catch {
    // Unreadable directory (permissions, a race) — skip it, never fail the walk.
    return;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name === "node_modules") continue;
    if (entry.name === ".git") {
      out.push(rel || ".");
      continue;
    }
    if (depth + 1 < MAX_GIT_DEPTH) {
      await findGitDirs(
        path.join(dir, entry.name),
        rel ? `${rel}/${entry.name}` : entry.name,
        depth + 1,
        out,
      );
    }
  }
}

async function getRepos(rootDir: string): Promise<string[]> {
  const found: string[] = [];
  await findGitDirs(rootDir, "", 0, found);
  const uniqueRepos = Array.from(new Set(found));
  if (uniqueRepos.includes(".")) {
    return [".", ...uniqueRepos.filter((r) => r !== ".")];
  }
  return uniqueRepos.length ? uniqueRepos : ["."];
}

interface RepoDiscovery {
  repos: string[];
  done: boolean;
}

const repoDiscovery = new Map<string, RepoDiscovery>();

/** Begin the background walk for `rootDir`; a no-op once one has started. */
export function startRepoScan(rootDir: string): void {
  if (repoDiscovery.has(rootDir)) return;
  const d: RepoDiscovery = { repos: ["."], done: false };
  repoDiscovery.set(rootDir, d);
  void getRepos(rootDir)
    .then((repos) => {
      d.repos = repos;
      d.done = true;
    })
    .catch(() => {
      d.repos = ["."];
      d.done = true;
    });
}

/** Drop the cached result for `rootDir` and start a fresh walk (refresh button). */
export function rescanRepos(rootDir: string): void {
  repoDiscovery.delete(rootDir);
  startRepoScan(rootDir);
}

/** The discovered repos for `rootDir`, and whether the walk is still running. */
export function discoveredRepos(rootDir: string): { repos: string[]; pending: boolean } {
  const d = repoDiscovery.get(rootDir);
  if (!d) return { repos: ["."], pending: false };
  return { repos: d.done ? d.repos : ["."], pending: !d.done };
}
