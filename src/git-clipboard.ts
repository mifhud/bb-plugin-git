import { spawn } from "node:child_process";

/**
 * Put a plain-text string on the system clipboard. Done server-side
 * (xclip / xsel / pbcopy / clip / clip.exe) because the browser's
 * `navigator.clipboard` is blocked when BB runs from WSL. Mirrors
 * bb-plugin-file-tree's copyTextToClipboard so the commit-hash / stash-ref
 * copy buttons work there too.
 */
export type ClipboardResult = { ok: true } | { ok: false; message: string };

export async function copyTextToClipboard(text: string): Promise<ClipboardResult> {
  if (process.platform === "darwin") {
    return trySpawnClipboard("pbcopy", [], text);
  }
  if (process.platform === "win32") {
    return trySpawnClipboard("clip", [], text);
  }
  const linuxCommands: Array<[string, string[]]> = [
    ["xclip", ["-selection", "clipboard"]],
    ["xsel", ["--clipboard", "--input"]],
    ["clip.exe", []],
    ["/mnt/c/Windows/System32/clip.exe", []],
  ];
  for (const [command, args] of linuxCommands) {
    const result = await trySpawnClipboard(command, args, text);
    if (result.ok) return result;
  }
  return {
    ok: false,
    message: "Could not copy to the clipboard. Install xclip or run in a graphical environment.",
  };
}

/** Pipe `text` into a clipboard command's stdin; resolve once it exits. */
function trySpawnClipboard(command: string, args: string[], text: string): Promise<ClipboardResult> {
  const { promise, resolve } = Promise.withResolvers<ClipboardResult>();
  const proc = spawn(command, args);
  proc.on("error", (err) => {
    resolve({ ok: false, message: err instanceof Error ? err.message : "Could not copy to the clipboard." });
  });
  proc.on("close", (code) => {
    if (code === 0) resolve({ ok: true });
    else resolve({ ok: false, message: `Process exited with code ${code ?? "unknown"}` });
  });
  // stdin is non-null for a successfully-spawned child; guard the spawn-fail case.
  if (proc.stdin) {
    proc.stdin.write(text);
    proc.stdin.end();
  }
  return promise;
}
