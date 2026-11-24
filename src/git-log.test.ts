import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fetchGitCommits } from "./git-log.ts";

function git(dir: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd: dir,
    encoding: "utf8",
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
  }).trim();
}

function commitFile(dir: string, name: string, content: string, message: string): void {
  fs.writeFileSync(path.join(dir, name), content);
  git(dir, ["add", "."]);
  git(dir, ["commit", "-m", message]);
}

/**
 * The checked-out branch with two commits, plus a `side` branch carrying one
 * commit of its own — the shape that separates the two revision scopes.
 */
function makeRepoWithSideBranch(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "git-log-scope-"));
  git(dir, ["init"]);
  git(dir, ["config", "user.email", "test@test.com"]);
  git(dir, ["config", "user.name", "Test"]);
  commitFile(dir, "file.txt", "one\n", "first");
  commitFile(dir, "file.txt", "two\n", "second");
  git(dir, ["checkout", "-b", "side"]);
  commitFile(dir, "side.txt", "side\n", "side work");
  git(dir, ["checkout", "-"]);
  return dir;
}

describe("fetchGitCommits scope", () => {
  it('"head" lists only the commits the checked-out branch contains', async () => {
    const dir = makeRepoWithSideBranch();
    try {
      const page = await fetchGitCommits(dir, 50, 0, "head");
      assert.equal(page.total, 2);
      assert.deepEqual(
        page.commits.map((commit) => commit.message),
        ["second", "first"],
      );
      assert.equal(page.hasMore, false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('"head" pages against its own total, not the all-refs one', async () => {
    const dir = makeRepoWithSideBranch();
    try {
      const page = await fetchGitCommits(dir, 1, 0, "head");
      assert.equal(page.commits.length, 1);
      assert.equal(page.total, 2);
      assert.equal(page.hasMore, true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('"all" reaches a commit that only exists on another branch', async () => {
    const dir = makeRepoWithSideBranch();
    try {
      const page = await fetchGitCommits(dir, 50, 0, "all");
      const messages = page.commits.map((commit) => commit.message);
      assert.equal(page.total, 3);
      assert.ok(messages.includes("side work"), `expected the side branch's commit, got ${messages.join(", ")}`);
      // The default is the all-refs scope the graph tab relies on.
      const implicit = await fetchGitCommits(dir, 50, 0);
      assert.equal(implicit.total, 3);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
