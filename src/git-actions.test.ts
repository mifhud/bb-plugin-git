import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { assertStashRef, runAction } from "./git-actions.ts";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

describe("assertStashRef", () => {
  it("accepts stash@{0} unchanged", () => {
    assert.equal(assertStashRef("stash@{0}"), "stash@{0}");
  });

  it("accepts stash@{12} unchanged", () => {
    assert.equal(assertStashRef("stash@{12}"), "stash@{12}");
  });

  it("rejects a leading dash", () => {
    assert.throws(() => assertStashRef("-stash@{0}"), /Not a valid stash ref/);
  });

  it("rejects an arbitrary ref", () => {
    assert.throws(() => assertStashRef("refs/heads/main"), /Not a valid stash ref/);
  });

  it("rejects a missing index", () => {
    assert.throws(() => assertStashRef("stash@{}"), /Not a valid stash ref/);
  });

  it("rejects an injection attempt", () => {
    assert.throws(() => assertStashRef("stash@{0}; rm -rf /"), /Not a valid stash ref/);
  });
});

function git(dir: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd: dir,
    encoding: "utf8",
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
  }).trim();
}

function makeRepo(commits: number): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "git-undo-"));
  git(dir, ["init"]);
  git(dir, ["config", "user.email", "test@test.com"]);
  git(dir, ["config", "user.name", "Test"]);
  for (let i = 0; i < commits; i++) {
    fs.writeFileSync(path.join(dir, "file.txt"), `line ${i}\n`);
    git(dir, ["add", "."]);
    git(dir, ["commit", "-m", `commit ${i}`]);
  }
  return dir;
}

describe("undo_commit", () => {
  it("undoes HEAD while keeping changes staged", async () => {
    const dir = makeRepo(2);
    try {
      const head = git(dir, ["rev-parse", "HEAD"]);
      const parent = git(dir, ["rev-parse", "HEAD~1"]);
      const result = await runAction(dir, { action: "undo_commit", hash: head });
      assert.deepEqual(result, { ok: true });
      assert.equal(git(dir, ["rev-parse", "HEAD"]), parent);
      assert.ok(git(dir, ["diff", "--cached", "--name-only"]).includes("file.txt"));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects a non-HEAD hash", async () => {
    const dir = makeRepo(2);
    try {
      const parent = git(dir, ["rev-parse", "HEAD~1"]);
      const result = await runAction(dir, { action: "undo_commit", hash: parent });
      assert.equal(result.ok, false);
      assert.match(result.error ?? "", /Only the current HEAD commit can be undone/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects the root commit (no parent)", async () => {
    const dir = makeRepo(1);
    try {
      const head = git(dir, ["rev-parse", "HEAD"]);
      const result = await runAction(dir, { action: "undo_commit", hash: head });
      assert.equal(result.ok, false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
