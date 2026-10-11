/**
 * Width ratio of the split diff view's left ("before") pane, as a fraction of
 * the container. Mirrors the rail-width store pattern: a module-level value,
 * localStorage persistence on release, and an event for same-page listeners.
 */
import { useEffect, useState } from "react";

export const SPLIT_RATIO_STORAGE_KEY = "bb-plugin-git:split-ratio";
export const SPLIT_RATIO_EVENT = "bb-plugin-git:split-ratio";

export const DEFAULT_SPLIT_RATIO = 0.5;
const MIN_SPLIT_RATIO = 0.2;
const MAX_SPLIT_RATIO = 0.8;

let currentRatio: number | null = null;
const listeners = new Set<(ratio: number) => void>();

export function clampSplitRatio(ratio: number): number {
  return Math.round(Math.min(MAX_SPLIT_RATIO, Math.max(MIN_SPLIT_RATIO, ratio)) * 1000) / 1000;
}

function readStoredRatio(): number {
  try {
    const raw = localStorage.getItem(SPLIT_RATIO_STORAGE_KEY);
    const parsed = raw === null ? Number.NaN : Number.parseFloat(raw);
    if (Number.isFinite(parsed)) return parsed;
  } catch {
    /* private mode */
  }
  return DEFAULT_SPLIT_RATIO;
}

export function getSplitRatio(): number {
  if (currentRatio === null) currentRatio = readStoredRatio();
  return clampSplitRatio(currentRatio);
}

/** Live drag passes `persist: false`; the write happens once, on release. */
export function setSplitRatio(ratio: number, { persist }: { persist: boolean }): void {
  const next = clampSplitRatio(ratio);
  currentRatio = next;
  if (persist) {
    try {
      localStorage.setItem(SPLIT_RATIO_STORAGE_KEY, String(next));
    } catch {
      /* private mode */
    }
  }
  for (const listener of listeners) listener(next);
  window.dispatchEvent(new CustomEvent(SPLIT_RATIO_EVENT, { detail: next }));
}

export function subscribeSplitRatio(listener: (ratio: number) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useSplitRatio(): number {
  const [ratio, setRatio] = useState(getSplitRatio);
  useEffect(() => {
    setRatio(getSplitRatio());
    return subscribeSplitRatio(setRatio);
  }, []);
  return ratio;
}
