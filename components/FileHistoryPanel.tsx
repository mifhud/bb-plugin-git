import { useCallback, useEffect, useState } from "react";
import { useRpc, useSettings } from "@get-bb/plugin-sdk/app";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Icon } from "@/components/ui/icon";
import { DiffView, type DiffTarget } from "@/components/DiffView";
import { FileListView } from "@/components/FileListView";
import type { ViewMode } from "@/components/ChangesList";
import { parseCommitsPerPage } from "@/lib/history-limit";
import type { GitCommit } from "../shared";
import type { rpcContract } from "../contract";

/**
 * The rail's History tab: every commit that touched one file, mimicking
 * VS Code GitLens. Enter a repo-relative path to list the commits, expand one
 * for its files, and click a file to read its diff — in BB's side panel, or
 * the rail's inline drawer when the surface has no side panel. The workspace
 * root and repository come from the rail's selectors, so this panel never
 * resolves a root of its own.
 */

export function FileHistoryPanel({
  rootId,
  repo,
  viewMode,
  targetPath,
  onOpenDiff,
}: {
  rootId: string;
  repo: string;
  viewMode: ViewMode;
  /** A file path injected by the graph tab's "File History" jump. Loads it on
   *  mount; null leaves the panel on its empty placeholder state. */
  targetPath?: string | null;
  onOpenDiff?: (target: DiffTarget) => boolean;
}) {
  const rpc = useRpc<typeof rpcContract>();
  const { values: settingsValues } = useSettings();
  /* Same page size as the Graph tab: how many rows one load shows. */
  const pageSize = parseCommitsPerPage(settingsValues?.commitsPerPage);

  const [filePath, setFilePath] = useState("");
  const [commits, setCommits] = useState<GitCommit[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const [diffTarget, setDiffTarget] = useState<DiffTarget | null>(null);

  const loadHistory = useCallback(
    async (skip: number, path: string): Promise<void> => {
      const trimmed = path.trim();
      if (trimmed === "") return;
      const result = await rpc.call("fileHistory", {
        rootId,
        repo,
        file: trimmed,
        limit: pageSize,
        skip,
      });
      setCommits((prev) => (skip === 0 ? result.commits : [...prev, ...result.commits]));
      setHasMore(result.hasMore);
    },
    [rpc, rootId, repo, pageSize],
  );

  /** Reset the list state and load one path: the manual refresh and the graph
   *  tab's "File History" jump (which arrives as `targetPath`) share this. */
  const resetAndLoad = useCallback(
    (path: string): void => {
      const trimmed = path.trim();
      if (trimmed === "") return;
      setFilePath(trimmed);
      setLoading(true);
      setError(null);
      setCommits([]);
      setExpanded(new Set());
      setDiffTarget(null);
      void loadHistory(0, trimmed)
        .catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)))
        .finally(() => setLoading(false));
    },
    [loadHistory],
  );

  const refresh = (): void => {
    resetAndLoad(filePath);
  };

  const loadMore = (): void => {
    void loadHistory(commits.length, filePath).catch((cause) =>
      setError(cause instanceof Error ? cause.message : String(cause)),
    );
  };

  /* A path injected from the graph tab's right-click "File History" jumps the
   * History tab to that file. The pane remounts on each visit to the History
   * tab, so this fires fresh whenever the tab opens with a pending path. */
  useEffect(() => {
    if (targetPath == null) return;
    resetAndLoad(targetPath);
  }, [targetPath, resetAndLoad]);

  const toggleExpand = (hash: string): void => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(hash)) next.delete(hash);
      else next.add(hash);
      return next;
    });
  };

  const openFileDiff = (hash: string, file: string): void => {
    const target: DiffTarget = { kind: "commit", hash, file };
    if (onOpenDiff?.(target) === true) return;
    setDiffTarget(target);
  };

  /* ---------------------------------------------------------------- */
  /* Stage 2: one file's diff inside one commit                        */
  /* ---------------------------------------------------------------- */
  if (diffTarget !== null) {
    return (
      <DiffView
        rootId={rootId}
        repo={repo}
        target={diffTarget}
        onBack={() => setDiffTarget(null)}
      />
    );
  }

  /* ---------------------------------------------------------------- */
  /* Stage 1: the path input over the commit list                      */
  /* ---------------------------------------------------------------- */
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-1 border-b border-sidebar-border px-1.5 py-1">
        <Input
          aria-label="File path"
          placeholder="File path"
          value={filePath}
          onChange={(event) => setFilePath(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") refresh();
          }}
          className="h-6 min-w-0 flex-1 px-2 py-0 text-[11px]"
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-6 shrink-0 gap-1 px-2 text-[10px]"
          disabled={loading || filePath.trim() === ""}
          onClick={refresh}
        >
          <Icon name={loading ? "Loading" : "Search"} className={`size-3${loading ? " animate-spin" : ""}`} />
          History
        </Button>
      </div>

      {error !== null ? (
        <div className="shrink-0 border-b border-sidebar-border bg-destructive/10 px-2 py-1.5">
          <p className="text-[11px] text-destructive">{error}</p>
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto">
        {loading && commits.length === 0 ? (
          <p className="p-4 text-center text-[11px] text-muted-foreground">Loading history…</p>
        ) : commits.length === 0 ? (
          <p className="p-4 text-center text-[11px] text-muted-foreground">
            {filePath.trim() === ""
              ? "Enter a file path to see its history."
              : "No commits found for this file."}
          </p>
        ) : (
          <>
            {commits.map((commit) => (
              <div key={commit.hash} className="border-b border-border/50">
                <button
                  type="button"
                  className="flex w-full items-start gap-2 px-2 py-1.5 text-left transition-colors hover:bg-state-hover"
                  onClick={() => toggleExpand(commit.hash)}
                  title={commit.message}
                >
                  <Icon
                    name={expanded.has(commit.hash) ? "ChevronDown" : "ChevronRight"}
                    className="mt-0.5 size-3 shrink-0 text-muted-foreground"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[11px] font-medium">{commit.message}</span>
                    <span className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[10px] text-muted-foreground">
                      <span className="font-mono">{commit.shortHash}</span>
                      <span>·</span>
                      <span className="truncate">{commit.author}</span>
                      <span>·</span>
                      <span>{commit.date}</span>
                    </span>
                  </span>
                </button>

                {expanded.has(commit.hash) ? (
                  <div className="border-t border-border/50 bg-background/50 py-1 pr-2">
                    {/* Header: collapse + short hash + copy hash to clipboard. */}
                    <div className="flex items-center gap-1.5 px-2 py-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-6 shrink-0"
                        aria-label="Collapse commit detail"
                        onClick={() => toggleExpand(commit.hash)}
                      >
                        <Icon name="ChevronUp" className="size-4" />
                      </Button>
                      <span
                        className="min-w-0 truncate font-mono text-[11px] text-foreground"
                        title={commit.hash}
                      >
                        {commit.shortHash}
                      </span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-6 shrink-0 ml-auto"
                        aria-label="Copy commit hash"
                        onClick={() => {
                          void rpc
                            .call("copyTextToClipboard", { text: commit.hash })
                            .then((result) => {
                              if (!result.ok) setError(result.message ?? "Could not copy to the clipboard.");
                            })
                            .catch(() => setError("Could not copy to the clipboard."));
                        }}
                      >
                        <Icon name="Copy" className="size-3.5" />
                      </Button>
                    </div>
                    <p className="px-2 pb-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                      Files ({commit.files?.length ?? 0})
                    </p>
                    {(commit.files ?? []).length === 0 ? (
                      <p className="px-2 text-[11px] text-muted-foreground">
                        File list unavailable for this commit.
                      </p>
                    ) : (
                      <div className="max-h-72 overflow-y-auto">
                        <FileListView
                          files={commit.files ?? []}
                          viewMode={viewMode}
                          onFileClick={(file) => openFileDiff(commit.hash, file)}
                        />
                      </div>
                    )}
                  </div>
                ) : null}
              </div>
            ))}

            {hasMore ? (
              <div className="flex justify-center p-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-6 px-2 text-[10px]"
                  onClick={loadMore}
                >
                  Load more ({commits.length} loaded)
                </Button>
              </div>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
