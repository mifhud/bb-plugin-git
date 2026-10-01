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
import { invalidateRemoteRefs, markRemoteRefsFresh } from "./git-sync.ts";
import { expectOk, gitOk, runGit } from "./shell.ts";

export interface ActInput {
  action: GitAction;
  file?: string;
  message?: string;
  branch?: string;
  hash?: string;
  mode?: "soft" | "mixed" | "hard";
  stash?: string;
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

/** Stashed entries reference reflog slots `stash@{N}` only — a shape strict
 * enough to bar options and refnames from reaching git as an argument. */
export function assertStashRef(stash: string): string {
  const trimmed = stash.trim();
  if (!/^stash@\{\d+\}$/.test(trimmed)) {
    throw new Error(`Not a valid stash ref: ${stash}`);
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
    case "cherry_pick": {
      const hash = assertHash(requireText(input.hash, "hash"));
      await assertCherryPickable(targetDir, hash);
      await expectOk(["cherry-pick", hash], cwd);
      return;
    }
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
    case "undo_commit": {
      const hash = assertHash(requireText(input.hash, "hash"));
      // Guard: only the current HEAD can be undone (same constraint VSCode
      // and most Git source controls impose — rewriting history under a
      // checked-out commit is safe; doing it to a random ancestor is not).
      const headResult = await runGit(["rev-parse", "--verify", "HEAD"], cwd);
      if (!gitOk(headResult) || headResult.stdout.trim() !== hash) {
        throw new Error("Only the current HEAD commit can be undone.");
      }
      // Soft reset drops the commit but keeps every change staged, matching
      // the standard "undo last commit" semantics. Fails on the root commit.
      await expectOk(["reset", "--soft", "HEAD~1"], cwd);
      return;
    }
    case "rebase_commit":
      await expectOk(["rebase", assertHash(requireText(input.hash, "hash"))], cwd);
      return;
    case "stash_push": {
      const message = input.message?.trim() ?? "";
      const args = ["stash", "push"];
      if (message !== "") args.push("-m", message);
      await expectOk(args, cwd);
      return;
    }
    case "stash_pop": {
      const ref = assertStashRef(requireText(input.stash, "stash"));
      await expectOk(["stash", "pop", ref], cwd);
      return;
    }
    case "stash_drop": {
      const ref = assertStashRef(requireText(input.stash, "stash"));
      await expectOk(["stash", "drop", ref], cwd);
      return;
    }
    case "stash_apply": {
      const ref = assertStashRef(requireText(input.stash, "stash"));
      await expectOk(["stash", "apply", ref], cwd);
      return;
    }
  }
}

function requireFile(input: ActInput): string {
  return requireText(input.file, "file");
}

/**
 * `git cherry-pick` has two ways to leave the repo worse off, both knowable
 * before it runs. Replaying a commit that is already an ancestor of HEAD
 * applies nothing, and git then stops with "the previous cherry-pick is now
 * empty" and a CHERRY_PICK_HEAD the user has to abort; a merge commit needs
 * `-m <mainline>`, which the panel never passes. The graph hides the button in
 * both cases — this is the backstop for a stale panel. A dirty tree is left to
 * git, whose own message ("your local changes would be overwritten") is exact.
 */
async function assertCherryPickable(targetDir: string, hash: string): Promise<void> {
  const probe = { cwd: targetDir, timeout: 5_000 };
  const ancestry = await runGit(["rev-list", "--parents", "-n", "1", hash], probe);
  if (gitOk(ancestry) && ancestry.stdout.trim().split(/\s+/).length > 2) {
    throw new Error("Cannot cherry-pick a merge commit without choosing a mainline parent.");
  }

  const ancestor = await runGit(["merge-base", "--is-ancestor", hash, "HEAD"], probe);
  if (ancestor.exitCode === 0) {
    throw new Error("That commit is already in the current branch.");
  }
}

function requireText(value: string | undefined, name: string): string {
  if (value === undefined || value.trim() === "") {
    throw new Error(`Missing ${name}.`);
  }
  return value;
}
