import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
/**
 * The commit box: message in, commit out. Ported from ompchamber's
 * `CommitBox` — the button is disabled until there is both a message and
 * something staged, because git would refuse either way and the disabled
 * state says which one is missing.
 *
 * The magic-wand "Generate" button left of Commit sends the staged diff to an
 * agent and fills the message in. It only appears when something is staged.
 */
export function CommitBox({
  message,
  onMessageChange,
  hasStagedChanges,
  stagedCount,
  isBusy,
  isCommitting,
  generating,
  onGenerate,
  onCommit,
}: {
  message: string;
  onMessageChange: (value: string) => void;
  hasStagedChanges: boolean;
  stagedCount: number;
  isBusy: boolean;
  isCommitting: boolean;
  generating: boolean;
  onGenerate: () => void;
  onCommit: () => void;
}) {
  const canCommit = hasStagedChanges && message.trim() !== "" && !isBusy;
  const canGenerate = hasStagedChanges && !isBusy && !generating;
  const hint = !hasStagedChanges
    ? "Stage changes to commit"
    : message.trim() === ""
      ? "A commit message is required"
      : `Commit ${stagedCount} staged file${stagedCount === 1 ? "" : "s"}`;

  return (
    <div className="border-b border-sidebar-border p-2">
      <textarea
        value={message}
        onChange={(event) => onMessageChange(event.target.value)}
        onKeyDown={(event) => {
          // Cmd/Ctrl+Enter commits from anywhere in the box.
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && canCommit) {
            event.preventDefault();
            onCommit();
          }
        }}
        rows={2}
        placeholder="Commit message"
        aria-label="Commit message"
        className="w-full resize-none rounded-md border border-input bg-transparent px-2 py-1.5 text-xs text-foreground outline-none placeholder:text-muted-foreground focus-visible:ring-1 focus-visible:ring-ring"
      />
      <div className="mt-1.5 flex items-center justify-between gap-2">
        <span className="truncate text-[10px] text-muted-foreground" title={hint}>
          {hint}
        </span>
        <div className="flex items-center gap-1">
          {hasStagedChanges ? (
            <button
              type="button"
              aria-label={generating ? "Generating commit message…" : "Generate commit message"}
              title={generating ? "Generating…" : "Generate commit message from staged changes"}
              disabled={!canGenerate}
              className="flex size-7 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-state-hover disabled:cursor-not-allowed disabled:opacity-50"
              onClick={onGenerate}
            >
              <Icon
                aria-hidden
                className={cn("size-4", generating && "animate-spin")}
                name={generating ? "Spinner" : "AiContentGenerator01"}
              />
            </button>
          ) : null}
          <Button
            type="button"
            size="sm"
            className="h-7 shrink-0 px-3 text-xs"
            disabled={!canCommit}
            onClick={onCommit}
          >
            {isCommitting ? "Committing…" : "Commit"}
          </Button>
        </div>
      </div>
    </div>
  );
}
