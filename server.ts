import path from "node:path";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { rpcContract } from "./contract";
import { runAction } from "./src/git-actions";
import { fetchWorkingFileDiff } from "./src/git-diff";
import { fetchFileDiff, fetchGitCommits } from "./src/git-log";
import { discoveredRepos, rescanRepos, startRepoScan } from "./src/git-repos";
import { readStatus } from "./src/git-status";
import { gitSyncCount, refreshRemoteRefs } from "./src/git-sync";
import { resolveRoot } from "./src/roots";
import { listRootChoices, workspaceForThread } from "./src/workspace";

export { rpcContract } from "./contract";

export default async function plugin(bb: BbPluginApi): Promise<void> {
  bb.log.info("loaded");

  bb.settings.define({
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
  });

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
        const diff = await fetchFileDiff(targetDir, input.hash, input.file);
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
    clientLog: ({ message }) => {
      bb.log.info(`client: ${message}`);
      return { ok: true };
    },
  });

  bb.onDispose(() => {
    bb.log.info("disposed");
  });
}
