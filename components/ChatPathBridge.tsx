import { useEffect } from "react";
import { useRpc } from "@get-bb/plugin-sdk/app";
import { mountChatPathButtons } from "@/lib/chat-path-buttons";
import type { rpcContract } from "../contract";

/**
 * Drives the chat path scanner, which adds a git-diff button to every file
 * path mentioned in a rendered chat message that exists in this thread's
 * workspace.
 *
 * Mounted inside `GitHeaderAction` (the same slot bb-plugin-file-explorer uses
 * for its `ChatPathBridge`), so it starts when a thread header renders and
 * stops when it unmounts. `threadId` arrives as a prop rather than from the URL
 * — parsing `location` was a guess that failed silently under the desktop app.
 *
 * A new `rpc` identity remounts this effect. The scanner keeps its verdicts in
 * a module cache keyed by `threadId`, so a remount does not re-ask the server
 * about paths it already resolved.
 */
export function ChatPathBridge({ threadId }: { threadId: string }) {
  const rpc = useRpc<typeof rpcContract>();

  useEffect(() => {
    const controller = new AbortController();
    mountChatPathButtons(
      controller.signal,
      threadId,
      async (paths) => {
        const { known } = await rpc.call("resolvePaths", { threadId, paths });
        return new Set(known);
      },
      (message) => {
        void rpc.call("clientLog", { message }).catch(() => undefined);
      },
    );
    return () => {
      controller.abort();
    };
  }, [rpc, threadId]);

  return null;
}
