import type { JsonValue, useBbNavigate } from "@get-bb/plugin-sdk/app";
import type { DiffTarget } from "@/components/DiffView";

/**
 * Opens a diff as a tab in BB's built-in side panel instead of the rail's
 * own drawer. Registered in `app.tsx` as both a `threadPanelAction` (existing
 * thread surfaces) and an `experimental_newThreadPanelAction` (the New Thread
 * compose screen, where thread-only slots are not rendered). The id is shared
 * by both registrations and every opener.
 */
export const GIT_DIFF_ACTION_ID = "git-diff";

/**
 * What a diff tab carries. `rootKey` is the pinned `RootChoice.id` (a stable
 * `thread:<id>` / `source:<id>` string), never the server's `rootId` — a
 * rootId is an opaque per-process UUID, and these params are persisted and
 * restored across reloads, when the old rootId no longer resolves.
 */
export interface GitDiffPanelParams {
  rootKey: string;
  repo: string;
  target: DiffTarget;
}

type Navigate = ReturnType<typeof useBbNavigate>;

export function diffTabTitle(target: DiffTarget): string {
  const name = target.file.split("/").pop() ?? target.file;
  const base = name === "" ? target.file : name;
  switch (target.kind) {
    case "working":
      return target.staged ? `${base} (staged)` : `${base} (unstaged)`;
    case "commit":
      return `${base} (${target.hash.slice(0, 8)})`;
    case "stash":
      return `${base} (${target.stash})`;
  }
}

/**
 * Ask BB to open the diff as a side-panel tab. Returns false when the surface
 * has no side panel (or the action is unavailable), so the caller keeps the
 * rail's own drawer as a fallback. A decline is never thrown.
 */
export function openDiffInPanel(
  navigate: Navigate,
  params: GitDiffPanelParams,
  title: string = diffTabTitle(params.target),
): boolean {
  return navigate.openThreadPanel({
    actionId: GIT_DIFF_ACTION_ID,
    title,
    params: params as unknown as JsonValue,
  });
}
