import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";

/**
 * Git feature types, ported from ompchamber's `shared/types/git.ts`, plus the
 * workspace/root shapes this plugin shares with the BB plugin SDK. The RPC
 * contract at the bottom is the single source of truth for every call the
 * panel makes: the server registers it, the app types against it.
 */

export const gitChangeSchema = z.object({
  file: z.string(),
  /** Raw two-column porcelain status, e.g. `M `, ` M`, `??`, `R `. */
  status: z.string(),
  staged: z.boolean(),
  additions: z.number().optional(),
  deletions: z.number().optional(),
});
export type GitChange = z.infer<typeof gitChangeSchema>;

export const gitCommitFileSchema = z.object({
  file: z.string(),
  status: z.string(),
  additions: z.number(),
  deletions: z.number(),
});
export type GitCommitFile = z.infer<typeof gitCommitFileSchema>;

export const gitCommitSchema = z.object({
  hash: z.string(),
  shortHash: z.string(),
  author: z.string(),
  date: z.string(),
  message: z.string(),
  parents: z.array(z.string()),
  refs: z.array(z.string()).optional(),
  files: z.array(gitCommitFileSchema).optional(),
});
export type GitCommit = z.infer<typeof gitCommitSchema>;

export const fileDiffSchema = z.object({
  file: z.string(),
  diff: z.string(),
  oldContent: z.string().optional(),
  newContent: z.string().optional(),
  staged: z.boolean(),
  status: z.string(),
  additions: z.number().optional(),
  deletions: z.number().optional(),
});
export type FileDiffData = z.infer<typeof fileDiffSchema>;

export const gitSyncCountSchema = z.object({
  ahead: z.number(),
  behind: z.number(),
});
export type GitSyncCount = z.infer<typeof gitSyncCountSchema>;

/* ------------------------------------------------------------------ */
/* Workspace roots — the same shape bb-plugin-file-tree registers.     */
/* ------------------------------------------------------------------ */

export const workspaceSchema = z.object({
  environmentId: z.string().nullable(),
  hostId: z.string(),
  rootPath: z.string(),
  rootName: z.string(),
  /** Opaque id minted server-side for {hostId, rootPath}. */
  rootId: z.string(),
});
export type Workspace = z.infer<typeof workspaceSchema>;

export const rootChoiceSchema = z.object({
  id: z.string(),
  label: z.string(),
  projectId: z.string().nullable(),
  workspace: workspaceSchema,
});
export type RootChoice = z.infer<typeof rootChoiceSchema>;

export const workspaceResultSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), workspace: workspaceSchema }),
  z.object({
    ok: z.literal(false),
    reason: z.enum(["no_thread", "no_environment", "no_checkout"]),
  }),
]);
export type WorkspaceResult = z.infer<typeof workspaceResultSchema>;

/* ------------------------------------------------------------------ */
/* Payloads                                                            */
/* ------------------------------------------------------------------ */

export const gitStatusSchema = z.object({
  /** False when the chosen folder is not a git repository at all. */
  isRepo: z.boolean(),
  changes: z.array(gitChangeSchema),
  branch: z.string(),
  branches: z.array(z.string()),
  remoteBranches: z.array(z.string()),
  syncCount: gitSyncCountSchema.optional(),
  /** Repo-relative path (`.` for the root repo). Echoed for scope checks. */
  repo: z.string(),
});
export type GitStatus = z.infer<typeof gitStatusSchema>;

export const repoListSchema = z.object({
  repos: z.array(z.string()),
  pending: z.boolean(),
});
export type RepoList = z.infer<typeof repoListSchema>;
export const gitStashSchema = z.object({
  /** Reflog-style ref, e.g. `stash@{0}` — the form git commands take. */
  ref: z.string(),
  /** Reverse position: 0 is the newest stash, increments toward older. */
  index: z.number().int().nonnegative(),
  /** Originating branch, `""` when it can't be parsed (e.g. detached HEAD). */
  branch: z.string(),
  /** Stash message — a commit subject for auto stashes, the `-m` text otherwise. */
  message: z.string(),
  /** Short subject hash, present on auto (`WIP on`) stashes. */
  hash: z.string().optional(),
});
export type GitStash = z.infer<typeof gitStashSchema>;

export const gitStashListSchema = z.object({
  stashes: z.array(gitStashSchema),
});

export const stashFileSchema = z.object({
  file: z.string(),
  additions: z.number().optional(),
  deletions: z.number().optional(),
});
export type GitStashFile = z.infer<typeof stashFileSchema>;

export const stashFilesSchema = z.object({
  files: z.array(stashFileSchema),
});
export type StashFiles = z.infer<typeof stashFilesSchema>;

/**
 * Every mutation the panel can issue. The server whitelists these names; the
 * extra payload fields are only read for the actions that need them.
 */
export const gitActionSchema = z.enum([
  "stage",
  "stage_all",
  "unstage",
  "unstage_all",
  "revert",
  "revert_all",
  "commit",
  "checkout",
  "create_branch",
  "push",
  "pull",
  "sync",
  "cherry_pick",
  "revert_commit",
  "reset_commit",
  "merge_commit",
  "undo_commit",
  "rebase_commit",
  "stash_push",
  "stash_pop",
  "stash_drop",
  "stash_apply",
]);
export type GitAction = z.infer<typeof gitActionSchema>;

export const actionResultSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true) }),
  z.object({ ok: z.literal(false), error: z.string() }),
]);
export type ActionResult = z.infer<typeof actionResultSchema>;

export const commitPageSchema = z.object({
  commits: z.array(gitCommitSchema),
  hasMore: z.boolean(),
  total: z.number(),
});
export type CommitPage = z.infer<typeof commitPageSchema>;

export const commitDiffResultSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), diff: z.string(), file: z.string() }),
  z.object({ ok: z.literal(false), error: z.string() }),
]);
export type CommitDiffResult = z.infer<typeof commitDiffResultSchema>;

/* ------------------------------------------------------------------ */
/* RPC contract                                                        */
/* ------------------------------------------------------------------ */

export const rpcContract = defineRpcContract({
  /** Project sources and thread workspaces the Git panel can pin. */
  listRootChoices: {
    input: z.object({
      currentThreadId: z.string().min(1).nullable(),
      pinnedThreadId: z.string().min(1).nullable(),
    }).strict(),
    output: z.object({ choices: z.array(rootChoiceSchema) }),
  },
  workspaceForThread: {
    input: z.object({ threadId: z.string().min(1) }).strict(),
    output: workspaceResultSchema,
  },
  /**
   * Nested-repository discovery under a root. The walk runs in the
   * background; `pending` stays true until it lands.
   */
  listRepos: {
    input: z.object({
      rootId: z.string().min(1),
      rescan: z.boolean().optional(),
    }).strict(),
    output: repoListSchema,
  },
  /** Branch, changes and (optionally) ahead/behind for one repo. */
  status: {
    input: z.object({
      rootId: z.string().min(1),
      repo: z.string().max(4096),
      sync: z.boolean().optional(),
    }).strict(),
    output: gitStatusSchema,
  },
  /** Stashed entries for one repo (push/pop/drop mutate this list). */
  stashList: {
    input: z.object({
      rootId: z.string().min(1),
      repo: z.string().max(4096),
    }).strict(),
    output: gitStashListSchema,
  },
  /** File list + diff for one stash entry. */
  stashFiles: {
    input: z.object({
      rootId: z.string().min(1),
      repo: z.string().max(4096),
      stash: z.string().max(64),
    }).strict(),
    output: stashFilesSchema,
  },
  stashFileDiff: {
    input: z.object({
      rootId: z.string().min(1),
      repo: z.string().max(4096),
      stash: z.string().max(64),
      file: z.string().max(4096),
      fullContext: z.boolean().optional(),
    }).strict(),
    output: commitDiffResultSchema,
  },
  /** Every stage/unstage/commit/branch/sync mutation. */
  act: {
    input: z
      .object({
        rootId: z.string().min(1),
        repo: z.string().max(4096),
        action: gitActionSchema,
        file: z.string().max(4096).optional(),
        message: z.string().max(20000).optional(),
        branch: z.string().max(255).optional(),
        hash: z.string().max(64).optional(),
        /** soft | mixed | hard — only read for reset_commit. */
        mode: z.enum(["soft", "mixed", "hard"]).optional(),
        stash: z.string().max(64).optional(),
      })
      .strict(),
    output: actionResultSchema,
  },
  /** Working-tree or index diff for one file. */
  fileDiff: {
    input: z
      .object({
        rootId: z.string().min(1),
        repo: z.string().max(4096),
        file: z.string().max(4096),
        staged: z.boolean(),
        status: z.string().max(4).optional(),
        fullContext: z.boolean().optional(),
      })
      .strict(),
    output: fileDiffSchema,
  },
  /** One page of commit history, newest first. */
  commits: {
    input: z.object({
      rootId: z.string().min(1),
      repo: z.string().max(4096),
      limit: z.number().int().min(1).max(200),
      skip: z.number().int().min(0),
    }).strict(),
    output: commitPageSchema,
  },
  /** Diff of one file inside one commit. */
  commitDiff: {
    input: z.object({
      rootId: z.string().min(1),
      repo: z.string().max(4096),
      hash: z.string().min(1).max(64),
      file: z.string().max(4096),
      fullContext: z.boolean().optional(),
    }).strict(),
    output: commitDiffResultSchema,
  },
  /** Copy a short string (commit hash, stash ref) to the system clipboard.
   *  Done server-side — navigator.clipboard is blocked under WSL, so this
   *  mirrors bb-plugin-file-tree's clipboard RPC. */
  copyTextToClipboard: {
    input: z.object({ text: z.string().max(2000) }).strict(),
    output: z.object({ ok: z.boolean(), message: z.string().optional() }),
  },
  /** Diagnostics from the browser, so DOM behaviour shows up in bb.log. */
  clientLog: {
    input: z.object({ message: z.string().max(2000) }).strict(),
    output: z.object({ ok: z.boolean() }),
  },
});
