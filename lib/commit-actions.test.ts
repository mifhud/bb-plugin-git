import assert from "node:assert/strict";
import { test } from "node:test";
import type { GitCommit } from "../contract";
import { computeCherryPickState, reachableFromHead } from "./commit-actions.ts";

function commit(hash: string, parents: string[], extra: Partial<GitCommit> = {}): GitCommit {
  return {
    hash,
    shortHash: hash.slice(0, 7),
    author: "dev",
    date: "Sep 28, 2026",
    message: `commit ${hash}`,
    parents,
    ...extra,
  };
}

/** main; a feature head forking off the root commit. */
const commits: GitCommit[] = [
  commit("ddddddd1", ["ccccccc1"], { refs: ["feature"] }),
  commit("aaaaaaa1", ["bbbbbbb1"], { refs: ["HEAD -> main", "main"] }),
  commit("bbbbbbb1", ["ccccccc1"]),
  commit("ccccccc1", []),
];

test("reachableFromHead walks parents from the HEAD ref", () => {
  const reachable = reachableFromHead(commits);
  assert.deepEqual([...reachable].sort(), ["aaaaaaa1", "bbbbbbb1", "ccccccc1"]);
});

test("reachableFromHead is empty without a HEAD ref", () => {
  const detached = [commit("aaaaaaa1", []), commit("bbbbbbb1", [])];
  assert.equal(reachableFromHead(detached).size, 0);
});

test("cherry-pick is not offered for commits already in the branch", () => {
  for (const hash of ["aaaaaaa1", "bbbbbbb1", "ccccccc1"]) {
    const state = computeCherryPickState(commits, hash, false);
    assert.equal(state.show, false, `${hash} should not offer a pick`);
    assert.match(state.reason ?? "", /Already in the current branch/);
  }
});

test("cherry-pick is not offered for a merge commit", () => {
  const history = [commit("merge001", ["aaaaaaa1", "ddddddd1"], { refs: ["HEAD -> main"] }), ...commits];
  const state = computeCherryPickState(history, "merge001", false);
  assert.equal(state.show, false);
  assert.match(state.reason ?? "", /mainline parent/);
});

test("cherry-pick is offered off-branch, but blocked while the tree is dirty", () => {
  const clean = computeCherryPickState(commits, "ddddddd1", false);
  assert.deepEqual(clean, { show: true, enabled: true, reason: null });

  const dirty = computeCherryPickState(commits, "ddddddd1", true);
  assert.equal(dirty.show, true);
  assert.equal(dirty.enabled, false);
  assert.match(dirty.reason ?? "", /Commit or stash/);
});
