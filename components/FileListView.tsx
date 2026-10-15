import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { Icon, type IconName } from "@/components/ui/icon";
import { FileTypeIcon } from "@/components/ui/file-type-icon";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { buildGitTree, type GitTreeNode } from "@/lib/git-tree";
import type { ViewMode } from "@/components/ChangesList";

/** Minimal shape any file row needs: a path and optional line counts. */
export interface FileItem {
  file: string;
  additions?: number;
  deletions?: number;
}

/** One right-click context-menu entry offered on a file row. */
export interface FileContextMenuEntry {
  label: string;
  onSelect: () => void;
  destructive?: boolean;
}

/** A single hover-triggered action offered on a file row (e.g. applying a
 *  stashed file). Returns undefined for files that have no action, so the
 *  row renders its plain (non-action) trigger. */
export interface FileAction {
  icon: IconName;
  title: string;
  onClick: () => void;
  destructive?: boolean;
}

/** Wraps a single file row in a right-click menu when `entries` are supplied;
 *  otherwise renders the row untouched. Shared by the flat and tree views so the
 *  menu behaves identically wherever a file row appears. */
function FileRowContextMenu({
  entries,
  children,
}: {
  entries: FileContextMenuEntry[] | undefined;
  children: React.ReactNode;
}) {
  if (entries === undefined || entries.length === 0) return <>{children}</>;
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent className="w-56">
        {entries.map((entry, index) => (
          <Fragment key={entry.label}>
            {index > 0 && <ContextMenuSeparator />}
            <ContextMenuItem
              onSelect={entry.onSelect}
              className={entry.destructive ? "text-destructive focus:text-destructive" : undefined}
            >
              {entry.label}
            </ContextMenuItem>
          </Fragment>
        ))}
      </ContextMenuContent>
    </ContextMenu>
  );
}

function FileActionIcon({ action, disabled }: { action: FileAction; disabled: boolean }) {
  return (
    <button
      type="button"
      title={action.title}
      aria-label={action.title}
      disabled={disabled}
      onClick={(event) => {
        event.stopPropagation();
        action.onClick();
      }}
      className={`flex size-5 items-center justify-center rounded text-xs leading-none transition-colors hover:bg-state-active disabled:opacity-40 ${
        action.destructive
          ? "text-destructive hover:text-destructive"
          : "text-muted-foreground hover:text-foreground"
      }`}
    >
      <Icon name={action.icon} className="size-3" />
    </button>
  );
}

export function FileListView<T extends FileItem>({
  files,
  viewMode,
  onFileClick,
  fileContextMenu,
  fileAction,
  disabled,
}: {
  files: T[];
  viewMode: ViewMode;
  onFileClick: (file: string) => void;
  /** Optional right-click menu for each file row; omitted rows render plainly. */
  fileContextMenu?: (file: string) => FileContextMenuEntry[];
  /** Optional single hover icon per file row (e.g. stash-apply); omitted rows render plainly. */
  fileAction?: (file: string) => FileAction | undefined;
  /** When true, hover action buttons render disabled (panel is busy). */
  disabled?: boolean;
}) {
  const handleFileKeyDown = (event: React.KeyboardEvent, file: string) => {
    if (event.key === "Enter") {
      event.preventDefault();
      onFileClick(file);
    }
  };

  const renderAction = (file: string): React.ReactNode => {
    const action = fileAction?.(file);
    if (action === undefined) return null;
    return (
      <span
        className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100"
        onClick={(event) => event.stopPropagation()}
        role="none"
      >
        <FileActionIcon action={action} disabled={disabled ?? false} />
      </span>
    );
  };

  if (viewMode === "flat") {
    return (
      <>
        {files.map((item) => (
          <FileRowContextMenu key={item.file} entries={fileContextMenu?.(item.file)}>
            <div
              role="button"
              tabIndex={0}
              className="group flex cursor-pointer items-center justify-between gap-2 px-2 py-0.5 text-[11px] transition-colors hover:bg-state-hover"
              onClick={() => onFileClick(item.file)}
              onKeyDown={(event) => handleFileKeyDown(event, item.file)}
              title={item.file}
            >
              <span className="min-w-0 flex-1 truncate">{item.file}</span>
              <span className="shrink-0 font-mono text-[10px] tabular-nums">
                <span className="text-success">+{item.additions ?? 0}</span>{" "}
                <span className="text-destructive">−{item.deletions ?? 0}</span>
              </span>
              {renderAction(item.file)}
            </div>
          </FileRowContextMenu>
        ))}
      </>
    );
  }

  /* ---- Tree view ---- */
  const tree = useMemo(() => buildGitTree(files), [files]);

  // Collect every folder ID so the tree starts fully expanded. New folders
  // that appear after a refresh are also auto-expanded; folders the user
  // collapsed stay collapsed (mirrors ChangesList's TreeRows behaviour).
  const allFolderIds = useMemo(() => {
    const ids = new Set<string>();
    const walk = (nodes: GitTreeNode<T>[]): void => {
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

  const knownFoldersRef = useRef<Set<string> | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(allFolderIds));

  useEffect(() => {
    setExpanded((previous) => {
      const next = new Set(previous);
      const known = knownFoldersRef.current ?? new Set<string>();
      for (const id of allFolderIds) if (!known.has(id)) next.add(id);
      return next;
    });
    knownFoldersRef.current = new Set(allFolderIds);
  }, [allFolderIds]);

  const toggle = (id: string): void => {
    setExpanded((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const render = (nodes: GitTreeNode<T>[], depth: number): React.ReactNode =>
    nodes.map((node) => {
      const indent = { paddingLeft: `${4 + depth * 10}px` };
      if (node.type === "folder") {
        const isOpen = expanded.has(node.id);
        return (
          <div key={node.id}>
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
              title={node.name}
            >
              <span className="flex min-w-0 flex-1 items-center gap-1">
                <span className="flex size-3 shrink-0 items-center justify-center text-muted-foreground">
                  <Icon name={isOpen ? "ChevronDown" : "ChevronRight"} className="size-2.5" />
                </span>
                <Icon
                  name={isOpen ? "FolderOpen" : "Folder"}
                  className="size-3.5 shrink-0 text-muted-foreground"
                />
                <span className="min-w-0 truncate">{node.name}</span>
              </span>
              <span className="rounded-full border border-border px-1 text-[9px] text-muted-foreground">
                {node.changeCount}
              </span>
            </div>
            {isOpen ? render(node.children, depth + 1) : null}
          </div>
        );
      }
      if (node.data === undefined) return null;
      const data = node.data;
      const fileName = data.file.split("/").pop() ?? data.file;
      return (
        <FileRowContextMenu key={data.file} entries={fileContextMenu?.(data.file)}>
          <div
            role="button"
            tabIndex={0}
            className="group flex cursor-pointer items-center justify-between gap-1 py-px pr-1 text-[11px] leading-5 text-left transition-colors hover:bg-state-hover"
            style={indent}
            onClick={() => onFileClick(data.file)}
            onKeyDown={(event) => handleFileKeyDown(event, data.file)}
            title={data.file}
          >
            <span className="min-w-0 flex-1 truncate">
              <FileTypeIcon name={fileName} className="size-3 shrink-0" />
              {data.file}
            </span>
            <span className="shrink-0 font-mono text-[10px] tabular-nums">
              <span className="text-success">+{data.additions ?? 0}</span>{" "}
              <span className="text-destructive">−{data.deletions ?? 0}</span>
            </span>
            {renderAction(data.file)}
          </div>
        </FileRowContextMenu>
      );
    });

  return <>{render(tree, 0)}</>;
}
