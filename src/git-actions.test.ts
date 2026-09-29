import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { assertStashRef } from "./git-actions.ts";

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
