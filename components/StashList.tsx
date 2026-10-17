import { Fragment, useCallback, useEffect, useState } from "react";
import { useRpc } from "@get-bb/plugin-sdk/app";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { ConfirmDialog } from "@/components/GitDialogs";
import { DiffView, type DiffTarget } from "@/components/DiffView";
import { FileListView, type FileAction, type FileContextMenuEntry } from "@/components/FileListView";
import type { GitAction, GitStash, GitStashFile } from "../shared";
import type { rpcContract } from "../contract";
import { type ViewMode } from "@/components/ChangesList";

/**
 * Stash tab: stashed changes for the pinned repository, with push (via an
 * inline message textarea styled exactly like CommitBox), apply, pop and drop.
 * Mutations run through the rail's `runAction`; a successful run bumps
 * `refreshToken`, which reloads the list here.
 *
 * Clicking a stash row expands its detail inline, directly beneath that row
 * (show/hide, like a tree dropdown) — no view switch. Any number of rows can be
 * open at once and opening one never closes another. The panel shows the stash
 * identity, apply/pop/drop and a file list in its own scroll area, so a large
 * stash stays compact. The detail header (expanded inline beneath the row)
 * holds apply/pop/drop and a "Copy stash ref" button. A file click opens a diff
 * — a side-panel tab (when a thread navigator is registered) or the in-rail
 * DiffView drawer.
 */
export function StashList({
  rootId,
  repo,
  runAction,
  actionBusy,
  refreshToken,
  viewMode,
  onOpenDiff,
}: {
  rootId: string;
  repo: string;
  runAction: (input: { action: GitAction; file?: string; stash?: string; message?: string }) => Promise<boolean>;
  actionBusy: boolean;
  /** Bumped by the rail after any mutation; the list reloads on each bump. */
  refreshToken: number;
  viewMode: ViewMode;
  /** Open a stash file's diff as a side-panel tab; false keeps the in-rail view. */
  onOpenDiff?: (target: DiffTarget) => boolean;
}) {
  const rpc = useRpc<typeof rpcContract>();

  const [stashes, setStashes] = useState<GitStash[]>([]);
  const [loading, setLoading] = useState(true);
  const [confirm, setConfirm] = useState<{
    message: string;
    confirmLabel: string;
    destructive: boolean;
    stashRef: string;
    run: () => Promise<boolean>;
  } | null>(null);

  /* Inline stash input — a textarea, styled exactly like CommitBox. */
  const [stashMessage, setStashMessage] = useState("");
  /* Refs of stashes whose detail is expanded inline; several may be open. */
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  /* File list per stash ref, loaded the first time that stash is expanded. */
  const [filesByRef, setFilesByRef] = useState<Record<string, GitStashFile[]>>({});
  const [loadingByRef, setLoadingByRef] = useState<Record<string, boolean>>({});
  /* The file opened in the in-rail diff (used when no side-panel target exists). */
  const [diffTarget, setDiffTarget] = useState<{ stash: string; file: string } | null>(null);

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      const result = await rpc.call("stashList", { rootId, repo });
      setStashes(result.stashes);
    } catch {
      setStashes([]);
    } finally {
      setLoading(false);
    }
  }, [rpc, rootId, repo]);

  const loadFiles = useCallback(
    async (ref: string): Promise<void> => {
      setLoadingByRef((map) => ({ ...map, [ref]: true }));
      try {
        const result = await rpc.call("stashFiles", { rootId, repo, stash: ref });
        setFilesByRef((map) => ({ ...map, [ref]: result.files }));
      } catch {
        setFilesByRef((map) => ({ ...map, [ref]: [] }));
      } finally {
        setLoadingByRef((map) => ({ ...map, [ref]: false }));
      }
    },
    [rpc, rootId, repo],
  );

  /* Refresh the stash list on token bump. */
  useEffect(() => {
    void load();
  }, [load, refreshToken]);

  /* A different repository starts with every detail collapsed. */
  useEffect(() => {
    setExpanded(new Set());
    setDiffTarget(null);
  }, [rootId, repo]);

  /* Drop expanded refs whose stash is gone (popped or dropped). */
  useEffect(() => {
    setExpanded((previous) => {
      const live = new Set(stashes.map((stash) => stash.ref));
      const next = new Set([...previous].filter((ref) => live.has(ref)));
      return next.size === previous.size ? previous : next;
    });
  }, [stashes]);

  const openStash = (stash: GitStash): void => {
    setExpanded((previous) => {
      const next = new Set(previous);
      next.add(stash.ref);
      return next;
    });
    if (filesByRef[stash.ref] === undefined) void loadFiles(stash.ref);
  };

  const closeStash = (ref: string): void => {
    setExpanded((previous) => {
      if (!previous.has(ref)) return previous;
      const next = new Set(previous);
      next.delete(ref);
      return next;
    });
  };

  const handlePush = (): void => {
    if (actionBusy) return;
    void runAction({ action: "stash_push", message: stashMessage.trim() || undefined }).then((ok) => {
      if (ok) setStashMessage("");
    });
  };

  if (loading && stashes.length === 0) {
    return <p className="p-4 text-center text-[11px] text-muted-foreground">Loading stashes…</p>;
  }

  /* -------------------------------------------------------------- */
  /* Stage 2: a file inside a stash                                  */
  /* -------------------------------------------------------------- */
  if (diffTarget !== null) {
    return (
      <DiffView
        rootId={rootId}
        repo={repo}
        target={{ kind: "stash", stash: diffTarget.stash, file: diffTarget.file }}
        onBack={() => setDiffTarget(null)}
      />
    );
  }

  /* -------------------------------------------------------------- */
  /* Stage 1: push input + stash list with inline details            */
  /* -------------------------------------------------------------- */
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Push input — mirrors CommitBox's textarea + hint + button */}
      <div className="border-b border-sidebar-border p-2">
        <textarea
          value={stashMessage}
          onChange={(event) => setStashMessage(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && !actionBusy) {
              event.preventDefault();
              handlePush();
            }
          }}
          rows={2}
          placeholder="Stash message"
          aria-label="Stash message"
          disabled={actionBusy}
          className="min-h-9 w-full resize-y rounded-md border border-input bg-transparent px-2 py-1.5 text-xs text-foreground outline-none placeholder:text-muted-foreground focus-visible:ring-1 focus-visible:ring-ring"
        />
        <div className="mt-1.5 flex items-center justify-between gap-2">
          <span className="truncate text-[10px] text-muted-foreground">Stash tracked changes</span>
          <Button
            type="button"
            size="sm"
            className="h-7 shrink-0 px-3 text-xs"
            disabled={actionBusy}
            aria-label="Stash"
            onClick={handlePush}
          >
            {actionBusy ? "Stashing…" : "Stash"}
          </Button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {stashes.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-1 py-8 text-center">
            <Icon name="Archive" className="size-4 text-muted-foreground" />
            <p className="text-xs text-muted-foreground">No stashed changes.</p>
          </div>
        ) : (
          stashes.map((stash) => {
            const isOpen = expanded.has(stash.ref);
            const files = filesByRef[stash.ref] ?? [];
            const filesLoading = loadingByRef[stash.ref] === true;
            return (
              <Fragment key={stash.ref}>
                <div
                  role="button"
                  tabIndex={0}
                  className={
                    "flex min-w-0 cursor-pointer items-center gap-1.5 px-2 py-1.5 " +
                    (isOpen ? "bg-state-hover" : "hover:bg-state-hover")
                  }
                  onClick={() => (isOpen ? closeStash(stash.ref) : openStash(stash))}
                  onKeyDown={(event) => {
                    if (event.key !== "Enter") return;
                    if (isOpen) closeStash(stash.ref);
                    else openStash(stash);
                  }}
                  title={stash.message}
                >
                  <Icon
                    name={isOpen ? "ChevronDown" : "ChevronRight"}
                    className="size-3 shrink-0 text-muted-foreground"
                  />
                  <span
                    className="shrink-0 rounded border border-border px-1 text-[8px] text-muted-foreground"
                    title={stash.branch || undefined}
                  >
                    {stash.branch || "HEAD"}
                  </span>
                  <span
                    className="min-w-0 truncate text-[11px] font-medium text-foreground"
                    title={stash.message}
                  >
                    {stash.message}
                  </span>
                  {stash.hash !== undefined ? (
                    <span
                      className="shrink-0 font-mono text-[9px] text-muted-foreground"
                      title={stash.hash}
                    >
                      {stash.hash}
                    </span>
                  ) : null}
                </div>

                {isOpen ? (
                  <div className="border-b border-sidebar-border bg-state-hover/40 pb-1">
                    {/* Header: collapse + ref + copy stash ref to clipboard. */}
                    <div className="flex items-center gap-1.5 px-1.5 py-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-6 shrink-0"
                        aria-label="Collapse stash detail"
                        onClick={() => closeStash(stash.ref)}
                      >
                        <Icon name="ChevronUp" className="size-4" />
                      </Button>
                      <span
                        className="min-w-0 truncate font-mono text-[11px] text-foreground"
                        title={stash.ref}
                      >
                        {stash.ref}
                      </span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-6 shrink-0 ml-auto"
                        aria-label="Copy stash ref"
                        disabled={actionBusy}
                        onClick={() => {
                          void rpc
                            .call("copyTextToClipboard", { text: stash.ref })
                            .catch(() => undefined);
                        }}
                      >
                        <Icon name="Copy" className="size-3.5" />
                      </Button>
                    </div>

                    <div className="px-2 py-1">
                      <p className="text-xs font-medium text-foreground">{stash.message}</p>
                      <div className="mt-1 flex items-center gap-1.5">
                        <span
                          className="shrink-0 rounded border border-border px-1 text-[9px] text-muted-foreground"
                          title={stash.branch || undefined}
                        >
                          {stash.branch || "HEAD"}
                        </span>
                        {stash.hash !== undefined ? (
                          <span
                            className="shrink-0 font-mono text-[9px] text-muted-foreground"
                            title={stash.hash}
                          >
                            {stash.hash}
                          </span>
                        ) : null}
                      </div>

                      {/* Apply / Pop / Drop — same outline style as HistoryView's commit actions */}
                      <div className="mt-2 flex flex-wrap gap-1">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-6 px-2 text-[10px]"
                          disabled={actionBusy}
                          onClick={() =>
                            setConfirm({
                              message: `Apply ${stash.ref}?`,
                              confirmLabel: "Apply",
                              destructive: false,
                              stashRef: stash.ref,
                              run: () => runAction({ action: "stash_apply", stash: stash.ref }),
                            })
                          }
                        >
                          Apply
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-6 px-2 text-[10px]"
                          disabled={actionBusy}
                          onClick={() =>
                            setConfirm({
                              message: `Pop ${stash.ref}?`,
                              confirmLabel: "Pop",
                              destructive: false,
                              stashRef: stash.ref,
                              run: () => runAction({ action: "stash_pop", stash: stash.ref }),
                            })
                          }
                        >
                          Pop
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-6 px-2 text-[10px] text-destructive"
                          disabled={actionBusy}
                          onClick={() =>
                            setConfirm({
                              message: `Drop ${stash.ref}? This cannot be undone.`,
                              confirmLabel: "Drop",
                              destructive: true,
                              stashRef: stash.ref,
                              run: () => runAction({ action: "stash_drop", stash: stash.ref }),
                            })
                          }
                        >
                          Drop
                        </Button>
                      </div>
                    </div>

                    {/* File list — its own scroll area keeps a big stash compact. */}
                    <p className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                      Files ({files.length})
                    </p>
                    <div className="max-h-72 overflow-y-auto">
                      {filesLoading ? (
                        <p className="p-4 text-center text-[11px] text-muted-foreground">Loading files…</p>
                      ) : files.length === 0 ? (
                        <p className="p-4 text-center text-[11px] text-muted-foreground">
                          No files in this stash.
                        </p>
                      ) : (
                        <FileListView
                          files={files}
                          viewMode={viewMode}
                          disabled={actionBusy}
                          onFileClick={(file) => {
                            const target: DiffTarget = { kind: "stash", stash: stash.ref, file };
                            if (onOpenDiff?.(target) === true) return;
                            setDiffTarget({ stash: stash.ref, file });
                          }}
                          fileAction={(file) => ({
                            icon: "ArchiveRestore",
                            title: `Apply ${file} from ${stash.ref}`,
                            onClick: () =>
                              void runAction({
                                action: "stash_apply_file",
                                stash: stash.ref,
                                file,
                              }),
                          })}
                          fileContextMenu={(file) => [
                            {
                              label: `Apply ${file} from stash`,
                              onSelect: () =>
                                void runAction({
                                  action: "stash_apply_file",
                                  stash: stash.ref,
                                  file,
                                }),
                            },
                          ]}
                        />
                      )}
                    </div>
                  </div>
                ) : null}
              </Fragment>
            );
          })
        )}
      </div>

      {confirm !== null ? (
        <ConfirmDialog
          message={confirm.message}
          confirmLabel={confirm.confirmLabel}
          destructive={confirm.destructive}
          busy={actionBusy}
          onCancel={() => setConfirm(null)}
          onConfirm={() => {
            const pending = confirm;
            setConfirm(null);
            void pending.run().then((ok) => {
              if (ok) closeStash(pending.stashRef);
            });
          }}
        />
      ) : null}
    </div>
  );
}
