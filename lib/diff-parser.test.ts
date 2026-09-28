import assert from "node:assert/strict";
import { test } from "node:test";
import { parseUnifiedDiff } from "./diff-parser.ts";

const SAMPLE = [
  "diff --git a/app.ts b/app.ts",
  "index 1111111..2222222 100644",
  "--- a/app.ts",
  "+++ b/app.ts",
  "@@ -1,4 +1,4 @@",
  " const a = 1;",
  "-const b = 2;",
  "+const b = 3;",
  "+const c = 4;",
  " const d = 5;",
].join("\n");

test("unified view keeps line numbers and counts", () => {
  const { lines, additions, deletions } = parseUnifiedDiff(SAMPLE, { views: "unified" });
  assert.equal(additions, 2);
  assert.equal(deletions, 1);

  const del = lines.find((line) => line.type === "del");
  const adds = lines.filter((line) => line.type === "add");
  assert.equal(del?.text, "const b = 2;");
  assert.equal(del?.oldLineNumber, 2);
  assert.equal(adds.length, 2);
  assert.equal(adds[0].newLineNumber, 2);
  assert.equal(adds[1].newLineNumber, 3);
  // Context after the hunk continues at the right numbers.
  const lastContext = lines[lines.length - 1];
  assert.equal(lastContext.type, "context");
  assert.equal(lastContext.newLineNumber, 4);
});

test("split view pairs del/add buffers into shared rows", () => {
  const { splitRows, additions, deletions } = parseUnifiedDiff(SAMPLE, { views: "split" });
  assert.equal(additions, 2);
  assert.equal(deletions, 1);

  const paired = splitRows.find((row) => row.left?.type === "del");
  assert.ok(paired);
  // The first deletion pairs with the first addition.
  assert.equal(paired.right?.type, "add");
  assert.equal(paired.right?.text, "const b = 3;");
  // The leftover addition has an empty left cell.
  const leftover = splitRows.find((row) => row.left === undefined && row.right !== undefined);
  assert.equal(leftover?.right?.text, "const c = 4;");
});

test("hunk header becomes a meta row and resets counters", () => {
  const { lines } = parseUnifiedDiff(SAMPLE, { views: "unified" });
  const meta = lines.find((line) => line.type === "meta");
  assert.ok(meta);
  assert.ok(meta.text.startsWith("@@ -1,4 +1,4 @@"));
});

test("ignoreWhitespace folds whitespace-only pairs back into context", () => {
  // Only OUTER whitespace per line is preserved by the parser's trim test,
  // so the pair differs by indentation alone.
  const raw = ["@@ -1,1 +1,1 @@", "-  const x = 1;", "+const x = 1;"].join("\n");
  const folded = parseUnifiedDiff(raw, { ignoreWhitespace: true, views: "both" });
  assert.equal(folded.additions, 0);
  assert.equal(folded.deletions, 0);
  assert.ok(folded.lines.every((line) => line.type !== "add" && line.type !== "del"));

  const plain = parseUnifiedDiff(raw, { views: "both" });
  assert.equal(plain.additions, 1);
  assert.equal(plain.deletions, 1);
});

test("a diff without hunks becomes context lines under a synthetic header", () => {
  const raw = ["line one", "line two"].join("\n");
  const { lines, additions } = parseUnifiedDiff(raw, { views: "unified" });
  assert.equal(additions, 0);
  // The synthetic hunk header is the first (meta) row; the two lines are context.
  assert.equal(lines.length, 3);
  assert.equal(lines[0].type, "meta");
  assert.ok(lines.slice(1).every((line) => line.type === "context"));
  assert.equal(lines[1].newLineNumber, 1);
  assert.equal(lines[2].newLineNumber, 2);
});

test("empty diff parses to nothing", () => {
  const { lines, splitRows, additions, deletions } = parseUnifiedDiff("");
  assert.equal(lines.length, 0);
  assert.equal(splitRows.length, 0);
  assert.equal(additions, 0);
  assert.equal(deletions, 0);
});
