/**
 * Unified-diff parser — ported verbatim from ompchamber's
 * `shared/lib/fs/diff-parser.ts`: both views and the +/− counts come from the
 * same flush, so a decision cannot land in one view and not the other.
 */

export interface DiffLine {
  type: "add" | "del" | "context" | "meta";
  text: string;
  oldLineNumber?: number;
  newLineNumber?: number;
}

export interface SplitDiffRow {
  left?: { type: "del" | "context"; text: string; lineNumber: number };
  right?: { type: "add" | "context"; text: string; lineNumber: number };
  isMeta?: boolean;
  metaText?: string;
}

/** A buffered `-`/`+` line, before it is decided whether it is a real change. */
interface PendingChange {
  text: string;
  lineNumber: number;
}

export interface ParseDiffOptions {
  /** Fold `-`/`+` pairs that differ only in whitespace back into context. */
  ignoreWhitespace?: boolean;
  /** Which view the caller renders; building only what is shown saves allocations. */
  views?: "unified" | "split" | "both";
}

export function parseUnifiedDiff(rawDiff: string, options: ParseDiffOptions = {}): {
  lines: DiffLine[];
  splitRows: SplitDiffRow[];
  additions: number;
  deletions: number;
} {
  const ignoreWhitespace = options.ignoreWhitespace ?? false;
  const views = options.views ?? "both";
  const wantUnified = views !== "split";
  const wantSplit = views !== "unified";
  const lines: DiffLine[] = [];
  const splitRows: SplitDiffRow[] = [];
  let additions = 0;
  let deletions = 0;

  if (!rawDiff || !rawDiff.trim()) {
    return { lines, splitRows, additions, deletions };
  }

  const rawLines = rawDiff.split(/\r?\n/);
  const hasHunk = rawLines.some((l) => l.startsWith("@@"));
  const linesToProcess = hasHunk
    ? rawLines
    : [`@@ -1,${rawLines.length} +1,${rawLines.length} @@`, ...rawLines];

  let oldCounter = 1;
  let newCounter = 1;

  // Consecutive deletions and additions, paired up in split view.
  let delBuffer: PendingChange[] = [];
  let addBuffer: PendingChange[] = [];

  const flushBuffers = () => {
    const maxLen = Math.max(delBuffer.length, addBuffer.length);
    // A whitespace-only rewrite is decided per pair, but the flat line list
    // keeps unified-diff order (every `-` of the group, then every `+`).
    const folded = new Array<boolean>(maxLen).fill(false);
    if (ignoreWhitespace) {
      for (let i = 0; i < maxLen; i++) {
        const del = delBuffer[i];
        const add = addBuffer[i];
        folded[i] = Boolean(del && add && del.text.trim() === add.text.trim());
      }
    }

    if (wantUnified) {
      for (let i = 0; i < delBuffer.length; i++) {
        const del = delBuffer[i];
        const add = addBuffer[i];
        if (folded[i] && add) {
          // Show it as unchanged on both sides, in the file's current state.
          lines.push({
            type: "context",
            text: add.text,
            oldLineNumber: del.lineNumber,
            newLineNumber: add.lineNumber,
          });
          continue;
        }
        lines.push({ type: "del", text: del.text, oldLineNumber: del.lineNumber });
      }
      for (let i = 0; i < addBuffer.length; i++) {
        const add = addBuffer[i];
        if (folded[i]) continue;
        lines.push({ type: "add", text: add.text, newLineNumber: add.lineNumber });
      }
    }

    if (wantSplit) {
      for (let i = 0; i < maxLen; i++) {
        const del = delBuffer[i];
        const add = addBuffer[i];
        if (folded[i] && del && add) {
          splitRows.push({
            left: { type: "context", text: del.text, lineNumber: del.lineNumber },
            right: { type: "context", text: add.text, lineNumber: add.lineNumber },
          });
          continue;
        }
        splitRows.push({
          left: del ? { type: "del", text: del.text, lineNumber: del.lineNumber } : undefined,
          right: add ? { type: "add", text: add.text, lineNumber: add.lineNumber } : undefined,
        });
      }
    }
    delBuffer = [];
    addBuffer = [];
  };

  for (const rawLine of linesToProcess) {
    if (
      rawLine.startsWith("diff --git") ||
      rawLine.startsWith("index ") ||
      rawLine.startsWith("---") ||
      rawLine.startsWith("+++") ||
      rawLine.startsWith("new file mode") ||
      rawLine.startsWith("deleted file mode") ||
      rawLine.startsWith("similarity index") ||
      rawLine.startsWith("old mode") ||
      rawLine.startsWith("new mode") ||
      rawLine.startsWith("\\ No newline")
    ) {
      continue;
    }

    if (rawLine.startsWith("@@")) {
      flushBuffers();
      const match = rawLine.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      if (match) {
        oldCounter = parseInt(match[1], 10);
        newCounter = parseInt(match[2], 10);
      }
      if (wantUnified) lines.push({ type: "meta", text: rawLine });
      if (wantSplit) splitRows.push({ isMeta: true, metaText: rawLine });
      continue;
    }

    if (rawLine.startsWith("+")) {
      const text = rawLine.slice(1);
      additions++;
      addBuffer.push({ text, lineNumber: newCounter });
      newCounter++;
    } else if (rawLine.startsWith("-")) {
      const text = rawLine.slice(1);
      deletions++;
      delBuffer.push({ text, lineNumber: oldCounter });
      oldCounter++;
    } else {
      flushBuffers();
      const text = rawLine.startsWith(" ") ? rawLine.slice(1) : rawLine;
      if (wantUnified) {
        lines.push({ type: "context", text, oldLineNumber: oldCounter, newLineNumber: newCounter });
      }
      if (wantSplit) {
        splitRows.push({
          left: { type: "context", text, lineNumber: oldCounter },
          right: { type: "context", text, lineNumber: newCounter },
        });
      }
      oldCounter++;
      newCounter++;
    }
  }

  flushBuffers();

  if (ignoreWhitespace) {
    // The counts were tallied before pairs could be folded; re-derive them.
    additions = 0;
    deletions = 0;
    for (const line of lines) {
      if (line.type === "add") additions++;
      else if (line.type === "del") deletions++;
    }
  }

  return { lines, splitRows, additions, deletions };
}
