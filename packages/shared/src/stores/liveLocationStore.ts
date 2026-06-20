// Copyright (c) 2026 Asir Khan. All rights reserved.
// All Rights Reserved. See the LICENSE file.

/**
 * liveLocationStore — ephemeral Live Location + SOS state for the active crew.
 *
 * PRIVACY-CRITICAL: this store is created WITHOUT the persist middleware (unlike
 * crewStore). GPS coordinates and SOS positions are NEVER written to disk
 * (AsyncStorage / localStorage). They live only in memory for the lifetime of
 * the page/app session and reset to empty on every launch — so the "share my
 * location" toggle is always OFF by default and coordinates never leak to
 * storage, analytics, or replay.
 *
 * Scope: one crew at a time. `crewId` is the crew this store is currently scoped
 * to (viewing and/or sharing). Switching crews resets peers + SOS so one crew's
 * markers never bleed into another's.
 *
 * Self-healing: `sweepStale` drops peers whose serverAt is older than the TTL
 * (defense in depth alongside the server's 120s Redis TTL + peer-stopped
 * broadcasts), so a force-quit peer's marker fades even with no clean stop event.
 */

import { create, StateCreator } from 'zustand';
import type { PeerLocation, SosEntry } from '../types';
import { LIVE_LOCATION } from '../constants/config';

export interface LiveLocationState {
  /** The crew this store is scoped to (viewing/sharing), or null when inactive. */
  crewId: string | null;
  /** The crew we are actively publishing our own position to, or null. */
  sharingCrewId: string | null;
  /** Publisher bookkeeping: epoch ms of our last published fix. */
  lastSentAt: number | null;
  /** Publisher bookkeeping: our last published coordinate (for move-threshold). */
  lastSentCoord: { lat: number; lng: number } | null;
  /** Peers currently sharing to this crew, keyed by userId. */
  peers: Record<string, PeerLocation>;
  /** The active SOS for this crew, or null. */
  sos: SosEntry | null;
}

export interface LiveLocationActions {
  /**
   * Scope the store to a crew (viewing). Resets peers + SOS + sharing bookkeeping
   * when the crew changes so stale markers from another crew never render.
   */
  setActiveCrew: (crewId: string | null) => void;
  /** Mark that we have started publishing our own position to `crewId`. */
  startSharing: (crewId: string) => void;
  /** Stop publishing our own position; clears publisher bookkeeping. */
  stopSharing: () => void;
  /** Record a just-published fix (used by the throttle in useLiveLocationPublisher). */
  recordSent: (coord: { lat: number; lng: number }, at: number) => void;
  /** Apply a peer's position. Ignored if it targets a different crew than active. */
  applyPeerUpdate: (peer: PeerLocation) => void;
  /** Remove a peer (stop / disconnect / expiry). */
  removePeer: (userId: string) => void;
  /** Drop peers whose serverAt is older than ttlMs (defense in depth vs server TTL). */
  sweepStale: (now: number, ttlMs?: number) => void;
  /** Set the active SOS. Ignored if it targets a different crew than active. */
  applySos: (entry: SosEntry) => void;
  /** Clear the active SOS banner. */
  clearSos: () => void;
  /** Full reset (e.g. on logout). */
  reset: () => void;
}

export type LiveLocationStore = LiveLocationState & LiveLocationActions;

const EMPTY: LiveLocationState = {
  crewId: null,
  sharingCrewId: null,
  lastSentAt: null,
  lastSentCoord: null,
  peers: {},
  sos: null,
};

const liveLocationStore: StateCreator<LiveLocationStore> = (set, get) => ({
  ...EMPTY,

  setActiveCrew: (crewId) => {
    if (get().crewId === crewId) return;
    // Crew switch: wipe everything scoped to the previous crew, including any
    // active sharing (you must re-opt-in for the new crew — no silent re-share).
    set({ ...EMPTY, crewId });
  },

  startSharing: (crewId) => {
    set({ crewId, sharingCrewId: crewId, lastSentAt: null, lastSentCoord: null });
  },

  stopSharing: () => {
    set({ sharingCrewId: null, lastSentAt: null, lastSentCoord: null });
  },

  recordSent: (coord, at) => {
    set({ lastSentCoord: coord, lastSentAt: at });
  },

  applyPeerUpdate: (peer) => {
    const { crewId } = get();
    // Guard: only accept peers for the crew we're scoped to. The realtime hook
    // already guards via the router; this is defense in depth.
    if (crewId && peer.crewId !== crewId) return;
    set((state) => ({ peers: { ...state.peers, [peer.userId]: peer } }));
  },

  removePeer: (userId) => {
    set((state) => {
      if (!(userId in state.peers)) return state;
      const next = { ...state.peers };
      delete next[userId];
      return { peers: next };
    });
  },

  sweepStale: (now, ttlMs = LIVE_LOCATION.STALE_MS) => {
    set((state) => {
      let changed = false;
      const next: Record<string, PeerLocation> = {};
      for (const [userId, peer] of Object.entries(state.peers)) {
        const serverMs = new Date(peer.serverAt).getTime();
        if (Number.isFinite(serverMs) && now - serverMs > ttlMs) {
          changed = true;
          continue;
        }
        next[userId] = peer;
      }
      return changed ? { peers: next } : state;
    });
  },

  applySos: (entry) => {
    const { crewId } = get();
    if (crewId && entry.crewId !== crewId) return;
    set({ sos: entry });
  },

  clearSos: () => {
    set({ sos: null });
  },

  reset: () => {
    set({ ...EMPTY });
  },
});

// NOTE: plain create() — NO persist middleware. Ephemerality is a hard privacy
// requirement (see file header). Do not wrap this in persist().
export const useLiveLocationStore = create<LiveLocationStore>()(liveLocationStore);
