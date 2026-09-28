/**
 * Working-tree / index diff for one file — ported from ompchamber's
 * `server/lib/fs/git-diff.ts`, with `Bun.file` swapped for `node:fs` and the
 * `sh -c` string probes replaced by argv runs.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import type { FileDiffData } from "../contract";
import { gitOk, runGit } from "./shell";

/**
 * Context lines requested when the reader wants the whole file rather than
 * the hunks. `--unified` takes any count, so this is a cap on the FILE, not
 * on the change: git emits every line it can reach around the edits.
 */
const FULL_CONTEXT = 1_000_000;

/** Runs one git diff probe and returns its stdout ("" on failure). */
async function gitOut(
  args: string[],
  cwd: string,
  timeout: number,
  maxBuffer: number = 1024 * 1024 * 2,
): Promise<string> {
  const result = await runGit(args, { cwd, timeout, maxBuffer });
  return gitOk(result) ? result.stdout : "";
}

/** Whole file rendered as a unified diff: every line added (or removed). */
function wholeFileDiff(file: string, content: string, kind: "add" | "del"): string {
  const lines = content.split(/\r?\n/);
  const prefix = kind === "add" ? "+" : "-";
  const body = lines.map((line) => `${prefix}${line}`).join("\n");
  return kind === "add"
    ? `--- /dev/null\n+++ b/${file}\n@@ -0,0 +1,${lines.length} @@\n${body}`
    : `--- a/${file}\n+++ /dev/null\n@@ -1,${lines.length} +0,0 @@\n${body}`;
}

/**
 * Fetch git diff for a specific file in the working directory or index.
 *
 * `fullContext` asks git for the entire file rather than the surrounding
 * hunks — the diff comes back in the same unified format, so no second
 * rendering path exists.
 */
export async function fetchWorkingFileDiff(
  targetDir: string,
  file: string,
  staged: boolean = false,
  requestedStatus?: string,
  fullContext: boolean = false,
): Promise<FileDiffData> {
  const cleanFile = file.replace(/^[./\\]+/, "").replace(/\\/g, "/");
  const fullPath = path.join(targetDir, cleanFile);
  let status = requestedStatus !== undefined && requestedStatus.trim() !== ""
    ? requestedStatus.trim()
    : "M";
  let diff = "";
  let oldContent = "";
  let newContent = "";
  let additions = 0;
  let deletions = 0;

  try {
    const statusResult = await gitOut(["status", "--porcelain=v1", "--", cleanFile], targetDir, 10_000);
    const statusLine = statusResult.trim();
    if (statusLine !== "") {
      status = statusLine.slice(0, 2).trim() || status;
    }

    newContent = await fs.readFile(fullPath, "utf8").catch(() => "");

    // Old side: HEAD first (the usual case), then the index for a staged add.
    oldContent =
      (await gitOut(["show", `HEAD:${cleanFile}`], targetDir, 5_000)) ||
      (await gitOut(["show", `:0:${cleanFile}`], targetDir, 5_000));

    const ctx = fullContext ? `--unified=${FULL_CONTEXT}` : "--unified=3";
    // Full-context output is the file, not the change, so a fixed buffer would
    // truncate a large file's diff — sized off the content already read.
    const buf = fullContext
      ? Math.max(1024 * 1024 * 16, (oldContent.length + newContent.length) * 2 + 1024 * 1024)
      : 1024 * 1024 * 2;

    const isUntracked = status === "??" || status === "U" || status === "?";
    if (staged) {
      diff =
        (await gitOut(["diff", ctx, "--cached", "--", cleanFile], targetDir, 10_000, buf)) ||
        (await gitOut(["diff", ctx, "HEAD", "--", cleanFile], targetDir, 10_000, buf)) ||
        (await gitOut(["diff", ctx, "--", cleanFile], targetDir, 10_000, buf));
    } else if (isUntracked) {
      // `git diff --no-index` exits 1 when a diff exists and needs a
      // /dev/null that Windows lacks; an untracked file's diff is the whole
      // file as additions anyway, so synthesize it directly.
      diff = newContent !== "" ? wholeFileDiff(cleanFile, newContent, "add") : "";
    } else {
      diff =
        (await gitOut(["diff", ctx, "--", cleanFile], targetDir, 10_000, buf)) ||
        (await gitOut(["diff", ctx, "--cached", "--", cleanFile], targetDir, 10_000, buf)) ||
        (await gitOut(["diff", ctx, "HEAD", "--", cleanFile], targetDir, 10_000, buf));
    }

    // Git diff still empty but the content differs: synthesize from old/new.
    if (diff.trim() === "") {
      if (oldContent !== "" && newContent !== "" && oldContent !== newContent) {
        const oldLines = oldContent.split(/\r?\n/);
        const newLines = newContent.split(/\r?\n/);
        diff = [
          `--- a/${cleanFile}`,
          `+++ b/${cleanFile}`,
          `@@ -1,${oldLines.length} +1,${newLines.length} @@`,
          ...oldLines.map((l) => `-${l}`),
          ...newLines.map((l) => `+${l}`),
        ].join("\n");
      } else if (newContent !== "" && isUntracked) {
        diff = wholeFileDiff(cleanFile, newContent, "add");
      }
    }

    if (diff !== "") {
      for (const line of diff.split("\n")) {
        if (line.startsWith("+++") || line.startsWith("---") || line.startsWith("@@")) continue;
        if (line.startsWith("+")) additions++;
        else if (line.startsWith("-")) deletions++;
      }
    }

    return {
      file: cleanFile,
      diff:
        diff !== ""
          ? diff
          : newContent !== ""
            ? wholeFileDiff(cleanFile, newContent, isUntracked || status === "A" ? "add" : "add")
            : "No differences found",
      oldContent,
      newContent,
      staged,
      status,
      additions,
      deletions,
    };
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "Unknown error";
    return {
      file: cleanFile,
      diff: `// Unable to compute diff for ${cleanFile}: ${message}`,
      oldContent,
      newContent,
      staged,
      status: "M",
      additions: 0,
      deletions: 0,
    };
  }
}
