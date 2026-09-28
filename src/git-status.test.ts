import assert from "node:assert/strict";
import { test } from "node:test";
import { parsePorcelain, parseRefs } from "./git-parse.ts";

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
