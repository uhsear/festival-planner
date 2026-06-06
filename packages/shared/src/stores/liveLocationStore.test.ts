import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useLiveLocationStore } from './liveLocationStore';
import { LIVE_LOCATION } from '../constants/config';
import type { PeerLocation, SosEntry } from '../types/domain';

const NOW = Date.UTC(2026, 5, 6, 12, 0, 0); // fixed reference instant

function isoFor(now: number, ageMs: number): string {
  return new Date(now - ageMs).toISOString();
}

function makePeer(overrides: Partial<PeerLocation> = {}): PeerLocation {
  return {
    crewId: 'crew-1',
    userId: 'user-2',
    username: 'Bob',
    lat: 40.0,
    lng: -74.0,
    accuracy: 5,
    capturedAt: isoFor(NOW, 1_000),
    serverAt: isoFor(NOW, 1_000),
    ...overrides,
  };
}

function makeSos(overrides: Partial<SosEntry> = {}): SosEntry {
  return {
    crewId: 'crew-1',
    userId: 'user-3',
    username: 'Carol',
    message: 'Need help at main stage',
    position: { lat: 40.1, lng: -74.1, accuracy: 8, capturedAt: isoFor(NOW, 500) },
    activityId: 'act-1',
    raisedAt: isoFor(NOW, 500),
    ...overrides,
  };
}

function resetStore() {
  useLiveLocationStore.setState({
    crewId: null,
    sharingCrewId: null,
    lastSentAt: null,
    lastSentCoord: null,
    peers: {},
    sos: null,
  });
}

describe('liveLocationStore', () => {
  beforeEach(() => {
    resetStore();
    vi.clearAllMocks();
  });

  describe('initial state', () => {
    it('starts inactive with no crew, no sharing, no peers, no SOS', () => {
      const s = useLiveLocationStore.getState();
      expect(s.crewId).toBeNull();
      expect(s.sharingCrewId).toBeNull();
      expect(s.lastSentAt).toBeNull();
      expect(s.lastSentCoord).toBeNull();
      expect(s.peers).toEqual({});
      expect(s.sos).toBeNull();
    });
  });

  describe('persist middleware (privacy)', () => {
    it('does NOT write anything to localStorage when state changes', () => {
      const setItem = vi.spyOn(Storage.prototype, 'setItem');
      const store = useLiveLocationStore.getState();
      store.setActiveCrew('crew-1');
      store.applyPeerUpdate(makePeer());
      store.startSharing('crew-1');
      store.recordSent({ lat: 1, lng: 2 }, NOW);
      store.applySos(makeSos());
      expect(setItem).not.toHaveBeenCalled();
      setItem.mockRestore();
    });

    it('has no persist API on the store (no rehydrate/getOptions)', () => {
      // A persisted zustand store exposes `persist` on the store object.
      expect((useLiveLocationStore as unknown as { persist?: unknown }).persist).toBeUndefined();
    });
  });

  describe('setActiveCrew', () => {
    it('scopes the store to a crew', () => {
      useLiveLocationStore.getState().setActiveCrew('crew-1');
      expect(useLiveLocationStore.getState().crewId).toBe('crew-1');
    });

    it('is a no-op when the crew is unchanged (does not wipe peers)', () => {
      const store = useLiveLocationStore.getState();
      store.setActiveCrew('crew-1');
      store.applyPeerUpdate(makePeer());
      store.setActiveCrew('crew-1'); // same crew again
      expect(Object.keys(useLiveLocationStore.getState().peers)).toEqual(['user-2']);
    });

    it('crew switch wipes peers, SOS, and sharing — no silent re-share', () => {
      const store = useLiveLocationStore.getState();
      store.setActiveCrew('crew-1');
      store.startSharing('crew-1');
      store.recordSent({ lat: 1, lng: 2 }, NOW);
      store.applyPeerUpdate(makePeer());
      store.applySos(makeSos());

      store.setActiveCrew('crew-2');

      const s = useLiveLocationStore.getState();
      expect(s.crewId).toBe('crew-2');
      // Everything scoped to the previous crew is gone.
      expect(s.peers).toEqual({});
      expect(s.sos).toBeNull();
      // Critically: sharing does NOT carry over to the new crew.
      expect(s.sharingCrewId).toBeNull();
      expect(s.lastSentAt).toBeNull();
      expect(s.lastSentCoord).toBeNull();
    });

    it('clearing the active crew (null) also wipes scoped state', () => {
      const store = useLiveLocationStore.getState();
      store.setActiveCrew('crew-1');
      store.applyPeerUpdate(makePeer());
      store.applySos(makeSos());
      store.setActiveCrew(null);
      const s = useLiveLocationStore.getState();
      expect(s.crewId).toBeNull();
      expect(s.peers).toEqual({});
      expect(s.sos).toBeNull();
    });
  });

  describe('startSharing / stopSharing / recordSent', () => {
    it('startSharing sets crewId + sharingCrewId and clears send bookkeeping', () => {
      const store = useLiveLocationStore.getState();
      store.recordSent({ lat: 9, lng: 9 }, 123);
      store.startSharing('crew-1');
      const s = useLiveLocationStore.getState();
      expect(s.crewId).toBe('crew-1');
      expect(s.sharingCrewId).toBe('crew-1');
      expect(s.lastSentAt).toBeNull();
      expect(s.lastSentCoord).toBeNull();
    });

    it('recordSent stores the coord + timestamp', () => {
      useLiveLocationStore.getState().recordSent({ lat: 1.5, lng: -2.5 }, NOW);
      const s = useLiveLocationStore.getState();
      expect(s.lastSentCoord).toEqual({ lat: 1.5, lng: -2.5 });
      expect(s.lastSentAt).toBe(NOW);
    });

    it('stopSharing clears sharing + send bookkeeping but keeps active crew', () => {
      const store = useLiveLocationStore.getState();
      store.startSharing('crew-1');
      store.recordSent({ lat: 1, lng: 2 }, NOW);
      store.stopSharing();
      const s = useLiveLocationStore.getState();
      expect(s.crewId).toBe('crew-1'); // still viewing the crew
      expect(s.sharingCrewId).toBeNull();
      expect(s.lastSentAt).toBeNull();
      expect(s.lastSentCoord).toBeNull();
    });
  });

  describe('applyPeerUpdate', () => {
    beforeEach(() => {
      useLiveLocationStore.getState().setActiveCrew('crew-1');
    });

    it('adds a peer keyed by userId', () => {
      useLiveLocationStore.getState().applyPeerUpdate(makePeer());
      expect(useLiveLocationStore.getState().peers['user-2']).toMatchObject({ username: 'Bob' });
    });

    it('upserts (replaces) an existing peer by userId', () => {
      const store = useLiveLocationStore.getState();
      store.applyPeerUpdate(makePeer({ lat: 1 }));
      store.applyPeerUpdate(makePeer({ lat: 2 }));
      expect(Object.keys(useLiveLocationStore.getState().peers)).toHaveLength(1);
      expect(useLiveLocationStore.getState().peers['user-2']!.lat).toBe(2);
    });

    it('crew-scope guard DROPS a peer update targeting a different crew', () => {
      useLiveLocationStore.getState().applyPeerUpdate(makePeer({ crewId: 'crew-OTHER' }));
      expect(useLiveLocationStore.getState().peers).toEqual({});
    });

    it('accepts a peer when no crew is scoped yet (crewId null)', () => {
      resetStore(); // crewId === null
      useLiveLocationStore.getState().applyPeerUpdate(makePeer({ crewId: 'whatever' }));
      expect(useLiveLocationStore.getState().peers['user-2']).toBeDefined();
    });
  });

  describe('removePeer', () => {
    beforeEach(() => {
      useLiveLocationStore.getState().setActiveCrew('crew-1');
    });

    it('removes a present peer', () => {
      const store = useLiveLocationStore.getState();
      store.applyPeerUpdate(makePeer({ userId: 'a' }));
      store.applyPeerUpdate(makePeer({ userId: 'b' }));
      store.removePeer('a');
      expect(Object.keys(useLiveLocationStore.getState().peers)).toEqual(['b']);
    });

    it('is a no-op (same reference) when the peer is absent', () => {
      const store = useLiveLocationStore.getState();
      store.applyPeerUpdate(makePeer({ userId: 'a' }));
      const before = useLiveLocationStore.getState().peers;
      store.removePeer('nope');
      expect(useLiveLocationStore.getState().peers).toBe(before);
    });
  });

  describe('sweepStale', () => {
    beforeEach(() => {
      useLiveLocationStore.getState().setActiveCrew('crew-1');
    });

    it('removes peers whose serverAt is older than the TTL (>120s)', () => {
      const store = useLiveLocationStore.getState();
      store.applyPeerUpdate(makePeer({ userId: 'fresh', serverAt: isoFor(NOW, 10_000) }));
      store.applyPeerUpdate(makePeer({ userId: 'stale', serverAt: isoFor(NOW, LIVE_LOCATION.STALE_MS + 1_000) }));
      store.sweepStale(NOW);
      const peers = useLiveLocationStore.getState().peers;
      expect(peers['fresh']).toBeDefined();
      expect(peers['stale']).toBeUndefined();
    });

    it('keeps a peer exactly at the TTL boundary (not strictly older)', () => {
      const store = useLiveLocationStore.getState();
      store.applyPeerUpdate(makePeer({ userId: 'edge', serverAt: isoFor(NOW, LIVE_LOCATION.STALE_MS) }));
      store.sweepStale(NOW);
      expect(useLiveLocationStore.getState().peers['edge']).toBeDefined();
    });

    it('honors a custom ttlMs override', () => {
      const store = useLiveLocationStore.getState();
      store.applyPeerUpdate(makePeer({ userId: 'p', serverAt: isoFor(NOW, 5_000) }));
      store.sweepStale(NOW, 1_000); // 5s old > 1s ttl
      expect(useLiveLocationStore.getState().peers['p']).toBeUndefined();
    });

    it('is a no-op (same reference) when nothing is stale', () => {
      const store = useLiveLocationStore.getState();
      store.applyPeerUpdate(makePeer({ userId: 'p', serverAt: isoFor(NOW, 1_000) }));
      const before = useLiveLocationStore.getState().peers;
      store.sweepStale(NOW);
      expect(useLiveLocationStore.getState().peers).toBe(before);
    });

    it('keeps a peer whose serverAt is unparseable (non-finite is not "stale")', () => {
      const store = useLiveLocationStore.getState();
      store.applyPeerUpdate(makePeer({ userId: 'bad', serverAt: 'not-a-date' }));
      store.sweepStale(NOW);
      expect(useLiveLocationStore.getState().peers['bad']).toBeDefined();
    });
  });

  describe('applySos / clearSos', () => {
    beforeEach(() => {
      useLiveLocationStore.getState().setActiveCrew('crew-1');
    });

    it('sets the active SOS for the scoped crew', () => {
      useLiveLocationStore.getState().applySos(makeSos());
      expect(useLiveLocationStore.getState().sos).toMatchObject({ username: 'Carol' });
    });

    it('crew-scope guard DROPS an SOS targeting a different crew', () => {
      useLiveLocationStore.getState().applySos(makeSos({ crewId: 'crew-OTHER' }));
      expect(useLiveLocationStore.getState().sos).toBeNull();
    });

    it('accepts an SOS when no crew is scoped yet (crewId null)', () => {
      resetStore();
      useLiveLocationStore.getState().applySos(makeSos({ crewId: 'whatever' }));
      expect(useLiveLocationStore.getState().sos).not.toBeNull();
    });

    it('clearSos clears the banner', () => {
      const store = useLiveLocationStore.getState();
      store.applySos(makeSos());
      store.clearSos();
      expect(useLiveLocationStore.getState().sos).toBeNull();
    });
  });

  describe('reset', () => {
    it('returns the store to the empty baseline', () => {
      const store = useLiveLocationStore.getState();
      store.setActiveCrew('crew-1');
      store.startSharing('crew-1');
      store.recordSent({ lat: 1, lng: 2 }, NOW);
      store.applyPeerUpdate(makePeer());
      store.applySos(makeSos());

      store.reset();

      const s = useLiveLocationStore.getState();
      expect(s.crewId).toBeNull();
      expect(s.sharingCrewId).toBeNull();
      expect(s.lastSentAt).toBeNull();
      expect(s.lastSentCoord).toBeNull();
      expect(s.peers).toEqual({});
      expect(s.sos).toBeNull();
    });
  });
});
