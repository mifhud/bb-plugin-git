import { useCallback, useEffect, useMemo, useState } from "react";
import { useRpc } from "@get-bb/plugin-sdk/app";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Icon } from "@/components/ui/icon";
import { ChoiceDialog, ConfirmDialog } from "@/components/GitDialogs";
import { DiffView, type DiffTarget } from "@/components/DiffView";
import {
  LANE_COLORS,
  buildBezierPath,
  computeCommitLanes,
  computeGraphLinks,
} from "@/lib/git-graph";
import type { GitAction, GitCommit, rpcContract } from "../contract";
import { FileListView } from "@/components/FileListView";
import { type ViewMode } from "@/components/ChangesList";

/**
 * History tab: one page of commits with a graph gutter, then a commit
 * detail with its files and the commit-level actions ompchamber offers
 * (cherry-pick, revert, reset, undo, rebase), then a file diff. Three
 * stages, one back button, exactly like the Changes tab's diff drawer.
 */

const ROW_H = 46;
const LANE_STEP = 12;
const PAGE_SIZE = 50;

export function HistoryView({
  rootId,
  repo,
  refreshToken,
  runAction,
  actionBusy,
  viewMode,
}: {
  rootId: string;
  repo: string;
  /** Bumped by the rail after any mutation; history reloads on each bump. */
  refreshToken: number;
  runAction: (input: {
    action: GitAction;
    hash?: string;
    mode?: "soft" | "mixed" | "hard";
  }) => Promise<boolean>;
  actionBusy: boolean;
  viewMode: ViewMode;
}) {
  const rpc = useRpc<typeof rpcContract>();
  const [commits, setCommits] = useState<GitCommit[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [selectedHash, setSelectedHash] = useState<string | null>(null);
  const [diffTarget, setDiffTarget] = useState<DiffTarget | null>(null);
  const [confirm, setConfirm] = useState<{
    action: GitAction;
    hash: string;
    message: string;
    destructive?: boolean;
    mode?: "soft" | "mixed" | "hard";
  } | null>(null);
  const [resetPrompt, setResetPrompt] = useState<string | null>(null);

  const loadPage = useCallback(
    async (skip: number): Promise<void> => {
      const result = await rpc.call("commits", { rootId, repo, limit: PAGE_SIZE, skip });
      setCommits((previous) => (skip === 0 ? result.commits : [...previous, ...result.commits]));
      setHasMore(result.hasMore);
    },
    [rpc, rootId, repo],
  );

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setSelectedHash(null);
    setDiffTarget(null);
    setQuery("");
    void loadPage(0)
      .catch((cause) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [loadPage, refreshToken]);

  const loadMore = (): void => {
    if (loadingMore) return;
    setLoadingMore(true);
    void loadPage(commits.length)
      .catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)))
      .finally(() => setLoadingMore(false));
  };

  const selected = commits.find((commit) => commit.hash === selectedHash) ?? null;

  const searchTerm = query.trim().toLowerCase();
  const isSearching = searchTerm !== "";

  const displayCommits = useMemo(
    () =>
      isSearching
        ? commits.filter(
            (commit) =>
              commit.message.toLowerCase().includes(searchTerm) ||
              commit.author.toLowerCase().includes(searchTerm) ||
              commit.shortHash.toLowerCase().includes(searchTerm) ||
              commit.hash.toLowerCase().includes(searchTerm) ||
              (commit.refs ?? []).some((ref) => ref.toLowerCase().includes(searchTerm)),
          )
        : commits,
    [commits, searchTerm, isSearching],
  );

  const laneMap = useMemo(() => computeCommitLanes(commits), [commits]);
  const maxLane = useMemo(() => {
    let max = 0;
    for (const lane of laneMap.values()) max = Math.max(max, lane);
    return max;
  }, [laneMap]);
  const gutterWidth = isSearching ? 0 : 16 + maxLane * LANE_STEP + 8;

  const positions = useMemo(() => {
    const map: Record<string, number> = {};
    commits.forEach((commit, index) => {
      map[commit.hash] = index * ROW_H + ROW_H / 2;
    });
    return map;
  }, [commits]);
  const links = useMemo(
    () => computeGraphLinks(commits, laneMap, positions, commits.length * ROW_H),
    [commits, laneMap, positions],
  );
  const laneX = (lane: number): number => 12 + lane * LANE_STEP;

  /* -------------------------------------------------------------- */
  /* Stage 3: a file inside the selected commit                      */
  /* -------------------------------------------------------------- */
  if (diffTarget !== null && selected !== null) {
    return (
      <DiffView
        rootId={rootId}
        repo={repo}
        target={diffTarget}
        onBack={() => setDiffTarget(null)}
      />
    );
  }

  /* -------------------------------------------------------------- */
  /* Stage 2: one commit                                            */
  /* -------------------------------------------------------------- */
  if (selected !== null) {
    const askCommit = (action: GitAction, message: string, destructive = false): void => {
      setConfirm({ action, hash: selected.hash, message, destructive });
    };
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex shrink-0 items-center gap-1 border-b border-sidebar-border px-1.5 py-1">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-6 shrink-0"
            aria-label="Back to history"
            onClick={() => setSelectedHash(null)}
          >
            <Icon name="ChevronLeft" className="size-4" />
          </Button>
          <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-foreground" title={selected.hash}>
            {selected.shortHash}
            <span className="ml-1.5 text-muted-foreground">{selected.author}</span>
          </span>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-6 shrink-0"
            aria-label="Copy commit hash"
            onClick={() => {
              void rpc
                .call("copyTextToClipboard", { text: selected.hash })
                .then((result) => {
                  if (!result.ok) setError(result.message ?? "Could not copy to the clipboard.");
                })
                .catch(() => setError("Could not copy to the clipboard."));
            }}
          >
            <Icon name="Copy" className="size-3.5" />
          </Button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="border-b border-sidebar-border p-2">
            <p className="text-xs font-medium text-foreground">{selected.message}</p>
            <p className="mt-1 text-[10px] text-muted-foreground">{selected.date}</p>
            {selected.refs !== undefined && selected.refs.length > 0 ? (
              <p className="mt-1 flex flex-wrap gap-1">
                {selected.refs.map((ref) => (
                  <span key={ref} className="rounded border border-border px-1 text-[9px] text-muted-foreground">
                    {ref}
                  </span>
                ))}
              </p>
            ) : null}

            <div className="mt-2 flex flex-wrap gap-1">
              {selected.refs?.some((ref) => ref.startsWith("HEAD")) === true &&
              selected.parents.length > 0 ? (
                <CommitActionButton
                  label="Undo Commit"
                  disabled={actionBusy}
                  onClick={() =>
                    askCommit(
                      "undo_commit",
                      `Undo ${selected.shortHash}? The commit will be removed but all changes stay staged.`,
                      true,
                    )
                  }
                />
              ) : null}
              <CommitActionButton
                label="Cherry Pick"
                disabled={actionBusy}
                onClick={() =>
                  askCommit("cherry_pick", `Cherry Pick ${selected.shortHash} onto the current branch?`)
                }
              />
              <CommitActionButton
                label="Revert"
                disabled={actionBusy}
                onClick={() =>
                  askCommit("revert_commit", `Create a revert commit for ${selected.shortHash}?`)
                }
              />
              <CommitActionButton
                label="Reset…"
                disabled={actionBusy}
                onClick={() => setResetPrompt(selected.hash)}
              />
              <CommitActionButton
                label="Rebase"
                disabled={actionBusy}
                onClick={() =>
                  askCommit(
                    "rebase_commit",
                    `Rebase the current branch onto ${selected.shortHash}? This rewrites commits.`,
                    true,
                  )
                }
              />
            </div>
          </div>

          <div className="py-1">
            <p className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Files ({selected.files?.length ?? 0})
            </p>
            {(selected.files ?? []).length === 0 ? (
              <p className="px-2 py-1 text-[11px] text-muted-foreground">
                File list unavailable for this commit.
              </p>
            ) : (
              <FileListView
                files={selected.files ?? []}
                viewMode={viewMode}
                onFileClick={(file) =>
                  setDiffTarget({ kind: "commit", hash: selected.hash, file })
                }
              />
            )}
          </div>
        </div>

        {confirm !== null ? (
          <ConfirmDialog
            message={confirm.message}
            confirmLabel={
              confirm.action === "cherry_pick"
                ? "Cherry Pick"
                : confirm.action === "revert_commit"
                  ? "Revert"
                  : confirm.action === "undo_commit"
                    ? "Undo"
                    : confirm.action === "reset_commit"
                      ? "Reset"
                      : "Rebase"
            }
            destructive={confirm.destructive === true}
            busy={actionBusy}
            onCancel={() => setConfirm(null)}
            onConfirm={() => {
              const pending = confirm;
              setConfirm(null);
              void runAction({
                action: pending.action,
                hash: pending.hash,
                ...(pending.mode !== undefined ? { mode: pending.mode } : {}),
              }).then((ok) => {
                if (ok) setSelectedHash(null);
              });
            }}
          />
        ) : null}

        {resetPrompt !== null ? (
          <ChoiceDialog
            message={`Reset to ${selected.shortHash}?`}
            choices={[
              { label: "Soft", description: "keep changes staged", value: "soft" },
              { label: "Mixed", description: "keep changes unstaged", value: "mixed" },
              { label: "Hard", description: "discard all changes", value: "hard", destructive: true },
            ]}
            onCancel={() => setResetPrompt(null)}
            onChoose={(mode) => {
              const hash = resetPrompt;
              setResetPrompt(null);
              if (mode === "hard") {
                // Hard reset throws work away — one extra confirmation.
                setConfirm({
                  action: "reset_commit",
                  hash,
                  mode,
                  message: `Hard reset to ${selected.shortHash}? ALL uncommitted changes will be lost.`,
                  destructive: true,
                });
              } else {
                void runAction({ action: "reset_commit", hash, mode: mode as "soft" | "mixed" }).then((ok) => {
                  if (ok) setSelectedHash(null);
                });
              }
            }}
          />
        ) : null}
      </div>
    );
  }

  /* -------------------------------------------------------------- */
  /* Stage 1: the commit list                                       */
  /* -------------------------------------------------------------- */
  if (loading && commits.length === 0) {
    return <p className="p-4 text-center text-[11px] text-muted-foreground">Loading history…</p>;
  }
  if (error !== null && commits.length === 0) {
    return <p className="p-4 text-[11px] text-destructive">{error}</p>;
  }
  if (commits.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-1 p-6 text-center">
        <Icon name="Clock" className="size-5 text-muted-foreground" />
        <p className="text-xs text-muted-foreground">No commits yet.</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {error !== null ? <p className="px-2 py-1 text-[10px] text-destructive">{error}</p> : null}

      <div className="shrink-0 border-b border-sidebar-border p-1.5">
        <div className="relative">
          <Icon name="Search" className="absolute left-2 top-1/2 size-3 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            placeholder="Search commits by message, author, hash…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="border-0 border-transparent pl-8 pr-8 text-[11px] shadow-none focus:ring-0"
          />
          {query !== "" ? (
            <button
              type="button"
              aria-label="Clear search"
              className="absolute right-1 top-1/2 -translate-y-1/2 rounded text-muted-foreground hover:bg-state-hover"
              onClick={() => setQuery("")}
            >
              <Icon name="X" className="size-3" />
            </button>
          ) : null}
        </div>
        {isSearching ? (
          <p className="px-1 pt-1 text-[10px] text-muted-foreground">
            {displayCommits.length} matching {displayCommits.length === 1 ? "commit" : "commits"}
            {hasMore ? " — load more to search deeper" : ""}
          </p>
        ) : null}
      </div>

      <div className="relative min-h-0 flex-1 overflow-y-auto pb-4">
        {isSearching && displayCommits.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-1 py-8 text-center">
            <Icon name="Search" className="size-4 text-muted-foreground" />
            <p className="text-xs text-muted-foreground">No matching commits.</p>
            {hasMore ? (
              <p className="text-[10px] text-muted-foreground">Click "Load more" to search more history.</p>
            ) : null}
          </div>
        ) : (
          <div className="relative" style={{ height: displayCommits.length * ROW_H }}>
            {!isSearching ? (
              <svg
                className="pointer-events-none absolute left-0 top-0"
                width={gutterWidth}
                height={commits.length * ROW_H}
                aria-hidden="true"
              >
                {links.map((link, index) => (
                  <path
                    key={`${link.fromHash}:${link.toHash}:${index}`}
                    d={buildBezierPath(laneX(link.fromLane), link.fromY, laneX(link.toLane), link.toY)}
                    stroke={link.color}
                    strokeWidth={1.5}
                    fill="none"
                    opacity={0.85}
                  />
                ))}
                {commits.map((commit) => {
                  const lane = laneMap.get(commit.hash) ?? 0;
                  const y = positions[commit.hash] ?? 0;
                  const isHead = commit.refs?.some((ref) => ref.startsWith("HEAD")) === true;
                  return (
                    <g key={commit.hash}>
                      <circle cx={laneX(lane)} cy={y} r={isHead ? 4.5 : 3.5} fill={LANE_COLORS[lane % LANE_COLORS.length]} />
                      {isHead ? (
                        <circle cx={laneX(lane)} cy={y} r={6.5} fill="none" stroke={LANE_COLORS[lane % LANE_COLORS.length]} strokeWidth={1} opacity={0.6} />
                      ) : null}
                    </g>
                  );
                })}
              </svg>
            ) : null}

            {displayCommits.map((commit, index) => (
              <div
                key={commit.hash}
                role="button"
                tabIndex={0}
                className="group absolute left-0 right-0 cursor-pointer px-2 transition-colors hover:bg-state-hover"
                style={{ top: index * ROW_H, height: ROW_H, paddingLeft: isSearching ? 2 : gutterWidth + 6 }}
                onClick={() => setSelectedHash(commit.hash)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") setSelectedHash(commit.hash);
                }}
                title={commit.message}
              >
                <div className="flex h-full flex-col justify-center gap-0.5 overflow-hidden">
                  <div className="flex min-w-0 items-center gap-1.5">
                    <span className="truncate text-[11px] font-medium text-foreground">
                      {commit.message}
                    </span>
                  </div>
                  <div className="flex min-w-0 items-center gap-1.5 text-[9px] text-muted-foreground">
                    <span className="shrink-0 font-mono">{commit.shortHash}</span>
                    <span className="truncate">{commit.author}</span>
                    <span className="shrink-0">{commit.date}</span>
                    {(commit.refs ?? []).map((ref) => (
                      <span
                        key={ref}
                        className="shrink-0 rounded border border-border px-1 text-[8px] text-primary"
                      >
                        {ref}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {hasMore ? (
          <div className="flex justify-center py-2">
            <Button type="button" variant="outline" size="sm" className="h-7 text-xs" disabled={loadingMore} onClick={loadMore}>
              {loadingMore ? "Loading…" : "Load more"}
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function CommitActionButton({
  label,
  disabled,
  onClick,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="h-6 px-2 text-[10px]"
      disabled={disabled}
      onClick={onClick}
    >
      {label}
    </Button>
  );
}
