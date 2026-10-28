/**
 * A "show git diff" button on every path in a chat message that actually
 * exists in this thread's workspace.
 *
 * Ported from bb-plugin-file-explorer's chat-path-buttons, trimmed to the
 * git use-case: no anchor fixing (that was a file-tree concern), and the click
 * opens a working-tree diff via the diff bus instead of revealing in a tree.
 *
 * Two things are deliberate here.
 *
 * The button is appended *inside* the code element it belongs to. An earlier
 * version inserted it as a sibling; React re-renders the message subtree and
 * does not own that button, so old ones were left stranded next to unrelated
 * text while still carrying their original path. A child is removed together
 * with its element, so a stale button cannot drift onto another path.
 *
 * Which strings get a button is decided by the filesystem, not by a pattern.
 * `packs/gws` and `and/or` are lexically identical, so guessing either misses
 * real paths or decorates prose. The candidates go to the server and only the
 * ones that resolve come back.
 */
import { writeStoredOpen } from "./rail-state";
import { createTimedCache, PATH_CACHE_TTL_MS } from "./timed-cache";
import { requestGitDiffFile } from "./git-diff-bus";

export type PathValidator = (paths: string[]) => Promise<Set<string>>;
export type Reporter = (message: string) => void;

const BUTTON_ATTR = "data-git-diff";
const PATH_ATTR = "gitDiffPath";

// BB marks the rendered body of a conversation message with this CSS class.
const CHAT_MESSAGE_SELECTOR = ".group\\/message";

/** Nodes of `selector` that sit inside a rendered message, not the whole document. */
function chatQuery<T extends Element>(selector: string): T[] {
  const found: T[] = [];
  const messages = document.querySelectorAll(CHAT_MESSAGE_SELECTOR);
  for (let i = 0; i < messages.length; i += 1) {
    const message = messages[i];
    if (message === undefined) continue;
    const nodes = message.querySelectorAll(selector);
    for (let j = 0; j < nodes.length; j += 1) {
      const node = nodes[j];
      if (node !== undefined) found.push(node as T);
    }
  }
  return found;
}

/**
 * A loose shape filter — anything that could plausibly name a file. Unicode
 * classes rather than `\w`, which is ASCII-only and dropped Cyrillic paths.
 * The server decides what actually exists; this only keeps obvious prose out
 * of the batch.
 */
const CANDIDATE_RE =
  /^[~.]?\/?[\p{L}\p{N}_.\-*[\]()][\p{L}\p{N}_.\-*[\]() /]*$/u;

/**
 * A bare token like `rules` or `packs` is a folder name as often as it is a
 * word, and only the filesystem can tell. Anything without whitespace is
 * cheap enough to ask about; prose with spaces is not worth the round trip.
 */
const BARE_NAME_RE = /^[\p{L}\p{N}_.\-]{3,}$/u;

/** A git-branch icon, distinct from file-explorer's external-link glyph. */
const ICON_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="12" y1="2" x2="12" y2="22"/><path d="M9 8c1-1 2-1 3-1s2 1 3 3-1 4-3 4-2 0-3-2-2-4-1-6"/></svg>';

/** The element's own text, excluding any button this module added. */
function textOf(code: Element): string {
  let text = "";
  for (const node of Array.from(code.childNodes)) {
    if (node.nodeType === Node.ELEMENT_NODE) {
      if ((node as Element).hasAttribute(BUTTON_ATTR)) continue;
      text += node.textContent ?? "";
      continue;
    }
    text += node.textContent ?? "";
  }
  return text.trim();
}

function candidateOf(code: Element): string | null {
  const text = textOf(code);
  if (text.length < 3 || text.length > 512) return null;
  if (text.includes("/")) return CANDIDATE_RE.test(text) ? text : null;
  return BARE_NAME_RE.test(text) ? text : null;
}

function makeButton(path: string, threadId: string): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.setAttribute(BUTTON_ATTR, "");
  button.dataset[PATH_ATTR] = path;
  button.title = `Show git diff: ${path}`;
  button.setAttribute("aria-label", `Show git diff: ${path}`);
  button.innerHTML = ICON_SVG;
  button.style.cssText = [
    "display:inline-flex",
    "align-items:center",
    "justify-content:center",
    "vertical-align:text-bottom",
    "margin-left:4px",
    "padding:0",
    "border:0",
    "background:transparent",
    "color:currentColor",
    "opacity:0.55",
    "cursor:pointer",
    "line-height:1",
  ].join(";");
  button.addEventListener("click", () => {
    writeStoredOpen(true);
    requestGitDiffFile(path, threadId);
  });
  return button;
}

/**
 * Shared across mounts of the same thread. A header re-render aborts the
 * effect and would otherwise ask the server about paths it already resolved.
 * Each entry expires on its own, so a file created later is asked again
 * without keeping a miss from the start of the session.
 */
const verdictCache = createTimedCache<boolean>(PATH_CACHE_TTL_MS);
/**
 * One resolve at a time per thread, so a remount waits for the request it
 * aborted.
 */
const pathChain = new Map<string, Promise<void>>();

function after(chain: Map<string, Promise<void>>, scope: string, job: () => Promise<void>): Promise<void> {
  const prev = chain.get(scope) ?? Promise.resolve();
  const next = prev.then(job, job).then(
    () => undefined,
    () => undefined,
  );
  chain.set(scope, next);
  return next;
}

/** Drop local entries whose shared stamp has expired, so a miss does not last the whole mount. */
function expireLocal<T>(local: Map<string, T>, fresh: Map<string, T>): void {
  for (const key of local.keys()) {
    if (!fresh.has(key)) local.delete(key);
  }
}

export function mountChatPathButtons(
  signal: AbortSignal,
  threadId: string,
  validate: PathValidator,
  report: Reporter = () => undefined,
): void {
  const known = verdictCache.recall(threadId);
  const pending = new Set<string>();
  let flushTimer: number | null = null;
  let sweepQueued = false;

  const ensureButton = (code: Element, path: string): void => {
    const existing = code.querySelector(`button[${BUTTON_ATTR}]`);
    if (existing !== null) {
      if ((existing as HTMLElement).dataset[PATH_ATTR] === path) return;
      existing.remove();
    }
    code.appendChild(makeButton(path, threadId));
  };

  let lastReport = "";
  let sweepTimer: number | null = null;
  /** A mutation arrived while a sweep was already running or waiting. */
  let sweepAgain = false;
  const sweep = (): void => {
    sweepTimer = null;
    if (signal.aborted) {
      sweepQueued = false;
      sweepAgain = false;
      return;
    }
    expireLocal(known, verdictCache.recall(threadId));
    let codes = 0;
    let candidates = 0;
    let wanted = 0;
    for (const code of chatQuery<Element>("code, a")) {
      // A `<code>` inside an `<a>` matches twice; let the inner one win so the
      // path gets one button, not two.
      if (code instanceof HTMLAnchorElement) continue;
      if (code.querySelector("code, a") !== null) continue;
      if (code.closest("a") !== null) continue;
      codes += 1;
      const path = candidateOf(code);
      if (path === null) {
        code.querySelector(`button[${BUTTON_ATTR}]`)?.remove();
        continue;
      }
      candidates += 1;
      const verdict = known.get(path);
      if (verdict === true) {
        wanted += 1;
        ensureButton(code, path);
        continue;
      }
      if (verdict === false) continue;
      pending.add(path);
    }
    if (pending.size > 0) scheduleFlush();

    // Only report when the numbers that matter move — otherwise this logs
    // once a second forever during a live chat.
    const present = document.querySelectorAll(`button[${BUTTON_ATTR}]`).length;
    const line = `sweep known=${wanted} buttonsInDom=${present}`;
    if (line !== lastReport) {
      lastReport = line;
      report(`${line} (codes=${codes} candidates=${candidates})`);
    }
    if (sweepAgain) {
      sweepAgain = false;
      // During streaming, coalesce message mutations into at most one full
      // follow-up scan per 750 ms instead of rescanning every token burst.
      sweepTimer = window.setTimeout(sweep, 750);
      return;
    }
    sweepQueued = false;
  };

  const queueSweep = (): void => {
    if (signal.aborted) return;
    if (sweepQueued) {
      sweepAgain = true;
      return;
    }
    sweepQueued = true;
    sweepTimer = window.setTimeout(sweep, 250);
  };

  const scheduleFlush = (): void => {
    if (flushTimer !== null) return;
    flushTimer = window.setTimeout(() => {
      flushTimer = null;
      void flush();
    }, 400);
  };

  const flush = (): void => {
    const batch = Array.from(pending).slice(0, 200);
    if (batch.length === 0) return;
    for (const path of batch) pending.delete(path);
    void after(pathChain, threadId, async () => {
      const fresh = verdictCache.recall(threadId);
      for (const [path, exists] of fresh) known.set(path, exists);
      const still = batch.filter((path) => !known.has(path));
      if (still.length === 0) return;
      let resolved: Set<string>;
      try {
        resolved = await validate(still);
      } catch {
        // Leave them unasked rather than caching a transport failure as "no".
        return;
      }
      for (const path of still) verdictCache.remember(threadId, path, resolved.has(path));
      if (signal.aborted) return;
      for (const path of still) known.set(path, resolved.has(path));
      report(
        `validated ${still.length}, known ${resolved.size}: ${Array.from(resolved)
          .slice(0, 5)
          .join(" | ")}`,
      );
      queueSweep();
    });
  };

  const observer = new MutationObserver((records) => {
    const relevant = records.some(
      (record) =>
        record.target instanceof Element &&
        record.target.closest(CHAT_MESSAGE_SELECTOR) !== null,
    );
    if (relevant) queueSweep();
  });
  observer.observe(document.body, { childList: true, subtree: true });
  signal.addEventListener(
    "abort",
    () => {
      observer.disconnect();
      if (sweepTimer !== null) window.clearTimeout(sweepTimer);
      if (flushTimer !== null) window.clearTimeout(flushTimer);
      for (const button of Array.from(
        document.querySelectorAll(`button[${BUTTON_ATTR}]`),
      )) {
        button.remove();
      }
    },
    { once: true },
  );

  queueSweep();
}
