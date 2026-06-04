import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../services/api', () => ({
  api: { get: vi.fn(), post: vi.fn() },
}));

// confirmPicks routes accepted suggestions through festivalDataStore.savePick —
// mock the store so we assert the SAME offline-native path is used (no second queue).
const savePick = vi.fn();
vi.mock('./festivalDataStore', () => ({
  useFestivalDataStore: {
    getState: () => ({ savePick, currentFestivalId: 'fest-1', currentProfile: { festivalId: 'fest-1' } }),
  },
}));

import { api } from '../services/api';
import { useSpotifyStore, suggestedToDomainPriority } from './spotifyStore';

const mockApi = api as unknown as { get: ReturnType<typeof vi.fn>; post: ReturnType<typeof vi.fn> };

function apiError(status: number): Error & { status: number } {
  const e = new Error(`status ${status}`) as Error & { status: number };
  e.status = status;
  return e;
}

const INITIAL = {
  connectionStatus: null,
  suggestions: null,
  playlist: null,
  statusLoading: false,
  suggestionsLoading: false,
  playlistBuilding: false,
  confirming: false,
  error: null,
};

describe('spotifyStore', () => {
  beforeEach(() => {
    useSpotifyStore.setState({ ...INITIAL });
    mockApi.get.mockReset();
    mockApi.post.mockReset();
    savePick.mockReset();
    savePick.mockResolvedValue(undefined);
    // jsdom: make window.location.assign assertable.
    Object.defineProperty(window, 'location', {
      value: { assign: vi.fn() },
      writable: true,
    });
  });

  describe('suggestedToDomainPriority', () => {
    it("maps the server 'want' label to the domain 'want-to-see'", () => {
      expect(suggestedToDomainPriority('must')).toBe('must');
      expect(suggestedToDomainPriority('want')).toBe('want-to-see');
      expect(suggestedToDomainPriority('maybe')).toBe('maybe');
    });
  });

  describe('loadStatus', () => {
    it('stores the connection status from the API', async () => {
      mockApi.get.mockResolvedValue({
        configured: true,
        connected: true,
        spotifyUserId: 'spuser',
        connectedAt: '2026-06-03T00:00:00Z',
      });
      await useSpotifyStore.getState().loadStatus();
      const st = useSpotifyStore.getState();
      expect(st.connectionStatus?.connected).toBe(true);
      expect(st.connectionStatus?.configured).toBe(true);
      expect(st.statusLoading).toBe(false);
    });

    it('treats a 503 as not-configured (dormant), not an error', async () => {
      mockApi.get.mockRejectedValue(apiError(503));
      await useSpotifyStore.getState().loadStatus();
      const st = useSpotifyStore.getState();
      expect(st.connectionStatus?.configured).toBe(false);
      expect(st.error).toBeNull();
    });
  });

  describe('connect', () => {
    it('redirects the browser to the authorize URL', async () => {
      mockApi.get.mockResolvedValue({ authorizeUrl: 'https://accounts.spotify.com/authorize?x=1', state: 's' });
      const url = await useSpotifyStore.getState().connect();
      expect(url).toBe('https://accounts.spotify.com/authorize?x=1');
      expect(window.location.assign).toHaveBeenCalledWith('https://accounts.spotify.com/authorize?x=1');
    });

    it('sets configured=false (dormant) on a 503 without throwing', async () => {
      mockApi.get.mockRejectedValue(apiError(503));
      const url = await useSpotifyStore.getState().connect();
      expect(url).toBeNull();
      expect(useSpotifyStore.getState().connectionStatus?.configured).toBe(false);
      expect(window.location.assign).not.toHaveBeenCalled();
    });
  });

  describe('loadSuggestions', () => {
    it('stores the suggestions result', async () => {
      const result = {
        suggestions: [
          { setId: 's1', artistName: 'A', spotifyArtistId: 'sp1', reasons: ['top_short'], suggestedPriority: 'must' },
        ],
        unmatchedFallback: false,
        total: 1,
      };
      mockApi.get.mockResolvedValue(result);
      await useSpotifyStore.getState().loadSuggestions('fest-1');
      expect(mockApi.get).toHaveBeenCalledWith('/spotify/suggestions/fest-1');
      expect(useSpotifyStore.getState().suggestions?.total).toBe(1);
    });

    it('reflects not-connected on a 409', async () => {
      useSpotifyStore.setState({
        connectionStatus: { configured: true, connected: true, spotifyUserId: 'x', connectedAt: null },
      });
      mockApi.get.mockRejectedValue(apiError(409));
      await useSpotifyStore.getState().loadSuggestions('fest-1');
      expect(useSpotifyStore.getState().connectionStatus?.connected).toBe(false);
      expect(useSpotifyStore.getState().error).toBeNull();
    });

    it('marks not-configured on a 503', async () => {
      mockApi.get.mockRejectedValue(apiError(503));
      await useSpotifyStore.getState().loadSuggestions('fest-1');
      expect(useSpotifyStore.getState().connectionStatus?.configured).toBe(false);
    });
  });

  describe('confirmPicks', () => {
    it('routes each accepted pick through festivalDataStore.savePick', async () => {
      await useSpotifyStore.getState().confirmPicks({ s1: 'must', s2: 'want-to-see', s3: null });
      expect(savePick).toHaveBeenCalledTimes(2);
      expect(savePick).toHaveBeenCalledWith({ festivalId: 'fest-1', setId: 's1', priority: 'must' });
      expect(savePick).toHaveBeenCalledWith({ festivalId: 'fest-1', setId: 's2', priority: 'want-to-see' });
      expect(useSpotifyStore.getState().confirming).toBe(false);
    });

    it('keeps saving the rest when one write fails (best-effort)', async () => {
      savePick.mockImplementation(({ setId }: { setId: string }) =>
        setId === 's1' ? Promise.reject(new Error('boom')) : Promise.resolve(),
      );
      await useSpotifyStore.getState().confirmPicks({ s1: 'must', s2: 'maybe' });
      expect(savePick).toHaveBeenCalledTimes(2);
      expect(useSpotifyStore.getState().error).toBeTruthy();
    });
  });

  describe('createPlaylist', () => {
    it('POSTs and stores the playlist result', async () => {
      const result = {
        playlistId: 'pl1',
        playlistUrl: 'https://open.spotify.com/playlist/pl1',
        trackCount: 40,
        artistCount: 8,
      };
      mockApi.post.mockResolvedValue(result);
      const out = await useSpotifyStore.getState().createPlaylist('fest-1');
      expect(mockApi.post).toHaveBeenCalledWith('/spotify/playlist/fest-1');
      expect(out?.playlistUrl).toContain('open.spotify.com');
      expect(useSpotifyStore.getState().playlist?.trackCount).toBe(40);
    });

    it('returns null and goes dormant on a 503', async () => {
      mockApi.post.mockRejectedValue(apiError(503));
      const out = await useSpotifyStore.getState().createPlaylist('fest-1');
      expect(out).toBeNull();
      expect(useSpotifyStore.getState().connectionStatus?.configured).toBe(false);
    });
  });

  describe('disconnect', () => {
    it('clears the connection and cached suggestions/playlist', async () => {
      useSpotifyStore.setState({
        connectionStatus: { configured: true, connected: true, spotifyUserId: 'x', connectedAt: null },
        suggestions: { suggestions: [], unmatchedFallback: false, total: 0 },
        playlist: { playlistId: 'p', playlistUrl: null, trackCount: 0, artistCount: 0 },
      });
      mockApi.post.mockResolvedValue({ connected: false });
      await useSpotifyStore.getState().disconnect();
      const st = useSpotifyStore.getState();
      expect(st.connectionStatus?.connected).toBe(false);
      expect(st.suggestions).toBeNull();
      expect(st.playlist).toBeNull();
    });
  });
});
