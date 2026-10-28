/**
 * One-slot hand-off between the chat content script (which knows the path
 * string) and the mounted Git rail (which owns the pinned root and repo).
 *
 * The request is kept pending until a subscriber takes it: clicking a path
 * usually *opens* the rail, so the rail mounts after the request is made.
 *
 * Mirrors bb-plugin-file-explorer's reveal-bus.
 */
export interface GitDiffRequest {
  file: string;
  threadId: string;
}
type GitDiffListener = (request: GitDiffRequest) => void;

const listeners = new Set<GitDiffListener>();
let pending: GitDiffRequest | null = null;

export function requestGitDiffFile(file: string, threadId: string): void {
  const path = file.trim();
  if (path === "") return;
  const request = { file: path, threadId };
  if (listeners.size === 0) {
    pending = request;
    return;
  }
  pending = null;
  for (const listener of Array.from(listeners)) listener(request);
}

export function subscribeGitDiff(listener: GitDiffListener): () => void {
  listeners.add(listener);
  if (pending !== null) {
    const request = pending;
    pending = null;
    listener(request);
  }
  return () => {
    listeners.delete(listener);
  };
}
