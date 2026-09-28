/**
 * Every mutation the panel can issue — the action half of ompchamber's
 * `POST /api/fs/git`, rewritten to run on argv arrays instead of `sh -c`
 * strings, with the same whitelist discipline: only the names in
 * `gitActionSchema` ever reach this module, and every dynamic value is
 * validated before it becomes an argument.
 */

import fs from "node:fs";
import path from "node:path";
import type { GitAction } from "../contract";
import { invalidateRemoteRefs, markRemoteRefsFresh } from "./git-sync";
import { expectOk, gitOk, runGit } from "./shell";

export interface ActInput {
  action: GitAction;
  file?: string;
  message?: string;
  branch?: string;
  hash?: string;
  mode?: "soft" | "mixed" | "hard";
}

export type ActOutcome = { ok: true } | { ok: false; error: string };

/**
 * Confines a client-supplied path to the working tree: no absolute paths, no
 * `..`, resolved and re-checked against the repo root (the panel is reachable
 * from anything that can call the RPC, so the path is re-derived server-side).
 */
function resolveRepoFile(repoDir: string, file: string): string {
  const cleaned = file.replace(/\\/g, "/").replace(/^\.\//, "");
  if (path.isAbsolute(file) || cleaned.split("/").includes("..")) {
    throw new Error("That path is outside the repository.");
  }
  const root = path.resolve(repoDir);
  const abs = path.resolve(root, cleaned);
  if (!abs.startsWith(root + path.sep)) {
    throw new Error("That path is outside the repository.");
  }
  return cleaned;
}

/** Branch names: a conservative charset, and never a leading dash (option injection). */
function assertBranchName(branch: string): string {
  const trimmed = branch.trim();
  if (trimmed === "" || trimmed.startsWith("-") || !/^[A-Za-z0-9._/\-]+$/.test(trimmed)) {
    throw new Error(`Not a valid branch name: ${branch}`);
  }
  return trimmed;
}

/** Commit hashes come from our own history listing — require plain hex. */
function assertHash(hash: string): string {
  const trimmed = hash.trim();
  if (!/^[0-9a-fA-F]{4,64}$/.test(trimmed)) {
    throw new Error(`Not a valid commit hash: ${hash}`);
  }
  return trimmed;
}

/** True when the ref resolves; a quiet miss keeps stderr out of the answer. */
async function refExists(ref: string, cwd: string): Promise<boolean> {
  const result = await runGit(["rev-parse", "--verify", "--quiet", ref], { cwd });
  return gitOk(result);
}

/**
 * Runs one action against one working tree. Throws with git's own stderr on
 * failure; the RPC layer turns that into `{ ok: false, error }`.
 */
export async function runAction(targetDir: string, input: ActInput): Promise<ActOutcome> {
  try {
    await perform(targetDir, input);
    return { ok: true };
  } catch (cause) {
    const error = cause instanceof Error ? cause.message : String(cause);
    return { ok: false, error };
  }
}

async function perform(targetDir: string, input: ActInput): Promise<void> {
  const cwd = { cwd: targetDir };
  switch (input.action) {
    case "stage": {
      const file = requireFile(input);
      await expectOk(["add", "--", resolveRepoFile(targetDir, file)], cwd);
      return;
    }
    case "stage_all":
      await expectOk(["add", "-A"], cwd);
      return;
    case "unstage": {
      const file = requireFile(input);
      const rel = resolveRepoFile(targetDir, file);
      const restore = await runGit(["restore", "--staged", "--", rel], cwd);
      if (!gitOk(restore)) {
        // No HEAD yet (first commit): `git reset --` unstages without one.
        await expectOk(["reset", "-q", "--", rel], cwd);
      }
      return;
    }
    case "unstage_all": {
      const restore = await runGit(["restore", "--staged", "."], cwd);
      if (!gitOk(restore)) await expectOk(["reset", "-q"], cwd);
      return;
    }
    case "revert": {
      const file = requireFile(input);
      const rel = resolveRepoFile(targetDir, file);
      const probe = await runGit(["status", "--porcelain", "--", rel], cwd);
      if (gitOk(probe) && probe.stdout.startsWith("??")) {
        // Never tracked: restore cannot help, the untracked file is removed.
        const abs = path.join(targetDir, rel);
        const stat = await fs.promises.stat(abs).catch(() => null);
        if (stat?.isDirectory() === true) throw new Error("Refusing to discard a folder.");
        await fs.promises.rm(abs, { force: true });
        return;
      }
      await expectOk(["restore", "--", rel], cwd);
      return;
    }
    case "revert_all":
      await expectOk(["restore", "."], cwd);
      await expectOk(["clean", "-fd"], cwd);
      return;
    case "commit": {
      const message = (input.message ?? "").trim();
      if (message === "") throw new Error("Commit message is empty.");
      await expectOk(["commit", "-m", message], cwd);
      return;
    }
    case "checkout": {
      const branch = assertBranchName(requireText(input.branch, "branch"));
      if (await refExists(`refs/heads/${branch}`, targetDir)) {
        await expectOk(["checkout", branch], cwd);
      } else {
        const slash = branch.indexOf("/");
        const localName = slash > 0 ? branch.slice(slash + 1) : branch;
        if (await refExists(`refs/heads/${localName}`, targetDir)) {
          await expectOk(["checkout", localName], cwd);
        } else {
          await expectOk(["checkout", "-b", localName, "--track", branch], cwd);
        }
      }
      invalidateRemoteRefs(targetDir);
      return;
    }
    case "create_branch": {
      const branch = assertBranchName(requireText(input.branch, "branch"));
      await expectOk(["checkout", "-b", branch], cwd);
      invalidateRemoteRefs(targetDir);
      return;
    }
    case "push":
      await expectOk(["push"], { ...cwd, timeout: 120_000 });
      markRemoteRefsFresh(targetDir);
      return;
    case "pull":
      await expectOk(["pull", "--ff-only"], { ...cwd, timeout: 120_000 });
      markRemoteRefsFresh(targetDir);
      return;
    case "sync":
      await expectOk(["pull", "--ff-only"], { ...cwd, timeout: 120_000 });
      await expectOk(["push"], { ...cwd, timeout: 120_000 });
      markRemoteRefsFresh(targetDir);
      return;
    case "cherry_pick":
      await expectOk(["cherry-pick", assertHash(requireText(input.hash, "hash"))], cwd);
      return;
    case "revert_commit":
      await expectOk(["revert", "--no-edit", assertHash(requireText(input.hash, "hash"))], cwd);
      return;
    case "reset_commit": {
      const mode = input.mode ?? "soft";
      await expectOk(["reset", `--${mode}`, assertHash(requireText(input.hash, "hash"))], cwd);
      return;
    }
    case "merge_commit":
      await expectOk(["merge", assertHash(requireText(input.hash, "hash"))], cwd);
      return;
    case "rebase_commit":
      await expectOk(["rebase", assertHash(requireText(input.hash, "hash"))], cwd);
      return;
  }
}

function requireFile(input: ActInput): string {
  return requireText(input.file, "file");
}

function requireText(value: string | undefined, name: string): string {
  if (value === undefined || value.trim() === "") {
    throw new Error(`Missing ${name}.`);
  }
  return value;
}
