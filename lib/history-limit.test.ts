import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DEFAULT_COMMITS_PER_PAGE,
  nextSearchTarget,
  parseCommitsPerPage,
} from "./history-limit.ts";

test("the number setting parses as a page size", () => {
  assert.equal(parseCommitsPerPage(25), 25);
  assert.equal(parseCommitsPerPage(250), 250);
  assert.equal(parseCommitsPerPage("100"), 100);
  assert.equal(parseCommitsPerPage(50.9), 50);
  assert.equal(parseCommitsPerPage(5000), 5000);
});

test("zero, negatives and malformed values never stop the list", () => {
  assert.equal(parseCommitsPerPage(undefined), DEFAULT_COMMITS_PER_PAGE);
  assert.equal(parseCommitsPerPage(""), DEFAULT_COMMITS_PER_PAGE);
  assert.equal(parseCommitsPerPage("abc"), DEFAULT_COMMITS_PER_PAGE);
  assert.equal(parseCommitsPerPage(Number.NaN), DEFAULT_COMMITS_PER_PAGE);
  assert.equal(parseCommitsPerPage(true), DEFAULT_COMMITS_PER_PAGE);
  assert.equal(parseCommitsPerPage(Number.POSITIVE_INFINITY), DEFAULT_COMMITS_PER_PAGE);
  assert.equal(parseCommitsPerPage(0), 1);
  assert.equal(parseCommitsPerPage(-10), 1);
});

test("Search deeper always adds one page beyond what is already found", () => {
  // A page can match many commits at once: the next budget must start from the
  // found count, not from the previous budget, or the click would fetch nothing.
  assert.equal(nextSearchTarget(0, 50), 50);
  assert.equal(nextSearchTarget(63, 50), 113);
  assert.equal(nextSearchTarget(400, 50), 450);
});
