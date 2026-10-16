import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildCommitPrompt,
  cleanAgentOutput,
  DEFAULT_COMMIT_INSTRUCTION,
} from "./git-commit-gen.ts";

describe("buildCommitPrompt", () => {
  it("wraps the diff with the instruction and delimiters", () => {
    const diff = "diff --git a/file.ts b/file.ts\n+new line";
    const prompt = buildCommitPrompt("Write a commit message.", diff);
    assert.equal(
      prompt,
      [
        "Write a commit message.",
        "",
        "--- STAGED CHANGES ---",
        diff,
        "--- END OF CHANGES ---",
      ].join("\n"),
    );
  });

  it("uses the default instruction when provided as instruction", () => {
    const prompt = buildCommitPrompt(DEFAULT_COMMIT_INSTRUCTION, "");
    assert.ok(prompt.includes("Conventional Commits"));
    assert.ok(prompt.includes("--- STAGED CHANGES ---"));
    assert.ok(prompt.includes("--- END OF CHANGES ---"));
  });
});

describe("cleanAgentOutput", () => {
  it("passes a plain message through trimmed", () => {
    assert.equal(
      cleanAgentOutput("  fix: add missing error check\n"),
      "fix: add missing error check",
    );
  });

  it("strips a single-line code fence", () => {
    assert.equal(
      cleanAgentOutput("```\nfix: handle null return\n```"),
      "fix: handle null return",
    );
  });

  it("strips a fenced block with a language tag", () => {
    assert.equal(
      cleanAgentOutput("```text\nfeat: new api\n```"),
      "feat: new api",
    );
  });

  it("strips surrounding double quotes", () => {
    assert.equal(cleanAgentOutput('"fix: bug"'), "fix: bug");
  });

  it("strips surrounding single quotes", () => {
    assert.equal(cleanAgentOutput("'feat: thing'"), "feat: thing");
  });

  it("does not strip double quotes that contain inner double quotes", () => {
    assert.equal(
      cleanAgentOutput('"fix: don\'t break "quotes""'),
      '"fix: don\'t break "quotes""',
    );
  });
});
