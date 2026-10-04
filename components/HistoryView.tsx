import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
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
import { computeCherryPickState } from "@/lib/commit-actions";
import type { GitAction, GitCommit, rpcContract } from "../contract";
import { FileListView } from "@/components/FileListView";
import { type ViewMode } from "@/components/ChangesList";

/**
 * Graph tab: commits with a lane graph gutter. Clicking a commit expands an
 * inline detail directly beneath that row (show/hide, like a tree dropdown) —
 * no stage switch, and any number of rows can be open at once without closing
 * the others. The panel shows the commit message, refs, a copy-hash button,
 * commit-level actions (cherry-pick, revert, reset, undo, rebase) and a file
 * list whose diffs open as side-panel tabs or an in-rail drawer.
 *
 * Rows are absolutely positioned over a fixed-height SVG graph, so the detail
 * sits on its own layer right under the clicked row and every row/dot/link
 * after an open detail shifts down by that detail's measured height — the lane
 * dots stay glued to their rows. Each open detail's height is read in a layout
 * effect (pre-paint) so there is no flash; heights are kept per commit so
 * several open panels stack correctly. The graph is 0-wide while searching, so
 * the shifting only ever affects the visible layout.
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
  dirty,
  onOpenDiff,
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
  /** Uncommitted changes to tracked files: git refuses to cherry-pick then. */
  dirty: boolean;
  /** Open a commit file's diff as a side-panel tab; false keeps the in-rail view. */
  onOpenDiff?: (target: DiffTarget) => boolean;
}) {
  const rpc = useRpc<typeof rpcContract>();
  const [commits, setCommits] = useState<GitCommit[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  /* Hashes whose detail is expanded inline; several may be open at once. */
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const [diffTarget, setDiffTarget] = useState<DiffTarget | null>(null);
  const [confirm, setConfirm] = useState<{
    action: GitAction;
    hash: string;
    message: string;
    destructive?: boolean;
    mode?: "soft" | "mixed" | "hard";
  } | null>(null);
  const [resetPrompt, setResetPrompt] = useState<string | null>(null);

  /* Live detail elements + their measured heights, keyed by commit hash. */
  const detailRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const detailHeights = useRef<Map<string, number>>(new Map());
  /* Bumped after a measurement pass so the shifts re-render with fresh heights. */
  const [heightTick, setHeightTick] = useState(0);

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

  /* A different repository starts with every detail collapsed. */
  useEffect(() => {
    setExpanded(new Set());
    setDiffTarget(null);
    detailRefs.current.clear();
    detailHeights.current.clear();
  }, [loadPage]);

  const loadMore = (): void => {
    if (loadingMore) return;
    setLoadingMore(true);
    void loadPage(commits.length)
      .catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)))
      .finally(() => setLoadingMore(false));
  };

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

  // Cumulative height of every open detail before a given display index, so a
  // row at index i sits at i*ROW_H + offsetByIndex[i] and each dot/link lands on
  // its (shifted) row. Recomputed whenever a measurement pass bumps heightTick.
  const offsetByIndex = useMemo(() => {
    const cumulative = new Array<number>(displayCommits.length + 1).fill(0);
    displayCommits.forEach((commit, index) => {
      const height = expanded.has(commit.hash) ? (detailHeights.current.get(commit.hash) ?? 0) : 0;
      cumulative[index + 1] = cumulative[index] + height;
    });
    return cumulative;
  }, [displayCommits, expanded, heightTick]);
  const offsetAt = (index: number): number => offsetByIndex[index] ?? 0;

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
      map[commit.hash] = index * ROW_H + ROW_H / 2 + (offsetByIndex[index] ?? 0);
    });
    return map;
  }, [commits, offsetByIndex]);
  const graphHeight = commits.length * ROW_H + (offsetByIndex[commits.length] ?? 0);
  const links = useMemo(
    () => computeGraphLinks(commits, laneMap, positions, graphHeight),
    [commits, laneMap, positions, graphHeight],
  );
  const laneX = (lane: number): number => 12 + lane * LANE_STEP;

  // Measure every open detail after each commit (pre-paint) and re-render once
  // the heights settle, so stacked panels and their following rows realign.
  useLayoutEffect(() => {
    let changed = false;
    for (const commit of displayCommits) {
      if (!expanded.has(commit.hash)) continue;
      const element = detailRefs.current.get(commit.hash) ?? null;
      const height = element?.offsetHeight ?? 0;
      if ((detailHeights.current.get(commit.hash) ?? 0) !== height) {
        detailHeights.current.set(commit.hash, height);
        changed = true;
      }
    }
    if (changed) setHeightTick((tick) => tick + 1);
  });

  const expandCommit = (hash: string): void => {
    setExpanded((previous) => {
      const next = new Set(previous);
      next.add(hash);
      return next;
    });
  };
  const collapseCommit = (hash: string): void => {
    setExpanded((previous) => {
      if (!previous.has(hash)) return previous;
      const next = new Set(previous);
      next.delete(hash);
      return next;
    });
  };

  // Confirm wrapper for a commit's action buttons; the hash is explicit so
  // several open details each act on their own commit.
  const askCommit = (hash: string, action: GitAction, message: string, destructive = false): void => {
    setConfirm({ action, hash, message, destructive });
  };

  const resetCommit = resetPrompt === null ? null : (commits.find((c) => c.hash === resetPrompt) ?? null);

  /* -------------------------------------------------------------- */
  /* Stage 2: diff a file from a commit                              */
  /* -------------------------------------------------------------- */
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

  /* -------------------------------------------------------------- */
  /* Stage 1: the commit list, with inline detail panels             */
  /* -------------------------------------------------------------- */
  if (loading && commits.length === 0) {
    return <p className="p-4 text-center text-[11px] text-muted-foreground">Loading commits…</p>;
  }
  if (error !== null && commits.length === 0) {
    return <p className="px-2 py-1 text-[11px] text-destructive">{error}</p>;
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
              <p className="text-[10px] text-muted-foreground">Click "Load more" to search older commits.</p>
            ) : null}
          </div>
        ) : (
          <div
            className="relative"
            style={{ height: displayCommits.length * ROW_H + offsetAt(displayCommits.length) }}
          >
            {!isSearching ? (
              <svg
                className="pointer-events-none absolute left-0 top-0"
                width={gutterWidth}
                height={graphHeight}
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

            {displayCommits.map((commit, index) => {
              const isOpen = expanded.has(commit.hash);
              const cherryPick = isOpen ? computeCherryPickState(commits, commit.hash, dirty) : null;
              return (
                <Fragment key={commit.hash}>
                  <div
                    role="button"
                    tabIndex={0}
                    className={
                      "group absolute left-0 right-0 cursor-pointer px-2 transition-colors " +
                      (isOpen ? "bg-state-hover" : "hover:bg-state-hover")
                    }
                    style={{
                      top: index * ROW_H + offsetAt(index),
                      height: ROW_H,
                      paddingLeft: isSearching ? 2 : gutterWidth + 6,
                    }}
                    onClick={() => (isOpen ? collapseCommit(commit.hash) : expandCommit(commit.hash))}
                    onKeyDown={(event) => {
                      if (event.key !== "Enter") return;
                      if (isOpen) collapseCommit(commit.hash);
                      else expandCommit(commit.hash);
                    }}
                    title={commit.message}
                  >
                    <div className="flex h-full min-w-0 items-center gap-1.5 overflow-hidden">
                      <Icon
                        name={isOpen ? "ChevronDown" : "ChevronRight"}
                        className="size-3 shrink-0 text-muted-foreground"
                      />
                      <div className="min-w-0 flex-col flex-1">
                        <div className="flex min-w-0 items-center">
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
                  </div>

                  {isOpen ? (
                    <div
                      ref={(element) => {
                        if (element !== null) detailRefs.current.set(commit.hash, element);
                        else detailRefs.current.delete(commit.hash);
                      }}
                      className="absolute border-y border-sidebar-border bg-state-hover/40"
                      style={{
                        left: 0,
                        right: 0,
                        top: (index + 1) * ROW_H + offsetAt(index),
                        height: "auto",
                        paddingLeft: isSearching ? 2 : gutterWidth + 6,
                      }}
                    >
                      {/* Header: collapse + short hash + author + copy hash to clipboard. */}
                      <div className="flex items-center gap-1.5 border-b border-sidebar-border pr-2 py-1">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="size-6 shrink-0"
                          aria-label="Collapse commit detail"
                          onClick={() => collapseCommit(commit.hash)}
                        >
                          <Icon name="ChevronUp" className="size-4" />
                        </Button>
                        <span
                          className="min-w-0 truncate font-mono text-[11px] text-foreground"
                          title={commit.hash}
                        >
                          {commit.shortHash}
                          <span className="ml-1.5 text-muted-foreground">{commit.author}</span>
                        </span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="size-6 shrink-0 ml-auto"
                          aria-label="Copy commit hash"
                          disabled={actionBusy}
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

                      <div className="pr-2 py-1">
                        <p className="text-xs font-medium text-foreground">{commit.message}</p>
                        <p className="mt-1 text-[10px] text-muted-foreground">{commit.date}</p>
                        {commit.refs !== undefined && commit.refs.length > 0 ? (
                          <p className="mt-1 flex flex-wrap gap-1">
                            {commit.refs.map((ref) => (
                              <span
                                key={ref}
                                className="shrink-0 rounded border border-border px-1 text-[9px] text-muted-foreground"
                              >
                                {ref}
                              </span>
                            ))}
                          </p>
                        ) : null}

                        <div className="mt-2 flex flex-wrap gap-1">
                          {commit.refs?.some((ref) => ref.startsWith("HEAD")) === true &&
                          commit.parents.length > 0 ? (
                            <CommitActionButton
                              label="Undo Commit"
                              disabled={actionBusy}
                              onClick={() =>
                                askCommit(
                                  commit.hash,
                                  "undo_commit",
                                  `Undo ${commit.shortHash}? The commit will be removed but all changes stay staged.`,
                                  true,
                                )
                              }
                            />
                          ) : null}
                          {cherryPick !== null && cherryPick.show ? (
                            <CommitActionButton
                              label="Cherry Pick"
                              disabled={actionBusy || !cherryPick.enabled}
                              hint={cherryPick.reason}
                              onClick={() =>
                                askCommit(commit.hash, "cherry_pick", `Cherry Pick ${commit.shortHash} onto the current branch?`)
                              }
                            />
                          ) : null}
                          <CommitActionButton
                            label="Revert"
                            disabled={actionBusy}
                            onClick={() =>
                              askCommit(commit.hash, "revert_commit", `Create a revert commit for ${commit.shortHash}?`)
                            }
                          />
                          <CommitActionButton
                            label="Reset…"
                            disabled={actionBusy}
                            onClick={() => setResetPrompt(commit.hash)}
                          />
                          <CommitActionButton
                            label="Rebase"
                            disabled={actionBusy}
                            onClick={() =>
                              askCommit(
                                commit.hash,
                                "rebase_commit",
                                `Rebase the current branch onto ${commit.shortHash}? This rewrites commits.`,
                                true,
                              )
                            }
                          />
                        </div>
                      </div>

                      <div className="pr-2 py-1">
                        <p className="pb-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                          Files ({commit.files?.length ?? 0})
                        </p>
                        {(commit.files ?? []).length === 0 ? (
                          <p className="text-[11px] text-muted-foreground">
                            File list unavailable for this commit.
                          </p>
                        ) : (
                          <div className="max-h-72 overflow-y-auto">
                            <FileListView
                              files={commit.files ?? []}
                              viewMode={viewMode}
                              onFileClick={(file) => {
                                const target: DiffTarget = { kind: "commit", hash: commit.hash, file };
                                if (onOpenDiff?.(target) === true) return;
                                setDiffTarget(target);
                              }}
                            />
                          </div>
                        )}
                      </div>
                    </div>
                  ) : null}
                </Fragment>
              );
            })}
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
              if (ok) collapseCommit(pending.hash);
            });
          }}
        />
      ) : null}

      {resetPrompt !== null && resetCommit !== null ? (
        <ChoiceDialog
          message={`Reset to ${resetCommit.shortHash}?`}
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
                message: `Hard reset to ${resetCommit.shortHash}? ALL uncommitted changes will be lost.`,
                destructive: true,
              });
            } else {
              void runAction({ action: "reset_commit", hash, mode: mode as "soft" | "mixed" }).then((ok) => {
                if (ok) collapseCommit(hash);
              });
            }
          }}
        />
      ) : null}
    </div>
  );
}

function CommitActionButton({
  label,
  disabled,
  hint = null,
  onClick,
}: {
  label: string;
  disabled: boolean;
  /** Why the action is unavailable; the shared Button drops `title`, so a span carries it. */
  hint?: string | null;
  onClick: () => void;
}) {
  const button = (
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

  return hint === null ? button : <span title={hint}>{button}</span>;
}
