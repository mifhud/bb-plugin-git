import { useEffect, useState } from "react";
import { useRpc } from "@get-bb/plugin-sdk/app";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { parseUnifiedDiff, type DiffLine, type SplitDiffRow } from "@/lib/diff-parser";
import { cn } from "@/lib/utils";
import { fileDiffSchema, type FileDiffData, type rpcContract } from "../contract";

/**
 * Diff viewer for one file — working tree, index, or a file inside a commit.
 * Unified and Split are two renderings of the same `parseUnifiedDiff` flush
 * (ported from ompchamber's diff panel), so a row cannot disagree with its
 * twin. The rail is narrow, so the header is one compact toolbar and the code
 * scrolls beneath it.
 */

export type DiffTarget =
  | { kind: "working"; file: string; staged: boolean; status?: string }
  | { kind: "commit"; hash: string; file: string }
  | { kind: "stash"; stash: string; file: string };

/** Inline tints: guaranteed to paint regardless of the host stylesheet. */
const ADD_STYLE = { backgroundColor: "rgba(16, 185, 129, 0.13)" };
const DEL_STYLE = { backgroundColor: "rgba(239, 68, 68, 0.13)" };

/** Beyond this many rendered lines the viewer stops and says so. */
const MAX_RENDERED_LINES = 5000;

export function DiffView({
  rootId,
  repo,
  target,
  onBack,
}: {
  rootId: string;
  repo: string;
  target: DiffTarget;
  onBack: () => void;
}) {
  const rpc = useRpc<typeof rpcContract>();
  const [diff, setDiff] = useState<string>("");
  const [meta, setMeta] = useState<{ additions: number; deletions: number; status?: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [split, setSplit] = useState(false);
  const [ignoreWhitespace, setIgnoreWhitespace] = useState(false);
  const [fullContext, setFullContext] = useState(false);

  const file = target.file;
  // Primitive key: a fresh `target` object arrives every render of the rail,
  // so the effect must depend on WHAT it points at, not on the object.
  const targetKey =
    target.kind === "working"
      ? `working:${target.file}:${target.staged}:${target.status ?? ""}`
      : target.kind === "stash"
        ? `stash:${target.stash}:${target.file}`
        : `commit:${target.hash}:${target.file}`;
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const load = async (): Promise<void> => {
      try {
        if (target.kind === "working") {
          const result = await rpc.call("fileDiff", {
            rootId,
            repo,
            file: target.file,
            staged: target.staged,
            ...(target.status !== undefined ? { status: target.status } : {}),
            fullContext,
          });
          if (cancelled) return;
          const parsed = fileDiffSchema.safeParse(result);
          if (!parsed.success) throw new Error("Unexpected diff payload.");
          setDiff(parsed.data.diff);
          setMeta({
            additions: parsed.data.additions ?? 0,
            deletions: parsed.data.deletions ?? 0,
            status: parsed.data.status,
          });
        } else if (target.kind === "stash") {
          const result = await rpc.call("stashFileDiff", { rootId, repo, stash: target.stash, file: target.file });
          if (cancelled) return;
          if (!result.ok) throw new Error(result.error);
          setDiff(result.diff);
          setMeta(null);
        } else {
          const result = await rpc.call("commitDiff", { rootId, repo, hash: target.hash, file: target.file });
          if (cancelled) return;
          if (!result.ok) throw new Error(result.error);
          setDiff(result.diff);
          setMeta(null);
        }
      } catch (cause) {
        if (cancelled) return;
        setError(cause instanceof Error ? cause.message : String(cause));
        setDiff("");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
    // `targetKey` names every field of `target`, so re-running on it alone is
    // exactly re-running when the target changes. fullContext stays too:
    // re-fetching on its toggle is the point.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rpc, rootId, repo, targetKey, fullContext]);

  const parsed = parseUnifiedDiff(diff, {
    ignoreWhitespace,
    views: split ? "split" : "unified",
  });
  const additions = meta?.additions ?? parsed.additions;
  const deletions = meta?.deletions ?? parsed.deletions;
  const truncated = split
    ? parsed.splitRows.length > MAX_RENDERED_LINES
    : parsed.lines.length > MAX_RENDERED_LINES;

  const toggleClass = (active: boolean): string =>
    cn(
      "rounded px-1.5 py-0.5 text-[10px] transition-colors",
      active ? "bg-state-active text-foreground" : "text-muted-foreground hover:bg-state-hover",
    );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-1 border-b border-sidebar-border px-1.5 py-1">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-6 shrink-0"
          aria-label="Back"
          onClick={onBack}
        >
          <Icon name="ChevronLeft" className="size-4" />
        </Button>
        <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-foreground" title={file}>
          {file}
        </span>
        <span className="shrink-0 font-mono text-[10px] tabular-nums">
          <span className="text-success">+{additions}</span>{" "}
          <span className="text-destructive">−{deletions}</span>
        </span>
        <span className="flex shrink-0 items-center gap-0.5">
          <button type="button" className={toggleClass(!split)} onClick={() => setSplit(false)}>
            Unified
          </button>
          <button type="button" className={toggleClass(split)} onClick={() => setSplit(true)}>
            Split
          </button>
          <button
            type="button"
            title="Ignore whitespace-only changes"
            aria-pressed={ignoreWhitespace}
            className={toggleClass(ignoreWhitespace)}
            onClick={() => setIgnoreWhitespace((value) => !value)}
          >
            WS
          </button>
          {target.kind === "working" ? (
            <button
              type="button"
              title="Show the whole file instead of the changed hunks"
              aria-pressed={fullContext}
              className={toggleClass(fullContext)}
              onClick={() => setFullContext((value) => !value)}
            >
              Full
            </button>
          ) : null}
        </span>
      </div>

      {loading ? (
        <p className="p-4 text-center text-[11px] text-muted-foreground">Loading diff…</p>
      ) : error !== null ? (
        <p className="p-4 text-[11px] text-destructive">{error}</p>
      ) : diff.trim() === "" || diff === "No differences found" ? (
        <p className="p-4 text-[11px] text-muted-foreground">No differences.</p>
      ) : split ? (
        <SplitBody rows={parsed.splitRows} truncated={truncated} />
      ) : (
        <UnifiedBody lines={parsed.lines} truncated={truncated} />
      )}
    </div>
  );
}

function UnifiedBody({ lines, truncated }: { lines: DiffLine[]; truncated: boolean }) {
  const shown = truncated ? lines.slice(0, MAX_RENDERED_LINES) : lines;
  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <pre className="min-w-max font-mono text-[11px] leading-[1.45]">
        {shown.map((line, index) => {
          if (line.type === "meta") {
            return (
              <div key={index} className="bg-state-hover px-2 text-[10px] text-muted-foreground">
                {line.text}
              </div>
            );
          }
          const style = line.type === "add" ? ADD_STYLE : line.type === "del" ? DEL_STYLE : undefined;
          const toneClass =
            line.type === "add"
              ? "text-success"
              : line.type === "del"
                ? "text-destructive"
                : "text-foreground/85";
          return (
            <div key={index} className="flex" style={style}>
              <span className="sticky left-0 w-9 shrink-0 select-none border-r border-border/60 bg-transparent px-1 text-right text-[9px] text-muted-foreground" style={style}>
                {line.oldLineNumber ?? ""}
              </span>
              <span className="w-9 shrink-0 select-none px-1 text-right text-[9px] text-muted-foreground" style={style}>
                {line.newLineNumber ?? ""}
              </span>
              <span className={`whitespace-pre px-2 ${toneClass}`}>
                {line.type === "add" ? "+" : line.type === "del" ? "−" : " "}
                {line.text}
              </span>
            </div>
          );
        })}
        {truncated ? (
          <div className="px-2 py-1 text-[10px] text-muted-foreground">
            … {lines.length - MAX_RENDERED_LINES} more lines not shown
          </div>
        ) : null}
      </pre>
    </div>
  );
}

function SplitBody({ rows, truncated }: { rows: SplitDiffRow[]; truncated: boolean }) {
  const shown = truncated ? rows.slice(0, MAX_RENDERED_LINES) : rows;
  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <div className="min-w-max font-mono text-[11px] leading-[1.45]">
        {shown.map((row, index) => {
          if (row.isMeta === true) {
            return (
              <div key={index} className="bg-state-hover px-2 text-[10px] text-muted-foreground">
                {row.metaText ?? ""}
              </div>
            );
          }
          return (
            <div key={index} className="flex">
              <SplitCell side={row.left} />
              <SplitCell side={row.right} />
            </div>
          );
        })}
        {truncated ? (
          <div className="px-2 py-1 text-[10px] text-muted-foreground">
            … {rows.length - MAX_RENDERED_LINES} more rows not shown
          </div>
        ) : null}
      </div>
    </div>
  );
}

function SplitCell({
  side,
}: {
  side?: { type: "del" | "add" | "context"; text: string; lineNumber: number };
}) {
  if (side === undefined) {
    return <span className="w-1/2 flex-1 border-r border-border/40 opacity-40" />;
  }
  const style = side.type === "add" ? ADD_STYLE : side.type === "del" ? DEL_STYLE : undefined;
  const toneClass =
    side.type === "add" ? "text-success" : side.type === "del" ? "text-destructive" : "text-foreground/85";
  return (
    <span className="flex w-1/2 flex-1 border-r border-border/40" style={style}>
      <span
        className="w-8 shrink-0 select-none px-1 text-right text-[9px] text-muted-foreground"
        style={style}
      >
        {side.lineNumber}
      </span>
      <span className={`whitespace-pre px-1.5 ${toneClass}`}>
        {side.type === "add" ? "+" : side.type === "del" ? "−" : " "}
        {side.text}
      </span>
    </span>
  );
}
