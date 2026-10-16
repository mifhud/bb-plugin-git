import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@/components/ui/icon";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { getGitStatusInfo } from "@/lib/git-status-display";
import { buildGitTree, type GitTreeNode } from "@/lib/git-tree";
import type { CSSProperties } from "react";
import type { GitChange } from "../shared";

export type ViewMode = "flat" | "tree";

const VIEW_MODE_STORAGE_KEY = "bb-plugin-git:view-mode";

export function readStoredViewMode(): ViewMode {
  try {
    return localStorage.getItem(VIEW_MODE_STORAGE_KEY) === "tree" ? "tree" : "flat";
  } catch {
    return "flat";
  }
}

export function writeStoredViewMode(mode: ViewMode): void {
  try {
    localStorage.setItem(VIEW_MODE_STORAGE_KEY, mode);
  } catch {
    /* private mode */
  }
}

/** The same split ompchamber's panel uses: a `MM` file sits in both lists. */
export function splitChanges(changes: GitChange[]): { staged: GitChange[]; unstaged: GitChange[] } {
  const staged: GitChange[] = [];
  const unstaged: GitChange[] = [];
  for (const change of changes) {
    const status = change.status;
    if (status !== "" && status[0] !== " " && status[0] !== "?") staged.push(change);
    if (status === "??" || (status !== "" && status[1] !== " " && status[1] !== "?")) {
      unstaged.push(change);
    }
  }
  return { staged, unstaged };
}

interface ChangesListProps {
  changes: GitChange[];
  viewMode: ViewMode;
  isBusy: boolean;
  onOpenDiff: (change: GitChange, staged: boolean) => void;
  onStage: (file: string) => void;
  onUnstage: (file: string) => void;
  onDiscard: (file: string) => void;
  onStageAll: () => void;
  onUnstageAll: () => void;
  onDiscardAll: () => void;
  onFileHistory?: (file: string) => void;
}

export function ChangesList(props: ChangesListProps) {
  const { changes, viewMode, isBusy } = props;
  const { staged, unstaged } = useMemo(() => splitChanges(changes), [changes]);
  const rowActions = {
    onStage: props.onStage,
    onUnstage: props.onUnstage,
    onDiscard: props.onDiscard,
  };
  const [stagedOpen, setStagedOpen] = useState(true);
  const [unstagedOpen, setUnstagedOpen] = useState(true);

  if (changes.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-1 p-6 text-center">
        <Icon name="Check" className="size-5 text-muted-foreground" />
        <p className="text-xs text-muted-foreground">Working tree clean.</p>
        <p className="text-[10px] text-muted-foreground">
          Stage changes from the terminal or an agent and they show up here.
        </p>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex shrink-0 items-center justify-between border-b border-sidebar-border px-2 py-1">
        <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          Changes
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto pb-4">
        <Section
          title="Staged Changes"
          count={staged.length}
          open={stagedOpen}
          onToggle={() => setStagedOpen((value) => !value)}
          disabled={isBusy}
          menuItems={[
            {
              label: "Unstage all changes",
              disabled: isBusy || staged.length === 0,
              onClick: props.onUnstageAll,
            },
          ]}
          actions={
            <SectionAction
              title="Unstage all changes"
              glyph="−"
              disabled={isBusy || staged.length === 0}
              onClick={props.onUnstageAll}
            />
          }
        />
        {stagedOpen
          ? viewMode === "tree"
            ? <TreeRows changes={staged} isStaged isBusy={isBusy} {...rowActions} onOpenDiff={props.onOpenDiff} onFileHistory={props.onFileHistory} />
            : staged.map((change) => (
                <FileRow
                  key={`${change.file}:staged`}
                  change={change}
                  isStaged
                  disabled={isBusy}
                  onOpenDiff={props.onOpenDiff}
                  onStage={props.onStage}
                  onUnstage={props.onUnstage}
                  onDiscard={props.onDiscard}
                  onFileHistory={props.onFileHistory}
                />
              ))
          : null}

        <Section
          title="Changes"
          count={unstaged.length}
          open={unstagedOpen}
          onToggle={() => setUnstagedOpen((value) => !value)}
          disabled={isBusy}
          menuItems={[
            {
              label: "Stage all changes",
              disabled: isBusy || unstaged.length === 0,
              onClick: props.onStageAll,
            },
            {
              label: "Discard all unstaged changes",
              destructive: true,
              disabled: isBusy || unstaged.length === 0,
              onClick: props.onDiscardAll,
            },
          ]}
          actions={
            <>
              <SectionAction
                title="Discard all unstaged changes"
                glyph="↺"
                destructive
                disabled={isBusy || unstaged.length === 0}
                onClick={props.onDiscardAll}
              />
              <SectionAction
                title="Stage all changes"
                glyph="+"
                disabled={isBusy || unstaged.length === 0}
                onClick={props.onStageAll}
              />
            </>
          }
        />
        {unstagedOpen
          ? viewMode === "tree"
            ? <TreeRows changes={unstaged} isStaged={false} isBusy={isBusy} {...rowActions} onOpenDiff={props.onOpenDiff} onFileHistory={props.onFileHistory} />
            : unstaged.map((change) => (
                <FileRow
                  key={`${change.file}:unstaged`}
                  change={change}
                  isStaged={false}
                  disabled={isBusy}
                  onOpenDiff={props.onOpenDiff}
                  onStage={props.onStage}
                  onUnstage={props.onUnstage}
                  onDiscard={props.onDiscard}
                  onFileHistory={props.onFileHistory}
                />
              ))
          : null}
      </div>
    </div>
  );
}

interface SectionMenuItem {
  label: string;
  destructive?: boolean;
  disabled: boolean;
  onClick: () => void;
}

/** Section header for "Staged Changes" / "Changes". Left-click toggles the
 *  collapse; right-click opens a context menu of the section's bulk actions
 *  (the same ones the inline buttons offer), so every section action is
 *  reachable both inline and via right-click. When the panel is busy the
 *  menu is suppressed entirely, matching RowContextMenu. */
function Section({
  title,
  count,
  open,
  onToggle,
  menuItems,
  disabled,
  actions,
}: {
  title: string;
  count: number;
  open: boolean;
  onToggle: () => void;
  menuItems?: SectionMenuItem[];
  disabled?: boolean;
  actions?: React.ReactNode;
}) {
  const header = (
    <div
      className="group flex cursor-pointer items-center justify-between px-2 py-1 transition-colors hover:bg-state-hover"
      onClick={onToggle}
      role="button"
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onToggle();
        }
      }}
    >
      <span className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
        <Icon
          name={open ? "ChevronDown" : "ChevronRight"}
          className="size-3 shrink-0 text-muted-foreground"
        />
        {title}
        <span className="rounded-full border border-border px-1.5 text-[9px] font-normal text-muted-foreground">
          {count}
        </span>
      </span>
      <span
        className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100"
        onClick={(event) => event.stopPropagation()}
        role="none"
      >
        {actions}
      </span>
    </div>
  );

  if (disabled || menuItems === undefined || menuItems.length === 0) return header;

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        {header}
      </ContextMenuTrigger>
      <ContextMenuContent className="w-56">
        {menuItems.map((item, index) => (
          <Fragment key={item.label}>
            {index > 0 && <ContextMenuSeparator />}
            <ContextMenuItem
              onSelect={item.onClick}
              disabled={item.disabled}
              className={item.destructive ? "text-destructive focus:text-destructive" : undefined}
            >
              {item.label}
            </ContextMenuItem>
          </Fragment>
        ))}
      </ContextMenuContent>
    </ContextMenu>
  );
}

function SectionAction({
  title,
  glyph,
  destructive = false,
  disabled,
  onClick,
}: {
  title: string;
  glyph: string;
  destructive?: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      disabled={disabled}
      onClick={onClick}
      className={`flex size-5 items-center justify-center rounded text-xs leading-none transition-colors hover:bg-state-active disabled:opacity-40 ${
        destructive ? "text-destructive hover:text-destructive" : "text-muted-foreground hover:text-foreground"
      }`}
    >
      {glyph}
    </button>
  );
}

/** Right-click menu shared by file and folder rows. Only the actions that fit
 *  the row's staged state are offered — never a disabled placeholder — and when
 *  the panel is busy the row renders its plain (non-menu) trigger. */
function RowContextMenu({
  target,
  isStaged,
  disabled,
  onStage,
  onUnstage,
  onDiscard,
  onFileHistory,
  children,
}: {
  target: string;
  isStaged: boolean;
  disabled: boolean;
  onStage: (file: string) => void;
  onUnstage: (file: string) => void;
  onDiscard: (file: string) => void;
  onFileHistory?: (file: string) => void;
  children: React.ReactNode;
}) {
  if (disabled) return <>{children}</>;
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        {children}
      </ContextMenuTrigger>
      <ContextMenuContent className="w-56">
        {!isStaged ? (
          <>
            <ContextMenuItem onSelect={() => onStage(target)}>
              Stage Changes
            </ContextMenuItem>
            <ContextMenuItem
              onSelect={() => onDiscard(target)}
              className="text-destructive focus:text-destructive"
            >
              Discard Changes
            </ContextMenuItem>
          </>
        ) : (
          <ContextMenuItem onSelect={() => onUnstage(target)}>
            Unstage Changes
          </ContextMenuItem>
        )}
        {onFileHistory !== undefined ? (
          <>
            <ContextMenuItem onSelect={() => onFileHistory(target)}>
              File History
            </ContextMenuItem>
          </>
        ) : null}
      </ContextMenuContent>
    </ContextMenu>
  );
}

/** One file row: status letter, name, directory, and its own actions. */
function FileRow({
  change,
  isStaged,
  disabled,
  onOpenDiff,
  onStage,
  onUnstage,
  onDiscard,
  onFileHistory,
  indent,
}: {
  change: GitChange;
  isStaged: boolean;
  disabled: boolean;
  onOpenDiff: (change: GitChange, staged: boolean) => void;
  onStage: (file: string) => void;
  onUnstage: (file: string) => void;
  onDiscard: (file: string) => void;
  onFileHistory?: (file: string) => void;
  /** Tree-mode indent; when provided, uses compact row styling instead of flat. */
  indent?: CSSProperties;
}) {
  const info = getGitStatusInfo(change.status, isStaged);
  const parts = change.file.split("/");
  const fileName = parts.pop() ?? change.file;
  const dirPath = parts.join("/");

  const row = (
    <div
      className={
        indent
          ? "group flex cursor-pointer items-center justify-between gap-1 py-px pr-1 text-[11px] leading-5 text-left transition-colors hover:bg-state-hover"
          : "group flex cursor-pointer items-center justify-between gap-1 px-2 py-0.5 text-[11px] transition-colors hover:bg-state-hover"
      }
      style={indent}
      onClick={() => onOpenDiff(change, isStaged)}
      role="button"
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === "Enter") onOpenDiff(change, isStaged);
      }}
      title={change.file}
    >
      <span className="flex min-w-0 flex-1 items-center gap-1.5">
        <span
          className={`w-3 shrink-0 text-center font-mono text-[9px] font-bold ${info.colorClass}`}
          title={info.label}
        >
          {info.charStatus}
        </span>
        <span className={`truncate ${info.colorClass}`}>{fileName}</span>
        {dirPath !== "" ? (
          <span className="min-w-0 truncate text-[9px] text-muted-foreground">{dirPath}</span>
        ) : null}
      </span>
      <span
        className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100"
        onClick={(event) => event.stopPropagation()}
        role="none"
      >
        {!isStaged ? (
          <>
            <SectionAction
              title="Discard changes"
              glyph="↺"
              destructive
              disabled={disabled}
              onClick={() => onDiscard(change.file)}
            />
            <SectionAction
              title="Stage changes"
              glyph="+"
              disabled={disabled}
              onClick={() => onStage(change.file)}
            />
          </>
        ) : (
          <SectionAction
            title="Unstage changes"
            glyph="−"
            disabled={disabled}
            onClick={() => onUnstage(change.file)}
          />
        )}
      </span>
    </div>
  );

  return (
    <RowContextMenu
      target={change.file}
      isStaged={isStaged}
      disabled={disabled}
      onStage={onStage}
      onUnstage={onUnstage}
      onDiscard={onDiscard}
      onFileHistory={onFileHistory}
    >
      {row}
    </RowContextMenu>
  );
}

/** Tree view: folders collapse rows into a count; files behave as in the list. */
function TreeRows({
  changes,
  isStaged,
  isBusy,
  onOpenDiff,
  onStage,
  onUnstage,
  onDiscard,
  onFileHistory,
}: {
  changes: GitChange[];
  isStaged: boolean;
  isBusy: boolean;
  onOpenDiff: (change: GitChange, staged: boolean) => void;
  onStage: (file: string) => void;
  onUnstage: (file: string) => void;
  onDiscard: (file: string) => void;
  onFileHistory?: (file: string) => void;
}) {
  const tree = useMemo(() => buildGitTree(changes), [changes]);

  const allFolderIds = useMemo(() => {
    const ids = new Set<string>();
    const walk = (nodes: GitTreeNode<GitChange>[]): void => {
      for (const node of nodes) {
        if (node.type === "folder") {
          ids.add(node.id);
          walk(node.children);
        }
      }
    };
    walk(tree);
    return ids;
  }, [tree]);

  const [expanded, setExpanded] = useState<Set<string> | null>(null);
  const knownFoldersRef = useRef<Set<string> | null>(null);

  // First pass opens everything; folders that appear later (a refresh grew
  // the tree) also start open, but a folder the user closed stays closed.
  useEffect(() => {
    setExpanded((previous) => {
      if (previous === null) return new Set(allFolderIds);
      const next = new Set(previous);
      const known = knownFoldersRef.current ?? new Set<string>();
      for (const id of allFolderIds) if (!known.has(id)) next.add(id);
      return next;
    });
    knownFoldersRef.current = new Set(allFolderIds);
  }, [allFolderIds]);

  const effective = expanded ?? allFolderIds;
  const toggle = (id: string): void => {
    setExpanded((previous) => {
      const next = new Set(previous ?? allFolderIds);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const render = (nodes: GitTreeNode<GitChange>[], depth: number): React.ReactNode =>
    nodes.map((node) => {
      const indent = { paddingLeft: `${4 + depth * 10}px` };
      if (node.type === "folder") {
        const isOpen = effective.has(node.id);
        return (
          <div key={node.id}>
            <RowContextMenu
              target={node.path}
              isStaged={isStaged}
              disabled={isBusy}
              onStage={onStage}
              onUnstage={onUnstage}
              onDiscard={onDiscard}
            >
              <div
                className="group flex cursor-pointer items-center justify-between gap-1 py-px pr-1 text-[11px] leading-5 text-left transition-colors hover:bg-state-hover"
                style={indent}
                onClick={() => toggle(node.id)}
                role="button"
                tabIndex={0}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    toggle(node.id);
                  }
                }}
                title={node.path}
              >
                <span className="flex min-w-0 flex-1 items-center gap-1">
                  <span className="flex size-3 shrink-0 items-center justify-center text-muted-foreground">
                    <Icon name={isOpen ? "ChevronDown" : "ChevronRight"} className="size-2.5" />
                  </span>
                  <Icon name={isOpen ? "FolderOpen" : "Folder"} className="size-3.5 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 truncate font-medium text-foreground">{node.name}</span>
                  <span className="rounded-full border border-border px-1 text-[9px] text-muted-foreground">
                    {node.changeCount}
                  </span>
                </span>
                <span
                  className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100"
                  onClick={(event) => event.stopPropagation()}
                  role="none"
                >
                  {!isStaged ? (
                    <>
                      <SectionAction
                        title="Discard folder changes"
                        glyph="↺"
                        destructive
                        disabled={isBusy}
                        onClick={() => onDiscard(node.path)}
                      />
                      <SectionAction
                        title="Stage folder changes"
                        glyph="+"
                        disabled={isBusy}
                        onClick={() => onStage(node.path)}
                      />
                    </>
                  ) : (
                    <SectionAction
                      title="Unstage folder changes"
                      glyph="−"
                      disabled={isBusy}
                      onClick={() => onUnstage(node.path)}
                    />
                  )}
                </span>
              </div>
            </RowContextMenu>
            {isOpen ? render(node.children, depth + 1) : null}
          </div>
        );
      }
      if (node.data === undefined) return null;
      return (
        <FileRow
          change={node.data}
          isStaged={isStaged}
          disabled={isBusy}
          onOpenDiff={onOpenDiff}
          onStage={onStage}
          onUnstage={onUnstage}
          onDiscard={onDiscard}
          onFileHistory={onFileHistory}
          indent={indent}
        />
      );
    });

  return <>{render(tree, 0)}</>;
}
