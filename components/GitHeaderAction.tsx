import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { RAIL_EVENT, readStoredOpen, toggleRailOpen } from "@/lib/rail-state";

/** Thread-header toggle, kept in sync with the rail through the shared event. */
export function GitHeaderAction() {
  const [open, setOpen] = useState(() => readStoredOpen(true));
  useEffect(() => {
    const onRailEvent = (event: Event) => {
      const next = (event as CustomEvent<boolean>).detail;
      if (typeof next === "boolean") setOpen(next);
    };
    window.addEventListener(RAIL_EVENT, onRailEvent);
    return () => window.removeEventListener(RAIL_EVENT, onRailEvent);
  }, []);

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className="size-7"
      aria-label={open ? "Hide git panel" : "Show git panel"}
      aria-pressed={open}
      onClick={toggleRailOpen}
    >
      <Icon name="GitBranch" className="size-4" />
    </Button>
  );
}
