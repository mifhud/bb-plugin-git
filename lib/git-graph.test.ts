import assert from "node:assert/strict";
import { test } from "node:test";
import type { GitCommit } from "../contract";
import { computeCommitLanes, computeGraphLinks } from "./git-graph.ts";
import { buildGitTree } from "./git-tree.ts";

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

test("a linear history shares one lane", () => {
  const commits = [commit("aaaaaaa1", ["bbbbbbb1"]), commit("bbbbbbb1", ["ccccccc1"]), commit("ccccccc1", [])];
  const lanes = computeCommitLanes(commits);
  assert.equal(lanes.get("aaaaaaa1"), 0);
  assert.equal(lanes.get("bbbbbbb1"), 0);
  assert.equal(lanes.get("ccccccc1"), 0);
});

test("a second parent opens a new lane", () => {
  // Newest first: a merge commit whose second parent is not the first lane.
  const commits = [
    commit("merge01", ["first01", "side01"]),
    commit("first01", ["base001"]),
    commit("side01", ["base001"]),
    commit("base001", []),
  ];
  const lanes = computeCommitLanes(commits);
  assert.equal(lanes.get("merge01"), 0);
  assert.equal(lanes.get("first01"), 0);
  assert.equal(lanes.get("side01"), 1);
  // The base lands in the first lane that points at it.
  assert.equal(lanes.get("base001"), 0);
});

test("links connect to loaded parents and tail off for unloaded ones", () => {
  const commits = [commit("aaaaaaa1", ["bbbbbbb1"]), commit("bbbbbbb1", ["zzzzzzz9"])];
  const lanes = computeCommitLanes(commits);
  const positions: Record<string, number> = { aaaaaaa1: 23, bbbbbbb1: 69 };
  const links = computeGraphLinks(commits, lanes, positions, 138);

  assert.equal(links.length, 2);
  assert.equal(links[0].toHash, "bbbbbbb1");
  assert.equal(links[0].fromY, 23);
  assert.equal(links[0].toY, 69);
  // The parent beyond the loaded page draws a continuation to the bottom.
  assert.equal(links[1].toHash, "tail-bbbbbbb1");
  assert.ok(links[1].toY >= 138);
});

test("buildGitTree groups files under folders with counts", () => {
  const tree = buildGitTree([
    { file: "src/a.ts", status: " M", staged: false },
    { file: "src/deep/b.ts", status: "??", staged: false },
    { file: "README.md", status: "M ", staged: true },
  ]);

  const names = tree.map((node) => node.name);
  assert.ok(names.includes("src"));
  assert.ok(names.includes("README.md"));

  const src = tree.find((node) => node.name === "src");
  assert.ok(src);
  assert.equal(src.type, "folder");
  assert.equal(src.changeCount, 2);
  const deep = src.children.find((child) => child.name === "deep");
  assert.ok(deep);
  assert.equal(deep.changeCount, 1);
});

test("buildGitTree puts folders before files", () => {
  const tree = buildGitTree([
    { file: "zeta.txt", status: " M", staged: false },
    { file: "alpha/x.ts", status: " M", staged: false },
  ]);
  assert.equal(tree[0].name, "alpha");
  assert.equal(tree[1].name, "zeta.txt");
});
