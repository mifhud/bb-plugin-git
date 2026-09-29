/**
 * Ahead/behind counts behind the panel's Sync button — ported from
 * ompchamber's `server/lib/fs/git-sync.ts`, with the same reasoning kept
 * intact: `git rev-list --left-right --count HEAD...@{upstream}` counts
 * against the LOCAL remote-tracking ref, and that ref only moves on
 * fetch/pull/push. A read that asks for counts therefore refreshes the
 * tracking ref first, TTL'd so the panel's poll is not a fetch loop.
 */

import { spawn } from "node:child_process";
import { gitOk, runGit } from "./shell.ts";

/** How long a fetch attempt — success or failure — is trusted. */
const FETCH_TTL_MS = 60_000;
/**
 * How long a read waits for the fetch before answering from the tracking ref
 * as it stands. A slow or offline remote must not stall the panel.
 */
const FETCH_WAIT_MS = 3_000;
/** Hard budget for one fetch; it is killed at the end of it. */
const FETCH_TIMEOUT_MS = 15_000;

export interface GitSyncCount {
  ahead: number;
  behind: number;
}

interface RemoteState {
  /** When the last attempt settled; `0` means never attempted. */
  at: number;
  /** The running attempt, so concurrent polls share one fetch. */
  inFlight: Promise<void> | null;
}

const remoteStates = new Map<string, RemoteState>();

function stateFor(cwd: string): RemoteState {
  let state = remoteStates.get(cwd);
  if (state === undefined) {
    state = { at: 0, inFlight: null };
    remoteStates.set(cwd, state);
  }
  return state;
}

/**
 * Runs one `git fetch` with a hard deadline, returning whether it succeeded.
 * Both output streams are ignored (nothing here reads them) and the process
 * is killed BY PROCESS GROUP at the deadline — `detached` is what makes the
 * group killable, and the group kill is what stops a stalled fetch's own
 * `git-remote-https` child from outliving it and holding a pipe open.
 */
async function runFetch(cwd: string, remote: string): Promise<boolean> {
  return new Promise((resolve) => {
    const proc = spawn("git", ["fetch", "--quiet", "--no-tags", remote], {
      cwd,
      stdio: "ignore",
      detached: true,
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    });
    let settled = false;
    const finish = (ok: boolean): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(ok);
    };
    const timer = setTimeout(() => {
      try {
        if (proc.pid !== undefined) process.kill(-proc.pid, "SIGKILL");
      } catch {
        // Already gone; `exit`/`error` below still settles.
      }
      finish(false);
    }, FETCH_TIMEOUT_MS);
    proc.on("exit", (code) => finish(code === 0));
    proc.on("error", () => finish(false));
  });
}

/**
 * The branch's upstream remote, or null when it has none. Cheap and local, so
 * the no-upstream case is never cached: configuring an upstream in a terminal
 * shows up on the next poll instead of a TTL later.
 */
async function readUpstreamRemote(cwd: string): Promise<string | null> {
  const result = await runGit(
    ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"],
    { cwd, timeout: 5_000 },
  );
  if (!gitOk(result)) return null;
  const upstream = result.stdout.trim();
  const slash = upstream.indexOf("/");
  return slash > 0 ? upstream.slice(0, slash) : null;
}

/**
 * Refresh `cwd`'s remote-tracking refs, awaiting at most `FETCH_WAIT_MS`.
 * Resolves immediately when the last attempt is still inside its TTL, and
 * shares the running attempt when one is already in flight.
 */
export async function refreshRemoteRefs(cwd: string): Promise<void> {
  const state = stateFor(cwd);
  if (state.inFlight !== null) return state.inFlight;
  if (state.at !== 0 && Date.now() - state.at < FETCH_TTL_MS) return;

  const remote = await readUpstreamRemote(cwd);
  if (remote === null) return;
  // Reading the upstream is itself an await: another poll may have started
  // the fetch, or completed one, in the meantime.
  if (state.inFlight !== null) return state.inFlight;
  if (state.at !== 0 && Date.now() - state.at < FETCH_TTL_MS) return;

  // The attempt never rejects — a failed fetch is not a broken panel — and
  // always clears `inFlight` so a later read can retry.
  state.inFlight = (async () => {
    try {
      await runFetch(cwd, remote);
    } finally {
      state.at = Date.now();
      state.inFlight = null;
    }
  })();

  // Bounded wait; the fetch keeps running under its own budget if this
  // returns first, and a later read picks up the new ref.
  await Promise.race([
    state.inFlight,
    new Promise<void>((resolve) => {
      const t = setTimeout(resolve, FETCH_WAIT_MS);
      if (typeof t === "object" && t !== null && "unref" in t) (t as NodeJS.Timeout).unref();
    }),
  ]);
}

/** Marks `cwd` as freshly fetched — a pull/push already moved the tracking ref. */
export function markRemoteRefsFresh(cwd: string): void {
  stateFor(cwd).at = Date.now();
}

/** Forces the next read to fetch. Counts are per-branch; a checkout invalidates them. */
export function invalidateRemoteRefs(cwd: string): void {
  stateFor(cwd).at = 0;
}

/**
 * Ahead/behind against the branch's upstream, read from the local tracking
 * ref (`refreshRemoteRefs` is what makes that ref current). Both zero when
 * the branch has no upstream or git cannot answer.
 */
export async function gitSyncCount(cwd: string): Promise<GitSyncCount> {
  const result = await runGit(
    ["rev-list", "--left-right", "--count", "HEAD...@{upstream}"],
    { cwd, timeout: 8_000 },
  );
  if (!gitOk(result)) return { ahead: 0, behind: 0 };
  const [ahead, behind] = result.stdout.trim().split(/\s+/).map(Number);
  return { ahead: ahead || 0, behind: behind || 0 };
}
