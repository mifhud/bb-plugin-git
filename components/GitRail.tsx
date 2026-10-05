import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useBbContext, useBbNavigate, useRpc, useSettings } from "@get-bb/plugin-sdk/app";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { useIsCompactViewport } from "@/components/ui/hooks/use-compact-viewport";
import { BranchToolbar } from "@/components/BranchToolbar";
import { ChangesList, readStoredViewMode, writeStoredViewMode, type ViewMode } from "@/components/ChangesList";
import { CommitBox } from "@/components/CommitBox";
import { ConfirmDialog, PromptDialog } from "@/components/GitDialogs";
import { DiffView, type DiffTarget } from "@/components/DiffView";
import { HistoryView } from "@/components/HistoryView";
import { StashList } from "@/components/StashList";
import { RailResizeHandle } from "@/components/RailResizeHandle";
import { diffNavigation } from "@/lib/diff-navigation";
import { openDiffInPanel } from "@/lib/open-diff-panel";
import { acquireRailInset, syncRailInset } from "@/lib/rail-inset";
import { usePortalScopeProps } from "@/lib/portal-scope";
import { RAIL_EVENT, initializeRailOpen, writeStoredOpen } from "@/lib/rail-state";
import { useRailWidthPx } from "@/lib/rail-width";
import type { GitAction, GitChange, GitStatus, RootChoice, rpcContract } from "../contract";

const ROOT_STORAGE_KEY = "bb-plugin-git:pinned-root";
const STATUS_POLL_MS = 5000;
const REPO_POLL_MS = 1500;

function readPinnedRoot(): string | null {
  try {
    const value = localStorage.getItem(ROOT_STORAGE_KEY);
    return value !== null && /^(?:thread|source):[\w-]{1,128}$/u.test(value) ? value : null;
  } catch {
    return null;
  }
}

function writePinnedRoot(id: string): void {
  try {
    localStorage.setItem(ROOT_STORAGE_KEY, id);
  } catch {
    /* private mode: the choice lasts for this window only */
  }
}

/** Mounted once per BB window. Navigation never owns or unmounts the panel. */
export function GitRail() {
  const rpc = useRpc<typeof rpcContract>();
  const { threadId, projectId } = useBbContext();
  const appNavigate = useBbNavigate();
  const { values, isLoading: settingsLoading } = useSettings();
  const compact = useIsCompactViewport();
  const railWidthPx = useRailWidthPx();
  const portalScopeProps = usePortalScopeProps();
  const insetHolderId = useRef(`git:window:${Math.random().toString(36).slice(2)}`).current;
  const initialized = useRef(false);

  const [open, setOpen] = useState(false);
  const [ready, setReady] = useState(false);

  // Pinned workspace root (same selector flow as bb-plugin-file-tree).
  const [selectedId, setSelectedId] = useState<string | null>(readPinnedRoot);
  const [choices, setChoices] = useState<RootChoice[]>([]);
  const [loadingRoots, setLoadingRoots] = useState(true);
  const [rootError, setRootError] = useState<string | null>(null);
  const [refreshCount, setRefreshCount] = useState(0);

  // Repo picker.
  const [repo, setRepo] = useState(".");
  const [repos, setRepos] = useState<string[]>(["."]);
  const [reposPending, setReposPending] = useState(false);

  // Status.
  const [status, setStatus] = useState<GitStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [manualTick, setManualTick] = useState(0);

  // Tab / detail / drafts.
  const [tab, setTab] = useState<"changes" | "graph" | "stash">("changes");
  const [viewMode, setViewMode] = useState<ViewMode>(readStoredViewMode);
  const [message, setMessage] = useState("");
  const [diffFile, setDiffFile] = useState<GitChange | null>(null);
  const [diffStaged, setDiffStaged] = useState(false);
  const [historyToken, setHistoryToken] = useState(0);
  const [stashToken, setStashToken] = useState(0);

  // Dialogs.
  const [confirm, setConfirm] = useState<{
    message: string;
    confirmLabel: string;
    destructive: boolean;
    run: () => Promise<boolean>;
  } | null>(null);
  const [branchPrompt, setBranchPrompt] = useState(false);

  const confirmDiscard = values?.confirmDiscard !== false;
  const autoRefresh = values?.autoRefresh !== false;

  /* -------------------------------- rail open state ------------------ */
  useEffect(() => {
    if (settingsLoading || initialized.current) return;
    initialized.current = true;
    if (compact) writeStoredOpen(false);
    setOpen(compact ? false : initializeRailOpen(values?.openByDefault !== false));
    setReady(true);
  }, [compact, settingsLoading, values?.openByDefault]);

  useEffect(() => {
    const onRailEvent = (event: Event) => {
      const next = (event as CustomEvent<boolean>).detail;
      if (typeof next === "boolean") setOpen(next);
    };
    window.addEventListener(RAIL_EVENT, onRailEvent);
    return () => window.removeEventListener(RAIL_EVENT, onRailEvent);
  }, []);

  /* -------------------------------- root choices --------------------- */
  const pinnedThreadId = selectedId?.startsWith("thread:") ? selectedId.slice(7) : null;
  /** Thread the selector last followed, so the follow branch fires only on a
   *  real thread switch — not on re-renders from pinning — like
   *  bb-plugin-file-tree. */
  const lastFollowedThread = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    let cancelled = false;
    setLoadingRoots(true);
    void rpc
      .call("listRootChoices", { currentThreadId: threadId, pinnedThreadId })
      .then(({ choices: next }) => {
        if (cancelled) return;
        setChoices(next);
        setRootError(null);
        // Opening a thread follows that thread's checkout: switching threads
        // re-points the selection, mirroring bb-plugin-file-tree. The pinned
        // choice is what New Thread keeps — there is no thread to follow.
        // git prefers the thread workspace (a local checkout) over a project
        // source, since git only runs against roots on this machine.
        if (threadId !== null && lastFollowedThread.current !== threadId) {
          lastFollowedThread.current = threadId;
          const follow = next.find((choice) => choice.id === `thread:${threadId}`)
            ?? next.find((choice) => choice.projectId !== null && choice.projectId === projectId);
          if (follow !== undefined) {
            if (follow.id !== selectedId) {
              setSelectedId(follow.id);
              writePinnedRoot(follow.id);
            }
            return;
          }
        }
        if (selectedId === null) {
          const preferred =
            next.find((choice) => choice.id === `thread:${threadId}`) ??
            next.find((choice) => choice.projectId !== null && choice.projectId === projectId) ??
            next[0];
          if (preferred !== undefined) {
            setSelectedId(preferred.id);
            writePinnedRoot(preferred.id);
          }
        }
      })
      .catch((cause) => {
        if (!cancelled) setRootError(cause instanceof Error ? cause.message : String(cause));
      })
      .finally(() => {
        if (!cancelled) setLoadingRoots(false);
      });
    return () => {
      cancelled = true;
    };
    // selectedId is read for the follow and first-pick branches, but kept out of
    // the deps so pinning does not re-run the root listing every time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rpc, threadId, projectId, pinnedThreadId, refreshCount]);

  const chosen = choices.find((choice) => choice.id === selectedId) ?? null;
  const rootId = chosen?.workspace.rootId ?? null;
  const railOpen = ready && open;

  /* -------------------------------- repo list ------------------------ */
  useEffect(() => {
    if (!railOpen || rootId === null) return;
    let cancelled = false;
    setRepo(".");
    setRepos(["."]);
    setReposPending(false);
    const load = async (rescan: boolean): Promise<void> => {
      try {
        const result = await rpc.call("listRepos", { rootId, rescan });
        if (cancelled) return;
        setRepos(result.repos);
        setReposPending(result.pending);
        if (result.pending) {
          window.setTimeout(() => void load(false), REPO_POLL_MS);
        }
      } catch {
        if (!cancelled) setReposPending(false);
      }
    };
    void load(false);
    return () => {
      cancelled = true;
    };
  }, [rpc, railOpen, rootId]);

  /* -------------------------------- status reads --------------------- */
  const readStatus = useCallback(
    async (sync: boolean = true): Promise<void> => {
      if (rootId === null) return;
      try {
        const result = await rpc.call("status", { rootId, repo, sync });
        setStatus(result);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    },
    [rpc, rootId, repo],
  );

  /* Errors persist for at least a minute so the user can read git's
   * message — the 5s poll no longer wipes them, and a successful action
   * still dismisses them immediately. */
  useEffect(() => {
    if (error === null) return;
    const timer = window.setTimeout(() => setError(null), 60_000);
    return () => window.clearTimeout(timer);
  }, [error]);

  useEffect(() => {
    if (!railOpen || rootId === null) return;
    let cancelled = false;
    const tick = (): void => {
      if (cancelled || document.hidden) return;
      void readStatus();
    };
    void readStatus();
    const interval = autoRefresh ? window.setInterval(tick, STATUS_POLL_MS) : null;
    const onVisible = (): void => {
      if (!document.hidden) tick();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      if (interval !== null) window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [railOpen, rootId, readStatus, autoRefresh, manualTick]);

  /* -------------------------------- actions -------------------------- */
  const runAction = useCallback(
    async (input: {
      action: GitAction;
      file?: string;
      message?: string;
      branch?: string;
      hash?: string;
      mode?: "soft" | "mixed" | "hard";
      stash?: string;
    }): Promise<boolean> => {
      if (rootId === null) return false;
      setBusy(true);
      try {
        const result = await rpc.call("act", { rootId, repo, ...input });
        if (result.ok) {
          setError(null);
          await readStatus(false);
          setHistoryToken((token) => token + 1);
          setStashToken((token) => token + 1);
          return true;
        }
        setError(result.error);
        return false;
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
        return false;
      } finally {
        setBusy(false);
      }
    },
    [rpc, rootId, repo, readStatus],
  );

  /**
   * Show a diff. Prefers a real tab in BB's built-in side panel; when this
   * window has no thread-scoped navigator (the New Thread compose screen, where
   * threadId is null and GitHeaderAction does not mount), it falls back to the
   * app-wide navigator so openThreadPanel can target the compose surface's
   * panel. If the surface still declines, it returns false and the caller keeps
   * the rail's own drawer.
   */
  const openDiff = useCallback(
    (target: DiffTarget): boolean => {
      if (selectedId === null) return false;
      const navigate = threadId !== null ? diffNavigation(threadId) : appNavigate;
      if (navigate === null) return false;
      return openDiffInPanel(navigate, { rootKey: selectedId, repo, target });
    },
    [threadId, appNavigate, selectedId, repo],
  );

  /** Discard flows ask first (unless the setting says never). */
  const requestDiscard = (message: string, file?: string): void => {
    const execute = (): Promise<boolean> => runAction({ action: "revert", ...(file !== undefined ? { file } : {}) });
    if (!confirmDiscard) {
      void execute();
      return;
    }
    setConfirm({ message, confirmLabel: "Discard", destructive: true, run: execute });
  };

  const commitNow = (): void => {
    setCommitting(true);
    void runAction({ action: "commit", message }).then((ok) => {
      setCommitting(false);
      if (ok) setMessage("");
    });
  };

  /* -------------------------------- layout --------------------------- */
  useLayoutEffect(() => {
    if (!railOpen || compact) {
      syncRailInset();
      return;
    }
    return acquireRailInset(insetHolderId);
  }, [compact, insetHolderId, railOpen]);

  if (!ready) return null;

  const isRepo = status?.isRepo === true;
  const stagedCount = (status?.changes ?? []).filter((c) => c.staged).length;

  const body = (() => {
    if (rootId === null) {
      return (
        <p className="p-4 text-[11px] text-muted-foreground">
          Choose a project or thread workspace with a checkout.
        </p>
      );
    }
    if (status === null) {
      return <p className="p-4 text-[11px] text-muted-foreground">Loading git status…</p>;
    }
    if (!isRepo) {
      return (
        <div className="flex flex-col gap-1 p-4 text-[11px] text-muted-foreground">
          <p>Not a git repository.</p>
          {repos.length > 1 ? <p>Pick a repository from the selector above.</p> : null}
        </div>
      );
    }
    if (tab === "graph") {
      // Untracked files do not block a pick; edits to tracked ones do.
      const dirty = status.changes.some((change) => change.status !== "??");
      return (
        <HistoryView
          rootId={rootId}
          repo={repo}
          refreshToken={historyToken}
          runAction={runAction}
          actionBusy={busy}
          viewMode={viewMode}
          dirty={dirty}
          onOpenDiff={openDiff}
        />
      );
    }
    if (tab === "stash") {
      return (
        <StashList
          rootId={rootId}
          repo={repo}
          runAction={runAction}
          actionBusy={busy}
          viewMode={viewMode}
          refreshToken={stashToken}
          onOpenDiff={openDiff}
        />
      );
    }
    if (diffFile !== null) {
      return (
        <DiffView
          rootId={rootId}
          repo={repo}
          target={{ kind: "working", file: diffFile.file, staged: diffStaged, status: diffFile.status }}
          onBack={() => setDiffFile(null)}
        />
      );
    }
    return (
      <>
        <CommitBox
          message={message}
          onMessageChange={setMessage}
          hasStagedChanges={stagedCount > 0}
          stagedCount={stagedCount}
          isBusy={busy}
          isCommitting={committing}
          onCommit={commitNow}
        />
        <ChangesList
          changes={status.changes}
          viewMode={viewMode}
          isBusy={busy}
          onOpenDiff={(change, staged) => {
            const target: DiffTarget = { kind: "working", file: change.file, staged, status: change.status };
            if (openDiff(target)) return;
            setDiffFile(change);
            setDiffStaged(staged);
          }}
          onStage={(file) => void runAction({ action: "stage", file })}
          onUnstage={(file) => void runAction({ action: "unstage", file })}
          onDiscard={(file) =>
            requestDiscard(`Discard all changes in ${file}? This cannot be undone.`, file)
          }
          onStageAll={() => void runAction({ action: "stage_all" })}
          onUnstageAll={() => void runAction({ action: "unstage_all" })}
          onDiscardAll={() =>
            requestDiscard("Discard ALL unstaged changes? This cannot be undone.")
          }
        />
      </>
    );
  })();

  return createPortal(
    <aside
      {...portalScopeProps}
      className="fixed bottom-0 right-0 top-0 z-40 flex flex-col border-l border-sidebar-border bg-sidebar text-sidebar-foreground"
      style={{ display: railOpen ? "flex" : "none", width: compact ? "100vw" : `${railWidthPx}px` }}
      aria-label="Git"
    >
      {compact ? null : <RailResizeHandle />}

      <div className="flex h-[48px] shrink-0 items-center justify-between border-b border-sidebar-border pl-3 pr-1">
        <span className="truncate text-sm font-medium text-muted-foreground">Git</span>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-7 shrink-0 p-0"
          aria-label="Hide git panel"
          onClick={() => writeStoredOpen(false)}
        >
          <Icon name="GitBranch" className="size-4" />
        </Button>
      </div>

      {/* Workspace root selector */}
      <div className="flex shrink-0 items-center gap-1 border-b border-sidebar-border px-1.5 py-1">
        <SearchableSelect
          ariaLabel="Git workspace folder"
          triggerTitle="Pinned workspace — switching threads does not change this panel"
          value={selectedId}
          onValueChange={(id) => {
            setSelectedId(id);
            writePinnedRoot(id);
          }}
          placeholder="Choose a folder"
          searchPlaceholder="Search projects…"
          options={choices.map((choice) => ({
            value: choice.id,
            label: choice.label,
          }))}
        />
        <button
          type="button"
          aria-label="Refresh folder list"
          title="Refresh folder list"
          className="flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-state-hover"
          onClick={() => setRefreshCount((count) => count + 1)}
        >
          <Icon name="RotateCcw" className="size-3" />
        </button>
      </div>

      {/* Repository selector (nested repos) */}
      <div className="flex shrink-0 items-center gap-1 border-b border-sidebar-border px-1.5 py-1">
        <SearchableSelect
          ariaLabel="Repository"
          triggerTitle="Repository inside the workspace"
          value={repo}
          onValueChange={(value) => {
            setRepo(value);
            setDiffFile(null);
          }}
          placeholder={repos.length === 0 ? "No repositories" : undefined}
          searchPlaceholder="Search repositories…"
          options={repos.map((value) => ({
            value,
            label: value === "." ? `${chosen?.workspace.rootName ?? "."} (root)` : value,
          }))}
        />
        <button
          type="button"
          aria-label="Rescan repositories"
          title={reposPending ? "Scanning for repositories…" : "Rescan repositories"}
          className="flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-state-hover"
          onClick={() => {
            if (rootId === null) return;
            void rpc
              .call("listRepos", { rootId, rescan: true })
              .then((result) => {
                setRepos(result.repos);
                setReposPending(result.pending);
              })
              .catch(() => undefined);
          }}
        >
          <Icon name={reposPending ? "Spinner" : "FolderGit"} className="size-3" />
        </button>
      </div>

      {isRepo ? (
        <BranchToolbar
          branch={status?.branch ?? "main"}
          branches={status?.branches ?? ["main"]}
          remoteBranches={status?.remoteBranches ?? []}
          syncCount={status?.syncCount}
          isBusy={busy}
          onCheckout={(name) => void runAction({ action: "checkout", branch: name })}
          onCreateBranch={() => setBranchPrompt(true)}
          onSync={() => void runAction({ action: "sync" })}
          onPull={() => void runAction({ action: "pull" })}
          onPush={() => void runAction({ action: "push" })}
          viewMode={viewMode}
          onViewModeChange={(mode) => {
            setViewMode(mode);
            writeStoredViewMode(mode);
          }}
          onRefresh={() => setManualTick((tick) => tick + 1)}
        />
      ) : null}

      {isRepo ? (
        <div className="flex shrink-0 items-center border-b border-sidebar-border px-1.5 py-1">
          {(["changes", "graph", "stash"] as const).map((name) => (
            <button
              key={name}
              type="button"
              aria-pressed={tab === name}
              onClick={() => {
                setTab(name);
                setDiffFile(null);
              }}
              className={`rounded px-2 py-1 text-[11px] font-medium capitalize transition-colors ${
                tab === name
                  ? "bg-state-active text-foreground"
                  : "text-muted-foreground hover:bg-state-hover"
              }`}
            >
              {name}
              {name === "changes" && (status?.changes.length ?? 0) > 0 && status !== null ? (
                <span className="ml-1 text-[9px] text-muted-foreground">{status.changes.length}</span>
              ) : null}
            </button>
          ))}
        </div>
      ) : null}

      {rootError !== null ? <p className="px-2 py-2 text-[11px] text-destructive">{rootError}</p> : null}
      {error !== null ? (
        <div className="flex items-start justify-between gap-2 border-b border-sidebar-border bg-destructive/10 px-2 py-1.5">
          <p className="min-w-0 text-[11px] text-destructive">{error}</p>
          <button
            type="button"
            aria-label="Dismiss error"
            className="shrink-0 text-muted-foreground hover:text-foreground"
            onClick={() => setError(null)}
          >
            <Icon name="X" className="size-3" />
          </button>
        </div>
      ) : null}
      {loadingRoots && choices.length === 0 ? (
        <p className="px-2 py-2 text-[11px] text-muted-foreground">Loading folders…</p>
      ) : null}

      <div className="flex min-h-0 flex-1 flex-col">{body}</div>

      {confirm !== null ? (
        <ConfirmDialog
          message={confirm.message}
          confirmLabel={confirm.confirmLabel}
          destructive={confirm.destructive}
          busy={busy}
          onCancel={() => setConfirm(null)}
          onConfirm={() => {
            const pending = confirm;
            setConfirm(null);
            void pending.run();
          }}
        />
      ) : null}

      {branchPrompt ? (
        <PromptDialog
          title="New branch"
          placeholder="feature/my-branch"
          confirmLabel="Create"
          busy={busy}
          onCancel={() => setBranchPrompt(false)}
          onConfirm={(branch) => {
            setBranchPrompt(false);
            void runAction({ action: "create_branch", branch });
          }}
        />
      ) : null}
    </aside>,
    document.body,
  );
}
