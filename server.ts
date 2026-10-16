import path from "node:path";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { rpcContract } from "./contract";
import {
  buildCommitPrompt,
  cleanAgentOutput,
  collectStagedDiff,
  COMMIT_SELECTION_KEY,
  createCatalogCache,
  DEFAULT_COMMIT_INSTRUCTION,
  resolveCommitTarget,
  runCommitMessageThread,
} from "./src/git-commit-gen";
import { runAction } from "./src/git-actions";
import { fetchWorkingFileDiff } from "./src/git-diff";
import { fetchFileDiff, fetchFileHistory, fetchGitCommits } from "./src/git-log";
import { discoveredRepos, rescanRepos, startRepoScan } from "./src/git-repos";
import { readStatus } from "./src/git-status";
import { fetchStashFileDiff, fetchStashFiles, readStashList } from "./src/git-stash";
import { gitSyncCount, refreshRemoteRefs } from "./src/git-sync";
import { resolveRoot } from "./src/roots";
import { listRootChoices, workspaceForThread } from "./src/workspace";
import { copyTextToClipboard } from "./src/git-clipboard";
import type { AgentSelection } from "./shared";
/** How long to wait for an agent to generate a commit message before giving up. */
const TIMEOUT_OPTIONS: Record<string, number> = {
  "30 seconds": 30_000,
  "1 minute": 60_000,
  "2 minutes": 120_000,
  "5 minutes": 300_000,
};
const DEFAULT_TIMEOUT_OPTION = "2 minutes";
export { rpcContract } from "./contract";

export default async function plugin(bb: BbPluginApi): Promise<void> {
  bb.log.info("loaded");

  const settings = bb.settings.define({
    openByDefault: {
      type: "boolean",
      label: "Show the Git panel when BB opens",
      default: true,
    },
    confirmDiscard: {
      type: "boolean",
      label: "Ask before discarding changes",
      description: "Applies to discarding a file's changes and to Discard all.",
      default: true,
    },
    autoRefresh: {
      type: "boolean",
      label: "Refresh changes automatically",
      description: "Re-read git status every 5 seconds while the panel is open.",
      default: true,
    },
    diffViewMode: {
      type: "select",
      label: "Default diff view",
      description: "How file diffs are laid out. You can still switch views per-diff in the diff toolbar.",
      options: ["unified", "split"],
      default: "unified",
    },
    fullContext: {
      type: "boolean",
      label: "Show full file context in diffs",
      description: "Show the entire file in diffs instead of only the changed hunks. You can still toggle this per-diff in the diff toolbar.",
      default: false,
    },
    commitMessageInstruction: {
      type: "string",
      label: "Commit message instruction",
      description:
        "Instruction sent to the agent with the staged diff when generating a commit message. Clear it to restore the built-in instruction.",
      default: DEFAULT_COMMIT_INSTRUCTION,
    },
    timeout: {
      type: "select",
      label: "Commit message timeout",
      description: "How long to wait for the agent to generate a commit message.",
      options: Object.keys(TIMEOUT_OPTIONS),
      default: DEFAULT_TIMEOUT_OPTION,
    },
  });
  const catalog = createCatalogCache(bb);

  /**
   * Git commands run in this process, so the repository must live on this
   * machine — a paired remote host's path means nothing here. The primary
   * host id is cached briefly: status polls every 5s and should not pay an
   * SDK round trip per tick. When the config carries no primary host id the
   * check passes: with one host (the common case) this process IS the host,
   * and refusing every root would brick the panel over a missing field.
   */
  let primaryHostCache: { id: string | null; at: number } | null = null;
  const onThisComputer = async (hostId: string): Promise<boolean> => {
    const now = Date.now();
    if (primaryHostCache === null || now - primaryHostCache.at > 60_000) {
      const config = await bb.sdk.system.config();
      primaryHostCache = { id: config.primaryHostId, at: now };
    }
    const primary = primaryHostCache.id;
    return primary === null || hostId === primary;
  };

  const requireLocalRoot = async (rootId: string): Promise<string> => {
    const root = resolveRoot(rootId);
    if (root === undefined) {
      throw new Error("The Git panel is out of date — reopen it and try again.");
    }
    if (!(await onThisComputer(root.hostId))) {
      throw new Error("This repository is on another computer.");
    }
    return root.rootPath;
  };

  /** Resolves the repo-relative selector to a contained working-tree path. */
  const resolveRepoDir = (rootPath: string, repo: string): string => {
    if (repo === "" || repo === ".") return rootPath;
    const target = path.resolve(rootPath, repo);
    if (target !== rootPath && !target.startsWith(rootPath + path.sep)) {
      throw new Error("Invalid repo path.");
    }
    return target;
  };

  bb.rpc.register(rpcContract, {
    listRootChoices: async (input) => ({
      choices: await listRootChoices(bb, input),
    }),
    workspaceForThread: async ({ threadId }) => workspaceForThread(bb, threadId),
    listRepos: async (input) => {
      const rootPath = await requireLocalRoot(input.rootId);
      if (input.rescan === true) rescanRepos(rootPath);
      else startRepoScan(rootPath);
      const { repos, pending } = discoveredRepos(rootPath);
      return { repos, pending };
    },
    status: async (input) => {
      const rootPath = await requireLocalRoot(input.rootId);
      const targetDir = resolveRepoDir(rootPath, input.repo);

      // Start the TTL'd remote refresh before the local probes so its round
      // trip overlaps them; the panel's sync badge is what needs it.
      const remoteRefresh = input.sync === true ? refreshRemoteRefs(targetDir) : Promise.resolve();
      const read = await readStatus(targetDir);
      await remoteRefresh;
      const syncCount = input.sync === true && read.isRepo ? await gitSyncCount(targetDir) : undefined;

      return {
        isRepo: read.isRepo,
        changes: read.changes,
        branch: read.branch,
        branches: read.branches,
        remoteBranches: read.remoteBranches,
        ...(syncCount !== undefined ? { syncCount } : {}),
        repo: input.repo,
      };
    },
    stashList: async (input) => {
      const rootPath = await requireLocalRoot(input.rootId);
      const targetDir = resolveRepoDir(rootPath, input.repo);
      return { stashes: await readStashList(targetDir) };
    },
    stashFiles: async (input) => {
      const rootPath = await requireLocalRoot(input.rootId);
      const targetDir = resolveRepoDir(rootPath, input.repo);
      const files = await fetchStashFiles(targetDir, input.stash);
      return { files };
    },
    stashFileDiff: async (input) => {
      try {
        const rootPath = await requireLocalRoot(input.rootId);
        const targetDir = resolveRepoDir(rootPath, input.repo);
        const diff = await fetchStashFileDiff(targetDir, input.stash, input.file, input.fullContext === true);
        if (diff === "") {
          return { ok: false as const, error: `No diff available for ${input.file} in ${input.stash}.` };
        }
        return { ok: true as const, diff, file: input.file };
      } catch (cause) {
        return {
          ok: false as const,
          error: cause instanceof Error ? cause.message : String(cause),
        };
      }
    },
    act: async (input) => {
      const rootPath = await requireLocalRoot(input.rootId);
      const targetDir = resolveRepoDir(rootPath, input.repo);
      return runAction(targetDir, {
        action: input.action,
        ...(input.file !== undefined ? { file: input.file } : {}),
        ...(input.message !== undefined ? { message: input.message } : {}),
        ...(input.branch !== undefined ? { branch: input.branch } : {}),
        ...(input.hash !== undefined ? { hash: input.hash } : {}),
        ...(input.mode !== undefined ? { mode: input.mode } : {}),
        ...(input.stash !== undefined ? { stash: input.stash } : {}),
      });
    },
    fileDiff: async (input) => {
      const rootPath = await requireLocalRoot(input.rootId);
      const targetDir = resolveRepoDir(rootPath, input.repo);
      return fetchWorkingFileDiff(
        targetDir,
        input.file,
        input.staged,
        input.status,
        input.fullContext === true,
      );
    },
    commits: async (input) => {
      const rootPath = await requireLocalRoot(input.rootId);
      const targetDir = resolveRepoDir(rootPath, input.repo);
      return fetchGitCommits(targetDir, input.limit, input.skip);
    },
    commitDiff: async (input) => {
      try {
        const rootPath = await requireLocalRoot(input.rootId);
        const targetDir = resolveRepoDir(rootPath, input.repo);
        const diff = await fetchFileDiff(targetDir, input.hash, input.file, input.fullContext === true);
        if (diff === "") {
          return { ok: false as const, error: `No diff available for ${input.file}.` };
        }
        return { ok: true as const, diff, file: input.file };
      } catch (cause) {
        return {
          ok: false as const,
          error: cause instanceof Error ? cause.message : String(cause),
        };
      }
    },
    fileHistory: async (input) => {
      const rootPath = await requireLocalRoot(input.rootId);
      const targetDir = resolveRepoDir(rootPath, input.repo);
      return fetchFileHistory(targetDir, input.file, input.limit, input.skip);
    },
    copyTextToClipboard: ({ text }) => copyTextToClipboard(text),
    clientLog: ({ message }) => {
      bb.log.info(`client: ${message}`);
      return { ok: true };
    },
    generateCommitMessage: async (input) => {
      try {
        const rootPath = await requireLocalRoot(input.rootId);
        const targetDir = resolveRepoDir(rootPath, input.repo);
        const diff = await collectStagedDiff(targetDir);
        if (diff === "") {
          return { ok: false as const, error: "No staged changes to generate a commit message from." };
        }
        const { commitMessageInstruction, timeout } = await settings.get();
        const timeoutMs =
          TIMEOUT_OPTIONS[timeout] ?? TIMEOUT_OPTIONS[DEFAULT_TIMEOUT_OPTION]!;
        const selection =
          (await bb.storage.kv.get<AgentSelection>(COMMIT_SELECTION_KEY)) ?? null;
        const target = await resolveCommitTarget(bb, input.rootKey, selection);
        const prompt = buildCommitPrompt(commitMessageInstruction.trim() || DEFAULT_COMMIT_INSTRUCTION, diff);
        const output = await runCommitMessageThread(bb, target, prompt, timeoutMs);
        const cleaned = cleanAgentOutput(output ?? "");
        if (cleaned === "") {
          return { ok: false as const, error: "The agent returned an empty commit message." };
        }
        return { ok: true as const, message: cleaned };
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause);
        bb.log.warn(`commit message generation failed: ${message}`);
        return { ok: false as const, error: message };
      }
    },
    commitAgentCatalog: async ({ refresh }) => {
      const snapshot = await catalog.read(refresh);
      return {
        selection: (await bb.storage.kv.get<AgentSelection>(COMMIT_SELECTION_KEY)) ?? null,
        ...snapshot,
      };
    },
    selectCommitAgent: async ({ selection }) => {
      if (selection === null) {
        await bb.storage.kv.delete(COMMIT_SELECTION_KEY);
      } else {
        await bb.storage.kv.set(COMMIT_SELECTION_KEY, selection);
      }
      return { selection };
    },
  });

  bb.onDispose(() => {
    bb.log.info("disposed");
  });
}
