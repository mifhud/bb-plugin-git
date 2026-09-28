/**
 * Flat change list → folder tree — ported from ompchamber's
 * `client/hooks/workspace/git-tree.ts` (the pure builder only; expansion
 * state lives in the component that renders it).
 */

import type { GitChange } from "../contract";

export interface GitTreeNode {
  id: string;
  name: string;
  path: string;
  type: "folder" | "file";
  change?: GitChange;
  children: GitTreeNode[];
  changeCount: number;
}

export function buildGitTree(changes: GitChange[]): GitTreeNode[] {
  const root: GitTreeNode = {
    id: "",
    name: "",
    path: "",
    type: "folder",
    children: [],
    changeCount: 0,
  };

  for (const change of changes) {
    const cleanPath = change.file.replace(/^[./]+/, "");
    const isExplicitDir = cleanPath.endsWith("/");
    const parts = cleanPath.replace(/\/$/, "").split("/").filter(Boolean);

    let current = root;
    let accumulatedPath = "";

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      accumulatedPath = accumulatedPath ? `${accumulatedPath}/${part}` : part;
      const isLast = i === parts.length - 1;
      const isFile = isLast && !isExplicitDir;

      if (isFile) {
        current.children.push({
          id: accumulatedPath,
          name: part,
          path: accumulatedPath,
          type: "file",
          change,
          children: [],
          changeCount: 1,
        });
      } else {
        let folder = current.children.find((c) => c.type === "folder" && c.name === part);
        if (folder === undefined) {
          folder = {
            id: accumulatedPath,
            name: part,
            path: accumulatedPath,
            type: "folder",
            children: [],
            changeCount: 0,
            change: isLast && isExplicitDir ? change : undefined,
          };
          current.children.push(folder);
        }
        current = folder;
      }
    }
  }

  function calculateAndSort(node: GitTreeNode): number {
    if (node.type === "file") return 1;

    let total = node.change !== undefined ? 1 : 0;
    for (const child of node.children) {
      total += calculateAndSort(child);
    }
    node.changeCount = total;

    node.children.sort((a, b) => {
      if (a.type === "folder" && b.type === "file") return -1;
      if (a.type === "file" && b.type === "folder") return 1;
      return a.name.localeCompare(b.name);
    });

    return total;
  }

  calculateAndSort(root);
  return root.children;
}
