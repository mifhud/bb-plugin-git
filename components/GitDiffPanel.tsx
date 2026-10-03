import { useEffect, useMemo, useState } from "react";
import { useBbContext, useRpc, type PluginNewThreadPanelProps, type PluginThreadPanelProps } from "@get-bb/plugin-sdk/app";
import { DiffView, type DiffTarget } from "@/components/DiffView";
import type { GitDiffPanelParams } from "@/lib/open-diff-panel";
import type { rpcContract } from "../contract";

/**
 * The body of a Git diff tab in BB's side panel. The tab's params carry the
 * pinned root's stable `rootKey` and a repo-relative diff target; on mount this
 * resolves that key to a fresh server `rootId` (they are ephemeral) and hands
 * the work to the same `DiffView` the rail's drawer uses.
 */

function coerceTarget(value: unknown): DiffTarget | null {
  if (value === null || typeof value !== "object") return null;
  const target = value as Record<string, unknown>;
  if (target.kind === "working" && typeof target.file === "string") {
    if (typeof target.staged !== "boolean") return null;
    return {
      kind: "working",
      file: target.file,
      staged: target.staged,
      ...(typeof target.status === "string" ? { status: target.status } : {}),
    };
  }
  if (target.kind === "commit" && typeof target.hash === "string" && typeof target.file === "string") {
    return { kind: "commit", hash: target.hash, file: target.file };
  }
  if (target.kind === "stash" && typeof target.stash === "string" && typeof target.file === "string") {
    return { kind: "stash", stash: target.stash, file: target.file };
  }
  return null;
}

function coerceParams(value: unknown): GitDiffPanelParams | null {
  if (value === null || typeof value !== "object") return null;
  const params = value as Record<string, unknown>;
  const target = coerceTarget(params.target);
  if (typeof params.rootKey !== "string" || typeof params.repo !== "string" || target === null) return null;
  return { rootKey: params.rootKey, repo: params.repo, target };
}

export function GitDiffPanel({ params }: PluginThreadPanelProps | PluginNewThreadPanelProps) {
  const { threadId } = useBbContext();
  const rpc = useRpc<typeof rpcContract>();
  const request = useMemo(() => coerceParams(params), [params]);
  const [rootId, setRootId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (request === null) {
      setRootId(null);
      setError(null);
      return;
    }
    let cancelled = false;
    setRootId(null);
    setError(null);
    const pinnedThreadId = request.rootKey.startsWith("thread:") ? request.rootKey.slice(7) : null;
    void rpc
      .call("listRootChoices", { currentThreadId: threadId, pinnedThreadId })
      .then(({ choices }) => {
        if (cancelled) return;
        const choice = choices.find((candidate) => candidate.id === request.rootKey);
        if (choice === undefined) {
          setError("The pinned folder is no longer available. Reopen the diff from the Git panel.");
          return;
        }
        setRootId(choice.workspace.rootId);
      })
      .catch((cause) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
      });
    return () => {
      cancelled = true;
    };
  }, [rpc, threadId, request]);

  if (request === null) {
    return (
      <p className="p-4 text-[11px] text-muted-foreground">
        Open a changed file from the Git panel to see its diff here.
      </p>
    );
  }
  if (error !== null) {
    return <p className="p-4 text-[11px] text-destructive">{error}</p>;
  }
  if (rootId === null) {
    return <p className="p-4 text-center text-[11px] text-muted-foreground">Loading diff…</p>;
  }
  return <DiffView rootId={rootId} repo={request.repo} target={request.target} />;
}
