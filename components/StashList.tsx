import { useCallback, useEffect, useState } from "react";
import { useRpc } from "@get-bb/plugin-sdk/app";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { ConfirmDialog } from "@/components/GitDialogs";
import { DiffView, type DiffTarget } from "@/components/DiffView";
import type { GitAction, GitStash, GitStashFile, rpcContract } from "../contract";
import { FileListView } from "@/components/FileListView";
import { type ViewMode } from "@/components/ChangesList";

/**
 * Stash tab: stashed changes for the pinned repository, with push (via an
 * inline message textarea styled exactly like CommitBox), apply, pop and drop.
 * Mutations run through the rail's `runAction`; a successful run bumps
 * `refreshToken`, which reloads the list here.
 *
 * Layout mirrors HistoryView's 3-stage list → detail → diff:
 *  - Stage 1: a CommitBox-style push input, then the stash list.
 *  - Stage 2: a stash detail — index + copy button in the header, then
 *    message + branch/hash + apply/pop/drop actions + file list in the body.
 *  - Stage 3: DiffView for a single file in the expanded stash.
 * Action buttons live in Stage 2 (detail), not the list, so a glance at
 * the list is just stash identities — same visual density as HistoryView.
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
  runAction: (input: { action: GitAction; stash?: string; message?: string }) => Promise<boolean>;
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
    run: () => Promise<boolean>;
  } | null>(null);

  /* Inline stash input — a textarea, styled exactly like CommitBox. */
  const [stashMessage, setStashMessage] = useState("");
  /* 3-stage navigation (list → detail → diff). */
  const [expandedStash, setExpandedStash] = useState<GitStash | null>(null);
  const [stashFiles, setStashFiles] = useState<GitStashFile[]>([]);
  const [stashFilesLoading, setStashFilesLoading] = useState(false);
  const [diffFile, setDiffFile] = useState<string | null>(null);

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
    async (stash: GitStash): Promise<void> => {
      setStashFilesLoading(true);
      try {
        const result = await rpc.call("stashFiles", { rootId, repo, stash: stash.ref });
        setStashFiles(result.files);
      } catch {
        setStashFiles([]);
      } finally {
        setStashFilesLoading(false);
      }
    },
    [rpc, rootId, repo],
  );

  /* Refresh the stash list on token bump. */
  useEffect(() => {
    void load();
  }, [load, refreshToken]);

  /* Fetch the file list when a stash is expanded. */
  useEffect(() => {
    if (expandedStash !== null) {
      void loadFiles(expandedStash);
    }
  }, [expandedStash, loadFiles]);

  /* Collapsing the stash detail resets the file selection too. */
  useEffect(() => {
    if (expandedStash === null) setDiffFile(null);
  }, [expandedStash]);

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
  /* Stage 3: a file inside the expanded stash                      */
  /* -------------------------------------------------------------- */
  if (diffFile !== null && expandedStash !== null) {
    return (
      <DiffView
        rootId={rootId}
        repo={repo}
        target={{ kind: "stash", stash: expandedStash.ref, file: diffFile }}
        onBack={() => setDiffFile(null)}
      />
    );
  }

  /* -------------------------------------------------------------- */
  /* Stage 2: stash detail — index, message, actions, files          */
  /* -------------------------------------------------------------- */
  if (expandedStash !== null) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        {/* Header: back + index + copy ref (mirrors HistoryView's hash header) */}
        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-sidebar-border px-1.5 py-1">
          <div className="flex min-w-0 items-center gap-1.5">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-6 shrink-0"
              aria-label="Back"
              onClick={() => setExpandedStash(null)}
            >
              <Icon name="ChevronLeft" className="size-4" />
            </Button>
            <span
              className="min-w-0 truncate font-mono text-[11px] text-foreground"
              title={expandedStash.ref}
            >
              {expandedStash.ref}
            </span>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-6 shrink-0"
            aria-label={`Copy ${expandedStash.ref}`}
            onClick={() => {
              void rpc
                .call("copyTextToClipboard", { text: expandedStash.ref })
                .catch(() => undefined);
            }}
          >
            <Icon name="Copy" className="size-3.5" />
          </Button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {/* Stash info: message + branch/hash + actions, then file list */}
          <div className="border-b border-sidebar-border p-2">
            <p className="text-xs font-medium text-foreground">{expandedStash.message}</p>
            <div className="mt-1 flex items-center gap-1.5">
              <span
                className="shrink-0 rounded border border-border px-1 text-[9px] text-muted-foreground"
                title={expandedStash.branch || undefined}
              >
                {expandedStash.branch || "HEAD"}
              </span>
              {expandedStash.hash !== undefined ? (
                <span
                  className="shrink-0 font-mono text-[9px] text-muted-foreground"
                  title={expandedStash.hash}
                >
                  {expandedStash.hash}
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
                    message: `Apply ${expandedStash.ref}?`,
                    confirmLabel: "Apply",
                    destructive: false,
                    run: () => runAction({ action: "stash_apply", stash: expandedStash.ref }),
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
                    message: `Pop ${expandedStash.ref}?`,
                    confirmLabel: "Pop",
                    destructive: false,
                    run: () => runAction({ action: "stash_pop", stash: expandedStash.ref }),
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
                    message: `Drop ${expandedStash.ref}? This cannot be undone.`,
                    confirmLabel: "Drop",
                    destructive: true,
                    run: () => runAction({ action: "stash_drop", stash: expandedStash.ref }),
                  })
                }
              >
                Drop
              </Button>
            </div>
          </div>

          {/* File list */}
          <p className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Files ({stashFiles.length})
          </p>
          {stashFilesLoading ? (
            <p className="p-4 text-center text-[11px] text-muted-foreground">Loading files…</p>
          ) : stashFiles.length === 0 ? (
            <p className="p-4 text-center text-[11px] text-muted-foreground">No files in this stash.</p>
          ) : (
            <FileListView
              files={stashFiles}
              viewMode={viewMode}
              onFileClick={(file) => {
                const target: DiffTarget = { kind: "stash", stash: expandedStash.ref, file };
                if (onOpenDiff?.(target) === true) return;
                setDiffFile(file);
              }}
            />
          )}
        </div>
      </div>
    );
  }

  /* -------------------------------------------------------------- */
  /* Stage 1: stash list with a CommitBox-style push input           */
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
          className="w-full resize-none rounded-md border border-input bg-transparent px-2 py-1.5 text-xs text-foreground outline-none placeholder:text-muted-foreground focus-visible:ring-1 focus-visible:ring-ring"
        />
        <div className="mt-1.5 flex items-center justify-between gap-2">
          <span className="truncate text-[10px] text-muted-foreground">
            Stash tracked changes
          </span>
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
          stashes.map((stash) => (
            <div key={stash.ref} className="flex min-w-0 items-center px-2 py-1.5">
              <div
                role="button"
                tabIndex={0}
                className="min-w-0 flex-1 cursor-pointer items-center gap-1.5"
                onClick={() => setExpandedStash(stash)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") setExpandedStash(stash);
                }}
              >
                <span
                  className="shrink-0 rounded border border-border px-1 text-[8px] text-muted-foreground"
                  title={stash.branch || undefined}
                >
                  {stash.branch || "HEAD"}
                </span>
                <span className="truncate text-[11px] font-medium text-foreground" title={stash.message}>
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
            </div>
          ))
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
            void pending.run();
          }}
        />
      ) : null}
    </div>
  );
}
