import type { useBbNavigate } from "@get-bb/plugin-sdk/app";

/**
 * The Git rail lives in BB's app-wide window overlay, which has no side panel
 * of its own — opening a diff tab must go through the route surface that does,
 * exactly like bb-plugin-file-explorer's file previews. `GitHeaderAction`, a
 * thread-scoped component, registers its navigator here; the rail looks it up
 * by threadId. A split layout mounts one header per pane, each with its own
 * threadId, so the map is keyed by thread.
 */
type Navigate = ReturnType<typeof useBbNavigate>;

const navigators = new Map<string, Navigate>();

export function registerDiffNavigation(threadId: string, navigate: Navigate): () => void {
  navigators.set(threadId, navigate);
  return () => {
    if (navigators.get(threadId) === navigate) navigators.delete(threadId);
  };
}

export function diffNavigation(threadId: string | null): Navigate | null {
  return threadId === null ? null : (navigators.get(threadId) ?? null);
}
