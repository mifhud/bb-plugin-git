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

/** A bare remote plus a local clone with one commit, wired as `origin`. */
function makeRepoWithRemote(): { remote: string; dir: string } {
  const remote = fs.mkdtempSync(path.join(os.tmpdir(), "git-push-remote-"));
  git(remote, ["init", "--bare", "--initial-branch=main"]);
  const dir = makeRepo(1);
  git(dir, ["remote", "add", "origin", remote]);
  return { remote, dir };
}

describe("push", () => {
  it("fails when the branch has no upstream and setUpstream is not set", async () => {
    const { remote, dir } = makeRepoWithRemote();
    try {
      const result = await runAction(dir, { action: "push" });
      assert.equal(result.ok, false);
      assert.match(result.ok ? "" : result.error, /upstream/i);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
      fs.rmSync(remote, { recursive: true, force: true });
    }
  });

  it("publishes with setUpstream and records the tracking ref", async () => {
    const { remote, dir } = makeRepoWithRemote();
    try {
      const branch = git(dir, ["rev-parse", "--abbrev-ref", "HEAD"]);
      const result = await runAction(dir, { action: "push", setUpstream: true });
      assert.deepEqual(result, { ok: true });
      assert.equal(
        git(dir, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"]),
        `origin/${branch}`,
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
      fs.rmSync(remote, { recursive: true, force: true });
    }
  });
});

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

describe("cherry_pick", () => {
  it("rejects a commit already in the current branch", async () => {
    const dir = makeRepo(2);
    try {
      const ancestor = git(dir, ["rev-parse", "HEAD~1"]);
      const result = await runAction(dir, { action: "cherry_pick", hash: ancestor });
      assert.equal(result.ok, false);
      assert.match(result.error ?? "", /already in the current branch/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects a merge commit", async () => {
    const dir = makeRepo(1);
    try {
      git(dir, ["checkout", "-b", "side"]);
      fs.writeFileSync(path.join(dir, "side.txt"), "side\n");
      git(dir, ["add", "."]);
      git(dir, ["commit", "-m", "side change"]);
      git(dir, ["checkout", "-"]);
      git(dir, ["merge", "--no-ff", "-m", "merge side", "side"]);
      const merge = git(dir, ["rev-parse", "HEAD"]);

      const result = await runAction(dir, { action: "cherry_pick", hash: merge });
      assert.equal(result.ok, false);
      assert.match(result.error ?? "", /merge commit/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("picks a commit from another branch", async () => {
    const dir = makeRepo(1);
    try {
      git(dir, ["checkout", "-b", "topic"]);
      fs.writeFileSync(path.join(dir, "topic.txt"), "topic\n");
      git(dir, ["add", "."]);
      git(dir, ["commit", "-m", "topic change"]);
      const topic = git(dir, ["rev-parse", "HEAD"]);
      git(dir, ["checkout", "-"]);

      const result = await runAction(dir, { action: "cherry_pick", hash: topic });
      assert.deepEqual(result, { ok: true });
      assert.match(git(dir, ["log", "-1", "--pretty=%s"]), /topic change/);
      assert.equal(fs.readFileSync(path.join(dir, "topic.txt"), "utf8"), "topic\n");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("revert", () => {
  it("removes an entire untracked folder instead of refusing it", async () => {
    const dir = makeRepo(0);
    try {
      fs.mkdirSync(path.join(dir, "folder"), { recursive: true });
      fs.writeFileSync(path.join(dir, "folder", "new1.txt"), "a\n");
      fs.writeFileSync(path.join(dir, "folder", "new2.txt"), "b\n");

      const result = await runAction(dir, { action: "revert", file: "folder" });

      assert.deepEqual(result, { ok: true });
      assert.equal(fs.existsSync(path.join(dir, "folder", "new1.txt")), false);
      assert.equal(fs.existsSync(path.join(dir, "folder", "new2.txt")), false);
      assert.equal(git(dir, ["status", "--porcelain", "--", "folder"]), "");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("reverts tracked changes and clears untracked files in a mixed folder", async () => {
    const dir = makeRepo(1);
    try {
      fs.mkdirSync(path.join(dir, "folder"), { recursive: true });
      fs.writeFileSync(path.join(dir, "folder", "old.txt"), "tracked\n");
      git(dir, ["add", "folder/old.txt"]);
      git(dir, ["commit", "-m", "track folder"]);
      fs.writeFileSync(path.join(dir, "folder", "old.txt"), "changed\n");
      fs.writeFileSync(path.join(dir, "folder", "new.txt"), "untracked\n");

      const result = await runAction(dir, { action: "revert", file: "folder" });

      assert.deepEqual(result, { ok: true });
      assert.equal(fs.readFileSync(path.join(dir, "folder", "old.txt"), "utf8"), "tracked\n");
      assert.equal(fs.existsSync(path.join(dir, "folder", "new.txt")), false);
      assert.equal(git(dir, ["status", "--porcelain", "--", "folder"]), "");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("removes a single untracked file", async () => {
    const dir = makeRepo(0);
    try {
      fs.writeFileSync(path.join(dir, "solo.txt"), "x\n");
      const result = await runAction(dir, { action: "revert", file: "solo.txt" });
      assert.deepEqual(result, { ok: true });
      assert.equal(fs.existsSync(path.join(dir, "solo.txt")), false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("reverts a single tracked-modified file", async () => {
    const dir = makeRepo(1);
    try {
      const file = path.join(dir, "file.txt");
      fs.writeFileSync(file, "changed\n");
      const result = await runAction(dir, { action: "revert", file: "file.txt" });
      assert.deepEqual(result, { ok: true });
      assert.equal(fs.readFileSync(file, "utf8"), "line 0\n");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("stash_apply_file", () => {
  it("applies a single stashed file to the working tree", async () => {
    const dir = makeRepo(1);
    try {
      // Stash a new file + a modification, then apply only the new file.
      fs.writeFileSync(path.join(dir, "stashed.txt"), "stash content\n");
      fs.writeFileSync(path.join(dir, "file.txt"), "modified\n");
      git(dir, ["add", "."]);
      git(dir, ["stash", "push", "-m", "stash both"]);
      // Confirm only the new file is applied.
      const result = await runAction(dir, {
        action: "stash_apply_file",
        stash: "stash@{0}",
        file: "stashed.txt",
      });
      assert.deepEqual(result, { ok: true });
      assert.equal(fs.readFileSync(path.join(dir, "stashed.txt"), "utf8"), "stash content\n");
      // The other stashed change (file.txt) should NOT have been applied.
      assert.equal(fs.readFileSync(path.join(dir, "file.txt"), "utf8"), "line 0\n");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects a missing file field", async () => {
    const dir = makeRepo(1);
    try {
      git(dir, ["stash", "push", "-m", "stash"]);
      const result = await runAction(dir, {
        action: "stash_apply_file",
        stash: "stash@{0}",
      });
      assert.equal(result.ok, false);
      assert.match(result.error ?? "", /Missing file/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("stash_push", () => {
  it("stashes staged changes only when stagedOnly is set", async () => {
    const dir = makeRepo(1);
    try {
      // Two tracked files: file.txt staged, other.txt with an unstaged edit.
      fs.writeFileSync(path.join(dir, "other.txt"), "line 0\n");
      git(dir, ["add", "other.txt"]);
      git(dir, ["commit", "-q", "-m", "add other"]);
      fs.writeFileSync(path.join(dir, "file.txt"), "staged\n");
      git(dir, ["add", "file.txt"]);
      fs.writeFileSync(path.join(dir, "other.txt"), "unstaged\n");

      const result = await runAction(dir, {
        action: "stash_push",
        stagedOnly: true,
      });
      assert.deepEqual(result, { ok: true });

      // Staged change stashed: file.txt reverted to HEAD.
      assert.equal(fs.readFileSync(path.join(dir, "file.txt"), "utf8"), "line 0\n");
      assert.equal(git(dir, ["diff", "--cached", "--name-only"]), "");
      // Unstaged change preserved: other.txt still has the working-tree edit.
      assert.equal(fs.readFileSync(path.join(dir, "other.txt"), "utf8"), "unstaged\n");
      assert.ok(git(dir, ["stash", "list"]).length > 0);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("stashes staged and unstaged tracked changes by default", async () => {
    const dir = makeRepo(1);
    try {
      // Two tracked files: file.txt staged, other.txt with an unstaged edit.
      fs.writeFileSync(path.join(dir, "other.txt"), "line 0\n");
      git(dir, ["add", "other.txt"]);
      git(dir, ["commit", "-q", "-m", "add other"]);
      fs.writeFileSync(path.join(dir, "file.txt"), "staged\n");
      git(dir, ["add", "file.txt"]);
      fs.writeFileSync(path.join(dir, "other.txt"), "unstaged\n");

      const result = await runAction(dir, { action: "stash_push" });
      assert.deepEqual(result, { ok: true });

      // Both staged and unstaged tracked changes are stashed.
      assert.equal(fs.readFileSync(path.join(dir, "file.txt"), "utf8"), "line 0\n");
      assert.equal(git(dir, ["diff", "--cached", "--name-only"]), "");
      assert.equal(fs.readFileSync(path.join(dir, "other.txt"), "utf8"), "line 0\n");
      assert.ok(git(dir, ["stash", "list"]).length > 0);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("passes a stash message together with stagedOnly", async () => {
    const dir = makeRepo(1);
    try {
      fs.writeFileSync(path.join(dir, "file.txt"), "staged\n");
      git(dir, ["add", "file.txt"]);

      const result = await runAction(dir, {
        action: "stash_push",
        message: "just staged",
        stagedOnly: true,
      });
      assert.deepEqual(result, { ok: true });
      assert.equal(fs.readFileSync(path.join(dir, "file.txt"), "utf8"), "line 0\n");
      assert.match(git(dir, ["stash", "list"]), /just staged/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
