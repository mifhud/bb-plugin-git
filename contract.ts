import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";
import {
  actionResultSchema,
  agentSelectionSchema,
  commitDiffResultSchema,
  commitMessageResultSchema,
  commitPageSchema,
  fileDiffSchema,
  fileHistorySchema,
  gitActionSchema,
  gitStashListSchema,
  gitStatusSchema,
  modelChoiceSchema,
  repoListSchema,
  rootChoiceSchema,
  stashFilesSchema,
  workspaceResultSchema,
} from "./shared";

/**
 * Browser-safe schemas, types, and constants live in `shared.ts`. This module
 * imports the server-only `defineRpcContract` from `@get-bb/plugin-sdk`, so it
 * must never be reached by the browser bundle — frontend code takes `rpcContract`
 * from here as a type and everything else from `shared.ts`.
 */
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
        /** Only read for push/sync: publish with `push --set-upstream origin HEAD`. */
        setUpstream: z.boolean().optional(),
        stagedOnly: z.boolean().optional(),
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
  /** Commits touching a specific file, newest first. Mimics VS Code GitLens file history. */
  fileHistory: {
    input: z.object({
      rootId: z.string().min(1),
      repo: z.string().max(4096),
      /** Repo-relative path of the file to show history for. */
      file: z.string().max(4096),
      limit: z.number().int().min(1).max(200),
      skip: z.number().int().min(0),
    }).strict(),
    output: fileHistorySchema,
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
  /**
   * Generate a commit message from the staged diff for the given repo.
   * Runs an agent in a hidden thread; the model/picker are configured in
   * the plugin's settings (mirrors bb-plugin-rephrase).
   */
  generateCommitMessage: {
    input: z
      .object({
        rootId: z.string().min(1),
        repo: z.string().max(4096),
        /** Pinned root id as seen by the panel (`source:<id>` or `thread:<id>`). */
        rootKey: z.string().min(1),
      })
      .strict(),
    output: commitMessageResultSchema,
  },
  /** Cached model catalogue for the commit-message agent picker. */
  commitAgentCatalog: {
    input: z.object({ refresh: z.boolean() }).strict(),
    output: z.object({
      selection: agentSelectionSchema.nullable(),
      choices: z.array(modelChoiceSchema),
      /** Agents that reported no catalogue, by display name. */
      unavailable: z.array(z.string()),
      /** Agents still being asked, by display name. */
      pending: z.array(z.string()),
      discovering: z.boolean(),
    }),
  },
  /** Persist the picked agent for commit-message generation. */
  selectCommitAgent: {
    input: z
      .object({ selection: agentSelectionSchema.nullable() })
      .strict(),
    output: z.object({ selection: agentSelectionSchema.nullable() }),
  },
});
