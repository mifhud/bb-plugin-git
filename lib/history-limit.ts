/**
 * Paging policy for the commit lists. One page is how many commits the History
 * tab loads at a time, and a search sweep stops once it has found that many
 * matches — "Load more" / "Search deeper" advance by one more page each time.
 * Pure so `node --test` can import it.
 */

export const DEFAULT_COMMITS_PER_PAGE = 50;

/**
 * Reads `settings.commitsPerPage`. Anything unparsable falls back to the
 * default so a stale or hand-edited value cannot leave the list stuck, and the
 * count is floored at one because a page of zero would never advance.
 */
export function parseCommitsPerPage(value: string | number | boolean | undefined): number {
  const parsed = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return DEFAULT_COMMITS_PER_PAGE;
  return Math.max(Math.floor(parsed), 1);
}

/**
 * Budget for the next sweep after "Search deeper": one more page beyond what is
 * already found, so a page that matched many commits cannot leave the button
 * with nothing left to fetch.
 */
export function nextSearchTarget(found: number, pageSize: number): number {
  return found + pageSize;
}
