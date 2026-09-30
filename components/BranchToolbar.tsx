import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import type { GitSyncCount } from "../contract";
import type { ViewMode } from "@/components/ChangesList";

/**
 * Branch selector + sync controls — ported from ompchamber's
 * `BranchToolbar`: the dropdown lists local branches, then remotes (checking
 * out a remote creates the tracking local branch), then "New branch…"; the
 * Sync button shows ↑ahead ↓behind and pulls-then-pushes.
 */
export function BranchToolbar({
  branch,
  branches,
  remoteBranches,
  syncCount,
  isBusy,
  onCheckout,
  onCreateBranch,
  onSync,
  onPull,
  onPush,
  onRefresh,
  viewMode,
  onViewModeChange,
}: {
  branch: string;
  branches: string[];
  remoteBranches: string[];
  syncCount?: GitSyncCount;
  isBusy: boolean;
  onCheckout: (branch: string) => void;
  onCreateBranch: () => void;
  onSync: () => void;
  onPull: () => void;
  onPush: () => void;
  onRefresh: () => void;
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const count = syncCount ?? { ahead: 0, behind: 0 };

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (rootRef.current !== null && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open]);

  useEffect(() => {
    if (!menuOpen) return;
    const onPointerDown = (event: MouseEvent) => {
      if (menuRef.current !== null && !menuRef.current.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    };
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [menuOpen]);

  const syncTitle =
    count.ahead > 0 && count.behind > 0
      ? `Pull ${count.behind} then push ${count.ahead} commit(s)`
      : count.ahead > 0
        ? `Push ${count.ahead} commit(s)`
        : count.behind > 0
          ? `Pull ${count.behind} commit(s)`
          : "Up to date — sync anyway";

  const pick = (next: string) => {
    setOpen(false);
    if (next !== branch) onCheckout(next);
  };

  return (
    <div className="flex items-center justify-between gap-1 border-b border-sidebar-border px-2 py-1.5">
      <div className="relative min-w-0" ref={rootRef}>
        <button
          type="button"
          disabled={isBusy}
          aria-haspopup="menu"
          aria-expanded={open}
          title="Current branch — click to switch"
          onClick={() => setOpen((value) => !value)}
          className="flex max-w-full items-center gap-1.5 rounded px-1.5 py-1 text-[11px] font-medium text-foreground transition-colors hover:bg-state-hover disabled:opacity-50"
        >
          <Icon name="GitBranch" className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="truncate">{branch}</span>
          <Icon name="ChevronDown" className="size-3 shrink-0 text-muted-foreground" />
        </button>

        {open ? (
          <div
            role="menu"
            className="absolute left-0 top-full z-50 mt-1 max-h-64 w-56 overflow-y-auto rounded-md border border-border bg-popover py-1 text-xs text-popover-foreground shadow-lg"
          >
            {branches.length > 0 ? (
              <>
                <div className="px-3 py-1 text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Local
                </div>
                {branches.map((name) => (
                  <button
                    key={name}
                    type="button"
                    role="menuitem"
                    onClick={() => pick(name)}
                    className="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left transition-none hover:bg-state-hover"
                  >
                    <span className="truncate">{name}</span>
                    {name === branch ? <Icon name="Check" className="size-3 shrink-0" /> : null}
                  </button>
                ))}
              </>
            ) : null}
            {remoteBranches.length > 0 ? (
              <>
                <div className="mt-1 border-t border-border px-3 py-1 text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Remote
                </div>
                {remoteBranches.map((name) => (
                  <button
                    key={name}
                    type="button"
                    role="menuitem"
                    onClick={() => pick(name)}
                    className="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left transition-none hover:bg-state-hover"
                  >
                    <span className="truncate">{name}</span>
                    {name === branch ? <Icon name="Check" className="size-3 shrink-0" /> : null}
                  </button>
                ))}
              </>
            ) : null}
            <div className="my-1 border-t border-border" />
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                onCreateBranch();
              }}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left italic text-foreground transition-none hover:bg-state-hover"
            >
              <Icon name="Plus" className="size-3" />
              <span>New branch…</span>
            </button>
          </div>
        ) : null}
      </div>
      <div className="relative flex shrink-0 items-center gap-1 text-muted-foreground">
        <Button
          type="button"
          variant="ghost"
          className="h-7 px-2"
          disabled={isBusy}
          aria-label={syncTitle}
          onClick={onSync}
        >
          <Icon name="ArrowReloadHorizontal" className="size-3.5" />
          <span className="ml-1 font-mono text-[10px] tabular-nums">
            ↑{count.ahead} ↓{count.behind}
          </span>
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-7"
          disabled={isBusy}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          aria-label="More actions"
          onClick={() => setMenuOpen((value) => !value)}
        >
          <Icon name="MoreHorizontal" className="size-3.5" />
        </Button>
        {menuOpen ? (
          <div
            ref={menuRef}
            role="menu"
            className="absolute right-0 top-full z-50 mt-1 w-44 rounded-md border border-border bg-popover py-1 text-xs text-popover-foreground shadow-lg"
          >
            <button
              type="button"
              role="menuitem"
              disabled={isBusy}
              onClick={() => {
                setMenuOpen(false);
                onViewModeChange(viewMode === "flat" ? "tree" : "flat");
              }}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left transition-none hover:bg-state-hover disabled:opacity-50"
            >
              {viewMode === "flat" ? "View as Tree" : "View as List"}
            </button>
            <button
              type="button"
              role="menuitem"
              disabled={isBusy}
              onClick={() => {
                setMenuOpen(false);
                onPull();
              }}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left transition-none hover:bg-state-hover disabled:opacity-50"
            >
              Pull
            </button>
            <button
              type="button"
              role="menuitem"
              disabled={isBusy}
              onClick={() => {
                setMenuOpen(false);
                onPush();
              }}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left transition-none hover:bg-state-hover disabled:opacity-50"
            >
              Push
            </button>
            <button
              type="button"
              role="menuitem"
              disabled={isBusy}
              onClick={() => {
                setMenuOpen(false);
                onRefresh();
              }}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left transition-none hover:bg-state-hover disabled:opacity-50"
            >
              Reload
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
