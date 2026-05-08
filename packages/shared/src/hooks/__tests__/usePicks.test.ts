import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { usePicks } from '../usePicks';
import { useFestivalStore } from '../../stores/festivalStore';

vi.mock('../../services/api', () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
  setAuthToken: vi.fn(),
  clearAuthToken: vi.fn(),
  getAuthToken: vi.fn(),
  getApiBase: vi.fn(() => '/api/v1'),
}));

vi.mock('../../stores/resetStores', () => ({
  resetAllStores: vi.fn(),
}));

function resetStore() {
  useFestivalStore.setState({
    currentFestivalId: null,
    currentFestival: null,
    festivals: [],
    stages: [],
    sets: [],
    days: [],
    currentProfile: null,
    allProfiles: [],
    isLoading: false,
    error: null,
  });
}

describe('usePicks hook', () => {
  beforeEach(() => {
    resetStore();
  });

  describe('getMyPick', () => {
    it('returns undefined when no current profile', () => {
      const { result } = renderHook(() => usePicks());
      expect(result.current.getMyPick('set-1')).toBeUndefined();
    });

    it('returns the priority for a picked set', () => {
      useFestivalStore.setState({
        currentProfile: {
          id: 'p1',
          userId: 'u1',
          festivalId: 'f1',
          picks: { 'set-1': 'must' },
          notes: {},
          updatedAt: '2026-01-01T00:00:00Z',
        },
      });
      const { result } = renderHook(() => usePicks());
      expect(result.current.getMyPick('set-1')).toBe('must');
    });

    it('returns null for a set with no pick', () => {
      useFestivalStore.setState({
        currentProfile: {
          id: 'p1',
          userId: 'u1',
          festivalId: 'f1',
          picks: {},
          notes: {},
          updatedAt: '2026-01-01T00:00:00Z',
        },
      });
      const { result } = renderHook(() => usePicks());
      expect(result.current.getMyPick('set-1')).toBeNull();
    });

    it('handles null picks gracefully', () => {
      useFestivalStore.setState({
        currentProfile: {
          id: 'p1',
          userId: 'u1',
          festivalId: 'f1',
          picks: null as unknown as Record<string, string>,
          notes: {},
          updatedAt: '2026-01-01T00:00:00Z',
        },
      });
      const { result } = renderHook(() => usePicks());
      // Should not throw — the defensive `|| {}` guard covers this
      expect(result.current.getMyPick('set-1')).toBeNull();
    });
  });

  describe('getMyNote', () => {
    it('returns undefined when no current profile', () => {
      const { result } = renderHook(() => usePicks());
      expect(result.current.getMyNote('set-1')).toBeUndefined();
    });

    it('returns the note for a set', () => {
      useFestivalStore.setState({
        currentProfile: {
          id: 'p1',
          userId: 'u1',
          festivalId: 'f1',
          picks: {},
          notes: { 'set-1': 'Front row!' },
          updatedAt: '2026-01-01T00:00:00Z',
        },
      });
      const { result } = renderHook(() => usePicks());
      expect(result.current.getMyNote('set-1')).toBe('Front row!');
    });

    it('handles null notes gracefully', () => {
      useFestivalStore.setState({
        currentProfile: {
          id: 'p1',
          userId: 'u1',
          festivalId: 'f1',
          picks: {},
          notes: null as unknown as Record<string, string>,
          updatedAt: '2026-01-01T00:00:00Z',
        },
      });
      const { result } = renderHook(() => usePicks());
      expect(result.current.getMyNote('set-1')).toBeUndefined();
    });
  });

  describe('getOtherPicks', () => {
    it('returns empty array when no current profile', () => {
      const { result } = renderHook(() => usePicks());
      expect(result.current.getOtherPicks('set-1')).toEqual([]);
    });

    it('returns other profiles picks for a set', () => {
      useFestivalStore.setState({
        currentProfile: {
          id: 'p1',
          userId: 'u1',
          festivalId: 'f1',
          picks: { 'set-1': 'must' },
          notes: {},
          updatedAt: '2026-01-01T00:00:00Z',
        },
        allProfiles: [
          {
            id: 'p1',
            userId: 'u1',
            festivalId: 'f1',
            picks: { 'set-1': 'must' },
            notes: {},
            updatedAt: '2026-01-01T00:00:00Z',
          },
          {
            id: 'p2',
            userId: 'u2',
            festivalId: 'f1',
            name: 'Bob',
            picks: { 'set-1': 'want-to-see' },
            notes: {},
            updatedAt: '2026-01-01T00:00:00Z',
          },
          {
            id: 'p3',
            userId: 'u3',
            festivalId: 'f1',
            name: 'Carol',
            picks: {},
            notes: {},
            updatedAt: '2026-01-01T00:00:00Z',
          },
        ],
      });
      const { result } = renderHook(() => usePicks());
      const others = result.current.getOtherPicks('set-1');
      expect(others).toHaveLength(1);
      expect(others[0]).toEqual({
        profileId: 'p2',
        priority: 'want-to-see',
        name: 'Bob',
      });
    });

    it('excludes the current user from other picks', () => {
      useFestivalStore.setState({
        currentProfile: {
          id: 'p1',
          userId: 'u1',
          festivalId: 'f1',
          picks: { 'set-1': 'must' },
          notes: {},
          updatedAt: '2026-01-01T00:00:00Z',
        },
        allProfiles: [
          {
            id: 'p1',
            userId: 'u1',
            festivalId: 'f1',
            picks: { 'set-1': 'must' },
            notes: {},
            updatedAt: '2026-01-01T00:00:00Z',
          },
        ],
      });
      const { result } = renderHook(() => usePicks());
      expect(result.current.getOtherPicks('set-1')).toEqual([]);
    });
  });

  describe('savePick', () => {
    it('calls store savePick with correct request', async () => {
      const mockSavePick = vi.fn().mockResolvedValue(undefined);
      useFestivalStore.setState({ savePick: mockSavePick } as never);
      const { result } = renderHook(() => usePicks());
      await act(async () => {
        await result.current.savePick('fest-1', 'set-1', 'must');
      });
      expect(mockSavePick).toHaveBeenCalledWith({
        festivalId: 'fest-1',
        setId: 'set-1',
        priority: 'must',
      });
    });
  });

  describe('removePick', () => {
    it('calls store removePick with correct args', async () => {
      const mockRemovePick = vi.fn().mockResolvedValue(undefined);
      useFestivalStore.setState({ removePick: mockRemovePick } as never);
      const { result } = renderHook(() => usePicks());
      await act(async () => {
        await result.current.removePick('fest-1', 'set-1');
      });
      expect(mockRemovePick).toHaveBeenCalledWith('fest-1', 'set-1');
    });
  });

  describe('saveNote', () => {
    it('calls store saveNote with correct request', async () => {
      const mockSaveNote = vi.fn().mockResolvedValue(undefined);
      useFestivalStore.setState({ saveNote: mockSaveNote } as never);
      const { result } = renderHook(() => usePicks());
      await act(async () => {
        await result.current.saveNote('fest-1', 'set-1', 'Great set!');
      });
      expect(mockSaveNote).toHaveBeenCalledWith({
        festivalId: 'fest-1',
        setId: 'set-1',
        note: 'Great set!',
      });
    });
  });
});
