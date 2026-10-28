/**
 * The rail's open/closed flag is shared by controls mounted in different BB
 * surfaces (sidebar footer, thread header, command palette). The rail
 * initializes it after settings load. Ported from bb-plugin-file-tree.
 */
export const RAIL_STORAGE_KEY = "bb-plugin-git:rail-open";
export const RAIL_EVENT = "bb-plugin-git:rail-open";
/** Storage key and event name for the file-explorer plugin's rail. When this
 *  rail opens, the sibling rail is closed so the two right-side panels never
 *  overlap — both sit at `fixed right-0 z-40` in the host window. */
const SIBLING_RAIL_STORAGE_KEY = "bb-plugin-file-explorer:rail-open";
const SIBLING_RAIL_EVENT = "bb-plugin-file-explorer:rail-open";
let currentOpen: boolean | null = null;

/** Close the sibling file-explorer rail by writing its storage key and
 * dispatching its event so its mounted components observe the change. */
function closeSiblingRail(): void {
  try {
    localStorage.setItem(SIBLING_RAIL_STORAGE_KEY, "0");
  } catch {
    /* private mode */
  }
  window.dispatchEvent(new CustomEvent(SIBLING_RAIL_EVENT, { detail: false }));
}

export function readStoredOpen(fallback: boolean): boolean {
  try {
    const raw = localStorage.getItem(RAIL_STORAGE_KEY);
    if (raw === "1") return true;
    if (raw === "0") return false;
  } catch {
    /* private mode */
  }
  return fallback;
}

export function writeStoredOpen(open: boolean): void {
  currentOpen = open;
  try {
    localStorage.setItem(RAIL_STORAGE_KEY, open ? "1" : "0");
  } catch {
    /* private mode */
  }
  window.dispatchEvent(new CustomEvent(RAIL_EVENT, { detail: open }));
  // Opening this rail must close the sibling so the two panels don't overlap.
  if (open) closeSiblingRail();
}

export function initializeRailOpen(fallback: boolean): boolean {
  const open = readStoredOpen(fallback);
  currentOpen = open;
  try {
    localStorage.setItem(RAIL_STORAGE_KEY, open ? "1" : "0");
  } catch {
    /* private mode */
  }
  window.dispatchEvent(new CustomEvent(RAIL_EVENT, { detail: open }));
  if (open) closeSiblingRail();
  return open;
}

export function toggleRailOpen(): void {
  // A click before settings load still means "show the panel".
  if (currentOpen === null) {
    writeStoredOpen(true);
    return;
  }
  // Read the actual stored state — the sibling plugin may have closed this
  // rail via closeSiblingRail() while `currentOpen` was stale (that path
  // only writes localStorage + dispatches an event; it doesn't touch this
  // module's cache). Reading from storage here ensures a single click always
  // toggles in the correct direction.
  const currentlyOpen = readStoredOpen(false);
  writeStoredOpen(!currentlyOpen);
}
const ROOT_STORAGE_KEY = "bb-plugin-git:pinned-root";

/** The pinned root choice id (`thread:<id>` / `source:<id>`), or null. */
export function readPinnedRoot(): string | null {
  try {
    const value = localStorage.getItem(ROOT_STORAGE_KEY);
    return value !== null && /^(?:thread|source):[\w-]{1,128}$/u.test(value) ? value : null;
  } catch {
    return null;
  }
}

/** Persist the pinned root choice id so chat-diff buttons can address it. */
export function writePinnedRoot(id: string): void {
  try {
    localStorage.setItem(ROOT_STORAGE_KEY, id);
  } catch {
    /* private mode: the choice lasts for this window only */
  }
}
