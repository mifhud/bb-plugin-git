/**
 * Status display info and folder rollups — ported from ompchamber's
 * `shared/lib/fs/git-status.ts`, with ompchamber's `text-info`/`bg-success`
 * design tokens swapped for BB's own class vocabulary (the plugin rides on
 * the host stylesheet, which knows `text-primary`/`text-destructive`/… but
 * not another app's custom colors).
 */

import type { GitChange } from "../shared";

export interface GitStatusInfo {
  charStatus: string;
  label: string;
  /** Tailwind classes for the status letter and file name. */
  colorClass: string;
  isStaged: boolean;
}

export interface FolderGitStatusInfo {
  count: number;
  hasModified: boolean;
  hasUntracked: boolean;
  hasStaged: boolean;
  hasDeleted: boolean;
  colorClass: string;
}

const MODIFIED_CLASSES = "text-primary";
const UNTRACKED_CLASSES = "text-success";
const DELETED_CLASSES = "text-destructive";
const RENAMED_CLASSES = "text-warning";

/** Display info for a single git status code (XY porcelain, or one side of it). */
export function getGitStatusInfo(status: string, isStaged: boolean = false): GitStatusInfo {
  const raw = (status || "").trim();
  const normalized = raw.toUpperCase();

  let charStatus = "M";
  let label = "Modified";
  let colorClass = MODIFIED_CLASSES;

  const pick = (code: string, staged: boolean): void => {
    if (code === "A") {
      charStatus = "A";
      label = staged ? "Added (Staged)" : "Added";
      colorClass = UNTRACKED_CLASSES;
    } else if (code === "D") {
      charStatus = "D";
      label = staged ? "Deleted (Staged)" : "Deleted";
      colorClass = DELETED_CLASSES;
    } else if (code === "R") {
      charStatus = "R";
      label = staged ? "Renamed (Staged)" : "Renamed";
      colorClass = RENAMED_CLASSES;
    } else if (code === "U" || code === "?") {
      charStatus = "U";
      label = "Untracked";
      colorClass = UNTRACKED_CLASSES;
    } else {
      charStatus = "M";
      label = staged ? "Modified (Staged)" : "Modified";
      colorClass = MODIFIED_CLASSES;
    }
  };

  if (isStaged) {
    pick(normalized[0] || "M", true);
  } else {
    if (normalized === "??" || normalized === "?" || normalized === "U" || normalized === "UNTRACKED") {
      pick("?", false);
    } else {
      pick(normalized[1] || normalized[0] || "M", false);
    }
  }

  return { charStatus, label, colorClass, isStaged };
}

/**
 * Builds lookup maps for files and their ancestor folders, so a collapsed
 * folder can still show that something inside it changed.
 */
export function buildGitStatusMaps(changes: GitChange[]): {
  fileMap: Map<string, GitChange>;
  folderMap: Map<string, FolderGitStatusInfo>;
} {
  const fileMap = new Map<string, GitChange>();
  const folderMap = new Map<string, FolderGitStatusInfo>();

  if (!Array.isArray(changes)) return { fileMap, folderMap };

  for (const change of changes) {
    if (!change || !change.file) continue;
    const normalizedFile = change.file.replace(/^\/+/, "");
    fileMap.set(normalizedFile, change);

    const segments = normalizedFile.split("/");
    segments.pop(); // the file itself

    let currentPath = "";
    for (const segment of segments) {
      currentPath = currentPath ? `${currentPath}/${segment}` : segment;
      const existing = folderMap.get(currentPath) ?? {
        count: 0,
        hasModified: false,
        hasUntracked: false,
        hasStaged: false,
        hasDeleted: false,
        colorClass: MODIFIED_CLASSES,
      };

      existing.count += 1;
      const isStaged =
        change.staged || (change.status !== "" && change.status[0] !== " " && change.status[0] !== "?");
      if (isStaged) existing.hasStaged = true;

      if (change.status === "??") existing.hasUntracked = true;
      else if (change.status?.includes("D")) existing.hasDeleted = true;
      else existing.hasModified = true;

      // Folder indicator priority: staged/modified > untracked > deleted.
      if (existing.hasModified || existing.hasStaged) existing.colorClass = MODIFIED_CLASSES;
      else if (existing.hasUntracked) existing.colorClass = UNTRACKED_CLASSES;
      else if (existing.hasDeleted) existing.colorClass = DELETED_CLASSES;

      folderMap.set(currentPath, existing);
    }
  }

  return { fileMap, folderMap };
}
