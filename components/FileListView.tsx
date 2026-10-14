import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { buildGitTree, type GitTreeNode } from "@/lib/git-tree";
import { Icon } from "@/components/ui/icon";
import { FileTypeIcon } from "@/components/ui/file-type-icon";
import type { ViewMode } from "@/components/ChangesList";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";

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

export function FileListView<T extends FileItem>({
  files,
  viewMode,
  onFileClick,
  fileContextMenu,
}: {
  files: T[];
  viewMode: ViewMode;
  onFileClick: (file: string) => void;
  /** Optional right-click menu for each file row; omitted rows render plainly. */
  fileContextMenu?: (file: string) => FileContextMenuEntry[];
}) {
  const handleFileKeyDown = (event: React.KeyboardEvent, file: string) => {
    if (event.key === "Enter") {
      event.preventDefault();
      onFileClick(file);
    }
  };

  if (viewMode === "flat") {
    return (
      <>
        {files.map((item) => (
          <FileRowContextMenu key={item.file} entries={fileContextMenu?.(item.file)}>
            <div
              role="button"
              tabIndex={0}
              className="flex cursor-pointer items-center justify-between gap-2 px-2 py-0.5 text-[11px] transition-colors hover:bg-state-hover"
              onClick={() => onFileClick(item.file)}
              onKeyDown={(event) => handleFileKeyDown(event, item.file)}
              title={item.file}
            >
              <span className="min-w-0 flex-1 truncate">{item.file}</span>
              <span className="shrink-0 font-mono text-[10px] tabular-nums">
                <span className="text-success">+{item.additions ?? 0}</span>{" "}
                <span className="text-destructive">−{item.deletions ?? 0}</span>
              </span>
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
            className="flex cursor-pointer items-center gap-1 py-px pr-1 text-[11px] leading-5 text-left transition-colors hover:bg-state-hover"
            style={indent}
            onClick={() => onFileClick(data.file)}
            onKeyDown={(event) => handleFileKeyDown(event, data.file)}
            title={data.file}
          >
            <FileTypeIcon name={fileName} className="size-3 shrink-0" />
            <span className="min-w-0 truncate">{data.file}</span>
            <span className="shrink-0 font-mono text-[10px] tabular-nums">
              <span className="text-success">+{data.additions ?? 0}</span>{" "}
              <span className="text-destructive">−{data.deletions ?? 0}</span>
            </span>
          </div>
        </FileRowContextMenu>
      );
    });

  return <>{render(tree, 0)}</>;
}
