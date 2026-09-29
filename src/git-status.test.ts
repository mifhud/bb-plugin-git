import assert from "node:assert/strict";
import { test } from "node:test";
import { parsePorcelain, parseRefs, parseStash } from "./git-parse.ts";

test("porcelain columns decide staged vs unstaged", () => {
  const out = [
    "M  src/a.ts", // staged modification
    " M src/b.ts", // unstaged modification
    "?? new.txt", // untracked
    "R  old.ts -> new.ts", // staged rename
    "MM both.ts", // staged and unstaged
  ].join("\n");

  const changes = parsePorcelain(out);
  assert.equal(changes.length, 5);

  assert.deepEqual(changes[0], { status: "M ", file: "src/a.ts", staged: true });
  assert.deepEqual(changes[1], { status: " M", file: "src/b.ts", staged: false });
  assert.deepEqual(changes[2], { status: "??", file: "new.txt", staged: false });
  // The rename resolves to its "to" path.
  assert.deepEqual(changes[3], { status: "R ", file: "new.ts", staged: true });
  assert.equal(changes[4].staged, true);
  assert.equal(changes[4].status, "MM");
});

test("quoted porcelain paths are unquoted", () => {
  const changes = parsePorcelain('?? "with space.txt"');
  assert.equal(changes.length, 1);
  assert.equal(changes[0].file, "with space.txt");
});

test("empty status output parses to no changes", () => {
  assert.deepEqual(parsePorcelain(""), []);
});

test("for-each-ref marks the checked-out branch and splits remotes", () => {
  const out = [
    "refs/heads/main\tmain\t*",
    "refs/heads/dev\tdev\t",
    "refs/remotes/origin/main\torigin/main\t",
    // Symbolic alias: short name has no slash, must NOT count as a branch.
    "refs/remotes/origin/HEAD\torigin\t",
  ].join("\n");

  const info = parseRefs(out);
  assert.equal(info.branch, "main");
  assert.deepEqual(info.branches, ["main", "dev"]);
  assert.deepEqual(info.remoteBranches, ["origin/main"]);
});

test("detached HEAD reports no marked branch", () => {
  const info = parseRefs("refs/heads/main\tmain\t");
  assert.equal(info.branch, "");
  assert.deepEqual(info.branches, ["main"]);
});

test("parseStash parses a WIP-on-branch stash with hash and subject", () => {
  const stashes = parseStash("stash@{0}: WIP on feature/x: a1b2c34 Add login page");
  assert.equal(stashes.length, 1);
  assert.deepEqual(stashes[0], {
    ref: "stash@{0}",
    index: 0,
    branch: "feature/x",
    message: "Add login page",
    hash: "a1b2c34",
  });
});

test("parseStash parses an On-branch stash with message only, no hash", () => {
  const stashes = parseStash("stash@{1}: On master: fix typo");
  assert.equal(stashes.length, 1);
  assert.deepEqual(stashes[0], {
    ref: "stash@{1}",
    index: 1,
    branch: "master",
    message: "fix typo",
  });
  assert.equal(stashes[0].hash, undefined);
});

test("parseStash keeps colons in On-branch messages intact", () => {
  const stashes = parseStash("stash@{0}: On master: WIP: my changes");
  assert.equal(stashes.length, 1);
  assert.deepEqual(stashes[0], {
    ref: "stash@{0}",
    index: 0,
    branch: "master",
    message: "WIP: my changes",
  });
  assert.equal(stashes[0].hash, undefined);
});

test("parseStash parses a WIP on (no branch) stash", () => {
  const stashes = parseStash("stash@{0}: WIP on (no branch): 1ea879c first commit");
  assert.equal(stashes.length, 1);
  assert.deepEqual(stashes[0], {
    ref: "stash@{0}",
    index: 0,
    branch: "",
    message: "first commit",
    hash: "1ea879c",
  });
});

test("parseStash returns [] for empty output", () => {
  assert.deepEqual(parseStash(""), []);
  assert.deepEqual(parseStash("   \n  \n"), []);
});

test("parseStash parses multiple entries preserving their index", () => {
  const out = [
    "stash@{0}: WIP on master: b27c649 first commit",
    "stash@{1}: On master: fix typo",
    "stash@{2}: WIP on (no branch): 1ea879c first commit",
  ].join("\n");

  const stashes = parseStash(out);
  assert.equal(stashes.length, 3);
  assert.equal(stashes[0].index, 0);
  assert.equal(stashes[1].index, 1);
  assert.equal(stashes[2].index, 2);
  assert.equal(stashes[0].message, "first commit");
  assert.equal(stashes[1].message, "fix typo");
});
