/**
 * Flat change list → folder tree — ported from ompchamber's
 * `client/hooks/workspace/git-tree.ts` (the pure builder only; expansion
 * state lives in the component that renders it).
 *
 * Generic over `T extends { file: string }` so the same builder powers the
 * Changes tree (GitChange[]) and the History/Stash file lists
 * (GitCommitFile[] / GitStashFile[]).
 */

export interface GitTreeNode<T = unknown> {
  id: string;
  name: string;
  path: string;
  type: "folder" | "file";
  data?: T;
  children: GitTreeNode<T>[];
  changeCount: number;
}

export function buildGitTree<T extends { file: string }>(items: T[]): GitTreeNode<T>[] {
  const root: GitTreeNode<T> = {
    id: "",
    name: "",
    path: "",
    type: "folder",
    children: [],
    changeCount: 0,
  };

  for (const item of items) {
    const cleanPath = item.file.replace(/^\.\//, "");
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
          data: item,
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
            data: isLast && isExplicitDir ? item : undefined,
          };
          current.children.push(folder);
        }
        current = folder;
      }
    }
  }

  function calculateAndSort(node: GitTreeNode<T>): number {
    if (node.type === "file") return 1;

    let total = node.data !== undefined ? 1 : 0;
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
