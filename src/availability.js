// ---------------------------------------------------------------------------
// "Not Available" memory.
//
// There is no keyless availability API that covers every source we play
// through, so we learn from real playback instead of guessing:
//
//   • Coco II / Coco III (FrameXTV extractors) post `frameXTV:timeupdate` when
//     a stream really starts. If that never arrives while the player is open,
//     the title is remembered as unavailable.
//   * If the title ever does play (any server, any episode), the flag clears
//     again — a real success always beats an old failure.
//
// Coco I (vidsrc) cannot be checked: its iframe is cross-origin and posts no
// messages at all, so there is nothing to observe. Titles only played on
// Coco I therefore never get flagged.
//
// Nothing is sent anywhere — this is a per-browser memory in localStorage.
// ---------------------------------------------------------------------------

import { useMemo, useSyncExternalStore } from 'react';

const STORAGE_KEY = 'reelz_unavailable_v1';
const TTL_MS = 72 * 60 * 60 * 1000; // 3 days — extractors gain sources over time

const listeners = new Set();
let version = 0;
let store = null;

function load() {
  if (store) return store;
  const next = {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    if (parsed && typeof parsed === 'object') {
      const now = Date.now();
      for (const [key, entry] of Object.entries(parsed)) {
        if (entry && typeof entry.t === 'number' && now - entry.t < TTL_MS) next[key] = entry;
      }
    }
  } catch {
    /* storage unavailable (private mode) — fall back to memory-only */
  }
  store = next;
  return store;
}

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store || {}));
  } catch {
    /* ignore */
  }
}

function emit() {
  version += 1;
  listeners.forEach((fn) => fn());
}

function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

const keyFor = (media) =>
  media && media.id !== undefined && media.id !== null ? `${media.type || 'tv'}:${media.id}` : '';

// The availability memory belongs to the Coco servers (Movies & TV only).
// Adult items are a single self-contained embed with no server list, so they
// are never marked and must never pick up a stale flag.
const isAdult = (media) => media?.type === 'adult';

export function isUnavailable(media) {
  if (isAdult(media)) return false;
  const key = keyFor(media);
  if (!key) return false;
  const entry = load()[key];
  return Boolean(entry && Date.now() - entry.t < TTL_MS);
}

// Playback never started on `serverId` (Coco II / Coco III only).
export function markUnavailable(media, serverId) {
  if (isAdult(media)) return;
  const key = keyFor(media);
  if (!key) return;
  const s = load();
  s[key] = { t: Date.now(), server: serverId || null };
  persist();
  emit();
}

// Playback actually started — drop any stale "Not Available" flag.
export function markAvailable(media) {
  if (isAdult(media)) return;
  const key = keyFor(media);
  if (!key) return;
  const s = load();
  if (!s[key]) return;
  delete s[key];
  persist();
  emit();
}

// Re-renders the caller whenever the availability memory changes.
export function useIsUnavailable(media) {
  const v = useSyncExternalStore(subscribe, () => version);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => isUnavailable(media), [media?.type, media?.id, v]);
}
