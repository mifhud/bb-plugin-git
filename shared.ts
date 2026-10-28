import { z } from "zod";

/**
 * Git feature types, ported from ompchamber's `shared/types/git.ts`, plus the
 * workspace/root shapes this plugin shares with the BB plugin SDK.
 *
 * This module is SDK-free — it imports nothing from `@get-bb/plugin-sdk` — so
 * both the server and the browser bundle can depend on it. The frontend must
 * never reach `contract.ts` (which pulls the server-only SDK `defineRpcContract`
 * import); browser code imports the data types and schemas it needs here, as
 * type-only when that is all it uses. `contract.ts` re-binds the `rpcContract`
 * value from these schemas for the server to register.
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
  /** False when the current branch has no upstream (a fresh local branch). */
  hasUpstream: z.boolean(),
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
  "stash_apply_file",
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
/**
 * File history result — commits that touched a specific file.
 */
export const fileHistorySchema = z.object({
  /** Commits touching the file, newest first. */
  commits: z.array(gitCommitSchema),
  /** Whether more commits exist beyond the loaded page. */
  hasMore: z.boolean(),
  /** Total commits touching the file (estimated). */
  total: z.number(),
});
export type FileHistory = z.infer<typeof fileHistorySchema>;

/* ------------------------------------------------------------------ */
/* Commit-message generation — agent model catalogue (mirrors          */
/* bb-plugin-rephrase, so the picker filters the same way).            */
/* ------------------------------------------------------------------ */

/** The agent a commit-message generation runs on, or null for the default. */
export const agentSelectionSchema = z.object({
  providerId: z.string().min(1),
  model: z.string().min(1),
});
export type AgentSelection = z.infer<typeof agentSelectionSchema>;

/** One selectable model row in the commit-message agent picker. */
export const modelChoiceSchema = z.object({
  providerId: z.string(),
  /** Provider display name, rendered as the group heading. */
  providerName: z.string(),
  model: z.string(),
  /** Row label: the catalogue's display name without its brand prefix. */
  label: z.string(),
  description: z.string(),
  /**
   * Listed only while searching. The host's picker hides these behind "More
   * models" until a query is typed, and so does this picker.
   */
  extra: z.boolean(),
});
export type ModelChoice = z.infer<typeof modelChoiceSchema>;

/** Result of generating a commit message: the message, or why there is none. */
export const commitMessageResultSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), message: z.string() }),
  z.object({ ok: z.literal(false), error: z.string() }),
]);
/** Result of resolving which chat-mentioned paths exist in the workspace. */
export const resolvePathsResultSchema = z.object({
  known: z.array(z.string()),
});
export type ResolvePathsResult = z.infer<typeof resolvePathsResultSchema>;
