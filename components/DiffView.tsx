import { useEffect, useRef, useState } from "react";
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
/**
 * Full-context diffs show the entire file. The 5000-line rendering cap would
 * truncate the actual +/- changes away for large files, making the diff look
 * all-gray — as if the colors disappeared. Raise the cap when the user
 * explicitly asks for the whole file.
 */
const MAX_FULL_CONTEXT_LINES = 50_000;

export function DiffView({
  rootId,
  repo,
  target,
  onBack,
}: {
  rootId: string;
  repo: string;
  target: DiffTarget;
  /** Omitted when the viewer is its own surface (a side-panel tab), where the
   *  tab's close button is the way back and no back arrow should render. */
  onBack?: () => void;
}) {
  const rpc = useRpc<typeof rpcContract>();
  const [diff, setDiff] = useState<string>("");
  const [meta, setMeta] = useState<{ additions: number; deletions: number; status?: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [split, setSplit] = useState(false);
  const [ignoreWhitespace, setIgnoreWhitespace] = useState(false);
  const [fullContext, setFullContext] = useState(false);
  // The BB host can hide scrollbars via ::-webkit-scrollbar { display: none }
  // or scrollbar-width: none. Inject !important CSS to force them visible.
  useEffect(() => {
    const styleId = "bb-plugin-git-diff-scrollbars";
    if (document.getElementById(styleId)) return;
    const style = document.createElement("style");
    style.id = styleId;
    style.textContent =
      "[data-git-scroll]{overflow-y:scroll!important;overflow-x:auto!important;scrollbar-width:auto!important;-ms-overflow-style:auto!important}" +
      "[data-git-scroll]::-webkit-scrollbar{display:block!important;width:14px!important;height:14px!important}" +
      "[data-git-scroll]::-webkit-scrollbar-track{background:transparent!important}" +
      "[data-git-scroll]::-webkit-scrollbar-thumb{background-color:rgba(128,128,128,.4)!important;border-radius:4px!important}";
    document.head.appendChild(style);
    return () => style.remove();
  }, []);

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
          const result = await rpc.call("stashFileDiff", { rootId, repo, stash: target.stash, file: target.file, fullContext });
          if (cancelled) return;
          if (!result.ok) throw new Error(result.error);
          setDiff(result.diff);
          setMeta(null);
        } else {
          const result = await rpc.call("commitDiff", { rootId, repo, hash: target.hash, file: target.file, fullContext });
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
  const renderCap = fullContext ? MAX_FULL_CONTEXT_LINES : MAX_RENDERED_LINES;
  const truncated = split
    ? parsed.splitRows.length > renderCap
    : parsed.lines.length > renderCap;

  const toggleClass = (active: boolean): string =>
    cn(
      "rounded px-1.5 py-0.5 text-[10px] transition-colors",
      active ? "bg-state-active text-foreground" : "text-muted-foreground hover:bg-state-hover",
    );

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-1 border-b border-sidebar-border px-1.5 py-1">
        {onBack !== undefined ? (
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
        ) : null}
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
          <button
            type="button"
            title="Show the whole file instead of the changed hunks"
            aria-pressed={fullContext}
            className={toggleClass(fullContext)}
            onClick={() => setFullContext((value) => !value)}
          >
            Full
          </button>
        </span>
      </div>

      {loading ? (
        <p className="p-4 text-center text-[11px] text-muted-foreground">Loading diff…</p>
      ) : error !== null ? (
        <p className="p-4 text-[11px] text-destructive">{error}</p>
      ) : diff.trim() === "" || diff === "No differences found" ? (
        <p className="p-4 text-[11px] text-muted-foreground">No differences.</p>
      ) : split ? (
        <SplitBody rows={parsed.splitRows} truncated={truncated} renderCap={renderCap} />
      ) : (
        <UnifiedBody lines={parsed.lines} truncated={truncated} renderCap={renderCap} />
      )}
    </div>
  );
}

function UnifiedBody({ lines, truncated, renderCap }: { lines: DiffLine[]; truncated: boolean; renderCap: number }) {
  const shown = truncated ? lines.slice(0, renderCap) : lines;
  return (
    <div data-git-scroll className="min-h-0 flex-1 h-full overflow-y-scroll overflow-x-auto">
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
              <span className={`whitespace-pre overflow-hidden px-2 ${toneClass}`}>
                {line.type === "add" ? "+" : line.type === "del" ? "−" : " "}
                {line.text}
              </span>
            </div>
          );
        })}
        {truncated ? (
          <div className="px-2 py-1 text-[10px] text-muted-foreground">
            … {lines.length - renderCap} more lines not shown
          </div>
        ) : null}
      </pre>
    </div>
  );
}

/** Mirrors one split pane's vertical scroll onto the other. The equality guard
 *  makes the mirrored event a no-op, so the two panes cannot bounce forever.
 *  Only the vertical axis is shared: each pane keeps its own horizontal scroll. */
function syncVerticalScroll(source: HTMLDivElement | null, target: HTMLDivElement | null): void {
  if (source === null || target === null || target.scrollTop === source.scrollTop) return;
  target.scrollTop = source.scrollTop;
}

function SplitBody({ rows, truncated, renderCap }: { rows: SplitDiffRow[]; truncated: boolean; renderCap: number }) {
  const shown = truncated ? rows.slice(0, renderCap) : rows;
  const leftPane = useRef<HTMLDivElement>(null);
  const rightPane = useRef<HTMLDivElement>(null);
  return (
    <div className="min-h-0 flex-1 flex">
      <div
        ref={leftPane}
        data-git-scroll
        onScroll={() => syncVerticalScroll(leftPane.current, rightPane.current)}
        className="min-h-0 min-w-0 flex-1 h-full overflow-y-scroll overflow-x-auto border-r border-border/40"
      >
        <div className="min-w-max font-mono text-[11px] leading-[1.45]">
          {shown.map((row, index) => {
            if (row.isMeta === true) {
              return (
                <div key={index} className="bg-state-hover px-2 text-[10px] text-muted-foreground">
                  {row.metaText ?? ""}
                </div>
              );
            }
            return <SplitCell side={row.left} />;
          })}
          {truncated ? (
            <div className="px-2 py-1 text-[10px] text-muted-foreground">
              … {rows.length - renderCap} more rows not shown
            </div>
          ) : null}
        </div>
      </div>
      <div
        ref={rightPane}
        data-git-scroll
        onScroll={() => syncVerticalScroll(rightPane.current, leftPane.current)}
        className="min-h-0 min-w-0 flex-1 h-full overflow-y-scroll overflow-x-auto"
      >
        <div className="min-w-max font-mono text-[11px] leading-[1.45]">
          {shown.map((row, index) => {
            if (row.isMeta === true) {
              return (
                <div key={index} className="bg-state-hover px-2 text-[10px] text-muted-foreground">
                  {row.metaText ?? ""}
                </div>
              );
            }
            return <SplitCell side={row.right} />;
          })}
          {truncated ? (
            <div className="px-2 py-1 text-[10px] text-muted-foreground">
              … {rows.length - renderCap} more rows not shown
            </div>
          ) : null}
        </div>
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
    return <span className="block w-full opacity-40" />;
  }
  const style = side.type === "add" ? ADD_STYLE : side.type === "del" ? DEL_STYLE : undefined;
  const toneClass =
    side.type === "add" ? "text-success" : side.type === "del" ? "text-destructive" : "text-foreground/85";
  return (
    <span className="flex w-full" style={style}>
      <span
        className="w-8 shrink-0 select-none px-1 text-right text-[9px] text-muted-foreground"
        style={style}
      >
        {side.lineNumber}
      </span>
      <span className={`whitespace-pre overflow-hidden px-1.5 ${toneClass}`}>
        {side.type === "add" ? "+" : side.type === "del" ? "−" : " "}
        {side.text}
      </span>
    </span>
  );
}
