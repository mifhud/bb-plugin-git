import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { usePortalScopeProps } from "@/lib/portal-scope";

/**
 * The three confirmations the panel needs. They render through a portal on
 * `document.body` (scoped to the plugin root, like the rail) so they float
 * above the rail regardless of where the triggering click happened. Escape
 * and a backdrop click always cancel — no action ever runs by accident.
 */

function DialogFrame({
  title,
  children,
  onCancel,
}: {
  title: string;
  children: ReactNode;
  onCancel: () => void;
}) {
  const scope = usePortalScopeProps();
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onCancel]);

  return createPortal(
    <div
      {...scope}
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/60 p-4"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="w-full max-w-sm rounded-md border border-border bg-popover text-popover-foreground shadow-lg"
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}

export function ConfirmDialog({
  message,
  confirmLabel = "Confirm",
  destructive = false,
  busy = false,
  onConfirm,
  onCancel,
}: {
  message: string;
  confirmLabel?: string;
  destructive?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <DialogFrame title={confirmLabel} onCancel={onCancel}>
      <div className="p-4 text-sm text-foreground">{message}</div>
      <div className="flex justify-end gap-2 border-t border-border p-3">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
        <Button
          type="button"
          size="sm"
          variant={destructive ? "destructive" : "default"}
          onClick={onConfirm}
          disabled={busy}
        >
          {busy ? "Working…" : confirmLabel}
        </Button>
      </div>
    </DialogFrame>
  );
}

/** Several ways forward for one question — reset modes, mostly. */
export function ChoiceDialog({
  message,
  choices,
  onChoose,
  onCancel,
}: {
  message: string;
  choices: Array<{ label: string; description?: string; value: string; destructive?: boolean }>;
  onChoose: (value: string) => void;
  onCancel: () => void;
}) {
  return (
    <DialogFrame title={message} onCancel={onCancel}>
      <div className="p-4 text-sm text-foreground">{message}</div>
      <div className="flex flex-col gap-1 border-t border-border p-3">
        {choices.map((choice) => (
          <Button
            key={choice.value}
            type="button"
            variant={choice.destructive === true ? "destructive" : "outline"}
            size="sm"
            className="justify-start"
            onClick={() => onChoose(choice.value)}
          >
            <span>{choice.label}</span>
            {choice.description !== undefined ? (
              <span className="text-xs text-muted-foreground">{choice.description}</span>
            ) : null}
          </Button>
        ))}
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </DialogFrame>
  );
}

/** One-line input — new branch name. Enter confirms while non-empty. */
export function PromptDialog({
  title,
  placeholder = "",
  confirmLabel = "Create",
  busy = false,
  onConfirm,
  onCancel,
}: {
  title: string;
  placeholder?: string;
  confirmLabel?: string;
  busy?: boolean;
  onConfirm: (value: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const submit = (): void => {
    const trimmed = value.trim();
    if (trimmed !== "" && !busy) onConfirm(trimmed);
  };

  return (
    <DialogFrame title={title} onCancel={onCancel}>
      <div className="p-4">
        <div className="mb-2 text-sm text-foreground">{title}</div>
        <Input
          ref={inputRef}
          value={value}
          placeholder={placeholder}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              submit();
            }
          }}
        />
      </div>
      <div className="flex justify-end gap-2 border-t border-border p-3">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
        <Button type="button" size="sm" onClick={submit} disabled={busy || value.trim() === ""}>
          {busy ? "Working…" : confirmLabel}
        </Button>
      </div>
    </DialogFrame>
  );
}
