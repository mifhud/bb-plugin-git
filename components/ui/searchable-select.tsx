/* shadcn/ui-derived */
import { useId, useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { CONTROL_HOVER_TRANSITION } from "@/components/ui/motion";
import { usePortalScopeProps } from "@/lib/portal-scope";
import { COARSE_POINTER_INPUT_HEIGHT_CLASS } from "@/components/ui/coarse-pointer-sizing";

// Matches the context menu layering, so a rail dropdown sits with the other
// portaled plugin surfaces rather than guessing its own z-index.
const OVERLAY_LAYER_CLASS = "z-[70]";

export interface SelectOption {
  value: string;
  label: string;
}

export interface SearchableSelectProps {
  value: string | null;
  onValueChange: (value: string) => void;
  placeholder?: string;
  options: SelectOption[];
  triggerClassName?: string;
  contentClassName?: string;
  ariaLabel?: string;
  triggerTitle?: string;
  searchPlaceholder?: string;
  listAriaLabel?: string;
}

/**
 * A `<select>` replacement with a search filter. Opens a popover holding a text
 * input and a list that narrows case-insensitively as you type. Arrow keys walk
 * the list, Enter selects, Escape closes. The input takes focus on open so a
 * keyboard user can type to filter straight away.
 *
 * The popover renders through Radix's portal, so it escapes the rail's clipping;
 * `usePortalScopeProps` is mandatory there — the plugin's stylesheet is scoped to
 * `[data-bb-plugin-root]`, and a portaled node without that attribute renders
 * unstyled and effectively invisible.
 *
 * `useId` gives each instance a unique listbox id so two selects on the same
 * rail never collide (e.g. root picker + repo picker).
 */
export function SearchableSelect({
  value,
  onValueChange,
  placeholder = "Choose…",
  options,
  triggerClassName,
  contentClassName,
  ariaLabel,
  triggerTitle,
  searchPlaceholder = "Search…",
  listAriaLabel,
}: SearchableSelectProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const scopeProps = usePortalScopeProps();
  const listId = useId();

  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const selectedLabel =
    options.find((opt) => opt.value === value)?.label ?? null;

  const filtered = useMemo(() => {
    if (!query) return options;
    const lower = query.toLowerCase();
    return options.filter((opt) => opt.label.toLowerCase().includes(lower));
  }, [options, query]);

  // Reset the filter and focus the field on every open.
  useEffect(() => {
    if (!open) return;
    setQuery("");
    setActiveIndex(0);
    inputRef.current?.focus();
  }, [open]);

  // A highlight can move past the fold, so the list follows the keyboard.
  useEffect(() => {
    if (!open) return;
    listRef.current
      ?.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, open]);

  const selectOption = useCallback(
    (option: SelectOption) => {
      onValueChange(option.value);
      setOpen(false);
    },
    [onValueChange],
  );

  const onFieldKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    const count = filtered.length;
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        if (count > 0) setActiveIndex((i) => (i + 1) % count);
        break;
      case "ArrowUp":
        event.preventDefault();
        if (count > 0) setActiveIndex((i) => (i - 1 + count) % count);
        break;
      case "Enter":
        event.preventDefault();
        if (count > 0) selectOption(filtered[Math.min(activeIndex, count - 1)]);
        break;
      case "Escape":
        event.preventDefault();
        setOpen(false);
        break;
    }
  };

  return (
    <PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
      <PopoverPrimitive.Trigger asChild>
        <button
          type="button"
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-label={ariaLabel}
          title={triggerTitle}
          className={cn(
            "flex min-w-0 flex-1 cursor-pointer items-center gap-1 rounded-[3px] px-1 py-0.5 text-left",
            "text-[11px] text-sidebar-foreground",
            CONTROL_HOVER_TRANSITION,
            "hover:bg-state-hover hover:text-foreground",
            open && "bg-state-active",
            triggerClassName,
          )}
        >
          <span className="min-w-0 flex-1 truncate">
            {selectedLabel ?? placeholder}
          </span>
          <Icon
            name="ChevronDown"
            className={cn(
              "size-3 shrink-0 text-muted-foreground",
              CONTROL_HOVER_TRANSITION,
              open && "rotate-180",
            )}
          />
        </button>
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          // Portaled outside every plugin mount; re-attach the CSS scope or the
          // content renders with none of the plugin's styles.
          {...scopeProps}
          side="bottom"
          align="start"
          sideOffset={4}
          collisionPadding={8}
          className={cn(
            OVERLAY_LAYER_CLASS,
            "w-[var(--radix-popover-trigger-width)] max-w-[calc(100vw-1rem)] min-w-[180px]",
            "flex flex-col overflow-hidden rounded-md border border-popover bg-popover text-popover-foreground shadow-md outline-none",
            contentClassName,
          )}
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            inputRef.current?.focus();
          }}
        >
          <div className="border-b border-sidebar-border p-1.5">
            <Input
              ref={inputRef}
              type="text"
              role="combobox"
              aria-expanded
              aria-controls={listId}
              placeholder={searchPlaceholder}
              aria-label={searchPlaceholder}
              autoComplete="off"
              spellCheck={false}
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setActiveIndex(0);
              }}
              onKeyDown={onFieldKeyDown}
              className={cn(
                "h-7 bg-sidebar px-2 text-[11px]",
                COARSE_POINTER_INPUT_HEIGHT_CLASS,
              )}
            />
          </div>
          <div
            ref={listRef}
            id={listId}
            role="listbox"
            aria-label={listAriaLabel ?? ariaLabel ?? "Options"}
            className="max-h-[min(60vh,320px)] overflow-y-auto py-0.5"
          >
            {filtered.length === 0 ? (
              <p className="px-2 py-1.5 text-[11px] text-muted-foreground">
                No matching option
              </p>
            ) : (
              filtered.map((option, index) => {
                const isActive = index === activeIndex;
                const isSelected = option.value === value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    data-index={index}
                    role="option"
                    aria-selected={isSelected}
                    onClick={() => selectOption(option)}
                    onMouseEnter={() => setActiveIndex(index)}
                    className={cn(
                      "flex w-full min-w-0 cursor-pointer items-center gap-1 px-2 py-1 text-left text-[11px] text-sidebar-foreground",
                      CONTROL_HOVER_TRANSITION,
                      "hover:bg-state-hover hover:text-foreground",
                      isActive && "bg-state-active",
                    )}
                  >
                    <span className="min-w-0 flex-1 truncate">
                      {option.label}
                    </span>
                    {isSelected ? (
                      <Icon
                        name="Check"
                        className="size-3 shrink-0 text-muted-foreground"
                      />
                    ) : null}
                  </button>
                );
              })
            )}
          </div>
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
