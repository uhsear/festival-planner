import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useOfflineReadinessStore, collectArtUrls, type DownloadDeps } from './offlineReadinessStore';
import type { FestivalSet } from '../types';

function set(id: string, artists?: { name: string; photo?: string }[]): FestivalSet {
  return {
    id,
    festivalId: 'fest-1',
    stageId: 'stage-1',
    startTime: '2026-06-01T20:00:00Z',
    endTime: '2026-06-01T21:00:00Z',
    artists,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  };
}

// A full set of mock loaders, each a resolved spy by default. Tests override
// individual ones to simulate failures. getSets/prefetchImage default to no-op.
function mockDeps(over: Partial<DownloadDeps> = {}): DownloadDeps {
  return {
    selectFestival: vi.fn().mockResolvedValue(undefined),
    loadProfiles: vi.fn().mockResolvedValue(undefined),
    selectCrew: vi.fn().mockResolvedValue(undefined),
    loadMeetingPoints: vi.fn().mockResolvedValue(undefined),
    loadPolls: vi.fn().mockResolvedValue(undefined),
    loadExpenses: vi.fn().mockResolvedValue(undefined),
    loadActivity: vi.fn().mockResolvedValue(undefined),
    fetchWeather: vi.fn().mockResolvedValue(undefined),
    getSets: vi.fn().mockReturnValue([]),
    prefetchImage: vi.fn().mockResolvedValue(undefined),
    ...over,
  };
}

function reset() {
  useOfflineReadinessStore.setState({ byFestival: {}, downloadingFestivalId: null });
}

describe('offlineReadinessStore', () => {
  beforeEach(() => {
    reset();
    vi.clearAllMocks();
  });

  describe('collectArtUrls', () => {
    it('collects unique artist photo URLs from sets, skipping missing photos', () => {
      const sets = [
        set('s1', [{ name: 'A', photo: 'https://i.scdn.co/image/a' }]),
        set('s2', [{ name: 'B' }, { name: 'C', photo: 'https://i.scdn.co/image/c' }]),
        set('s3', [{ name: 'A2', photo: 'https://i.scdn.co/image/a' }]), // dup
      ];
      expect(collectArtUrls(sets)).toEqual(['https://i.scdn.co/image/a', 'https://i.scdn.co/image/c']);
    });

    it('bounds the number of URLs to the limit', () => {
      const sets = Array.from({ length: 10 }, (_, i) =>
        set(`s${i}`, [{ name: `A${i}`, photo: `https://i.scdn.co/image/${i}` }]),
      );
      expect(collectArtUrls(sets, 3)).toHaveLength(3);
    });
  });

  describe('downloadForOffline orchestration', () => {
    it('drives every loader and marks all sections ready on success', async () => {
      const deps = mockDeps();
      await useOfflineReadinessStore.getState().downloadForOffline('fest-1', 'crew-1', deps);

      expect(deps.selectFestival).toHaveBeenCalledWith('fest-1');
      expect(deps.loadProfiles).toHaveBeenCalledWith('fest-1');
      expect(deps.fetchWeather).toHaveBeenCalledWith('fest-1');
      expect(deps.selectCrew).toHaveBeenCalledWith('crew-1');
      expect(deps.loadMeetingPoints).toHaveBeenCalledWith('crew-1');
      expect(deps.loadPolls).toHaveBeenCalledWith('crew-1');
      expect(deps.loadExpenses).toHaveBeenCalledWith('crew-1');
      expect(deps.loadActivity).toHaveBeenCalledWith('crew-1');

      const r = useOfflineReadinessStore.getState().getReadiness('fest-1');
      for (const sec of ['schedule', 'picks', 'crew', 'weather', 'art'] as const) {
        expect(r[sec].status).toBe('ready');
        expect(r[sec].syncedAt).toBeTypeOf('number');
      }
      expect(useOfflineReadinessStore.getState().downloadingFestivalId).toBeNull();
    });

    it('leaves crew idle and skips crew loaders when no crewId is given', async () => {
      const deps = mockDeps();
      await useOfflineReadinessStore.getState().downloadForOffline('fest-1', undefined, deps);

      expect(deps.selectCrew).not.toHaveBeenCalled();
      expect(deps.loadMeetingPoints).not.toHaveBeenCalled();
      const r = useOfflineReadinessStore.getState().getReadiness('fest-1');
      expect(r.crew.status).toBe('idle');
      expect(r.schedule.status).toBe('ready');
      expect(r.picks.status).toBe('ready');
    });

    it('marks ONLY the failing section as error; others still succeed', async () => {
      const deps = mockDeps({ fetchWeather: vi.fn().mockRejectedValue(new Error('weather down')) });
      await useOfflineReadinessStore.getState().downloadForOffline('fest-1', 'crew-1', deps);

      const r = useOfflineReadinessStore.getState().getReadiness('fest-1');
      expect(r.weather.status).toBe('error');
      expect(r.schedule.status).toBe('ready');
      expect(r.picks.status).toBe('ready');
      expect(r.crew.status).toBe('ready');
      expect(r.art.status).toBe('ready');
    });

    it('never rejects even when the schedule loader fails, and dependent art still settles', async () => {
      const deps = mockDeps({ selectFestival: vi.fn().mockRejectedValue(new Error('offline')) });
      await expect(
        useOfflineReadinessStore.getState().downloadForOffline('fest-1', undefined, deps),
      ).resolves.toBeUndefined();

      const r = useOfflineReadinessStore.getState().getReadiness('fest-1');
      expect(r.schedule.status).toBe('error');
      // art reads sets after schedule; with no sets it still completes "ready".
      expect(r.art.status).toBe('ready');
    });

    it('prefetches each collected art URL exactly once', async () => {
      const sets = [
        set('s1', [{ name: 'A', photo: 'https://i.scdn.co/image/a' }]),
        set('s2', [{ name: 'B', photo: 'https://i.scdn.co/image/b' }]),
      ];
      const prefetchImage = vi.fn().mockResolvedValue(undefined);
      const deps = mockDeps({ getSets: vi.fn().mockReturnValue(sets), prefetchImage });
      await useOfflineReadinessStore.getState().downloadForOffline('fest-1', undefined, deps);

      expect(prefetchImage).toHaveBeenCalledTimes(2);
      expect(prefetchImage).toHaveBeenCalledWith('https://i.scdn.co/image/a');
      expect(prefetchImage).toHaveBeenCalledWith('https://i.scdn.co/image/b');
    });

    it('schedule completes before art reads sets (ordering guarantee)', async () => {
      const order: string[] = [];
      const deps = mockDeps({
        selectFestival: vi.fn().mockImplementation(async () => {
          order.push('schedule');
        }),
        getSets: vi.fn().mockImplementation(() => {
          order.push('art-read');
          return [];
        }),
      });
      await useOfflineReadinessStore.getState().downloadForOffline('fest-1', undefined, deps);
      expect(order).toEqual(['schedule', 'art-read']);
    });

    it('clearReadiness removes a festival entry', async () => {
      await useOfflineReadinessStore.getState().downloadForOffline('fest-1', undefined, mockDeps());
      expect(useOfflineReadinessStore.getState().byFestival['fest-1']).toBeDefined();
      useOfflineReadinessStore.getState().clearReadiness('fest-1');
      expect(useOfflineReadinessStore.getState().byFestival['fest-1']).toBeUndefined();
    });

    it('a crew sub-resource failure does not fail the crew section (selectCrew succeeded)', async () => {
      const deps = mockDeps({ loadExpenses: vi.fn().mockRejectedValue(new Error('expenses 500')) });
      await useOfflineReadinessStore.getState().downloadForOffline('fest-1', 'crew-1', deps);
      const r = useOfflineReadinessStore.getState().getReadiness('fest-1');
      expect(r.crew.status).toBe('ready');
    });
  });
});
