// Copyright (c) 2026 Asir Khan. All rights reserved.
// Licensed under the Business Source License 1.1. See LICENSE file for details.

/**
 * liveSocket — a tiny module-level holder for the single Socket.IO instance that
 * `useRealtimeSync` owns.
 *
 * Why this exists: `useRealtimeSync` (mounted once in the tabs layout) creates,
 * connects, and tears down the socket on AppState / auth / festival changes. The
 * Live Location publisher lives deep in the crew screen and needs that SAME
 * socket to emit `location:*` events — but the socket isn't exposed via context
 * or props. Rather than thread it through the tree, `useRealtimeSync` publishes
 * the current instance here, and `useLiveSocket()` subscribes (via
 * useSyncExternalStore) so consumers re-render when the socket connects/tears
 * down.
 *
 * This holds only a live reference (never serialized, never persisted) — no GPS
 * data lives here.
 */

import { useSyncExternalStore } from 'react';
import type { Socket } from '@festie/shared/services';

let current: Socket | null = null;
const listeners = new Set<() => void>();

/** Publish the active socket (or null on teardown). Called by useRealtimeSync. */
export function setLiveSocket(socket: Socket | null): void {
  if (current === socket) return;
  current = socket;
  for (const l of listeners) l();
}

function getSnapshot(): Socket | null {
  return current;
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/** Subscribe to the active socket; re-renders when it connects or tears down. */
export function useLiveSocket(): Socket | null {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
