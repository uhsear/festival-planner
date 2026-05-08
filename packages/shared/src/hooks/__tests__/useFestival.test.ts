import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useFestival } from '../useFestival';
import { useFestivalDataStore } from '../../stores/festivalDataStore';
import { useFestivalUIStore } from '../../stores/festivalUIStore';

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

const stage1 = { id: 's1', name: 'Main Stage', color: '#ff0000', festivalId: 'f1', createdAt: '', updatedAt: '' };
const stage2 = { id: 's2', name: 'Side Stage', color: '#00ff00', festivalId: 'f1', createdAt: '', updatedAt: '' };

const day1 = { id: 'd1', festivalId: 'f1', date: '2026-06-01', label: 'Friday', createdAt: '', updatedAt: '' };
const day2 = { id: 'd2', festivalId: 'f1', date: '2026-06-02', label: 'Saturday', createdAt: '', updatedAt: '' };

const set1 = {
  id: 'set-1', festivalId: 'f1', stageId: 's1', startTime: '14:00', endTime: '15:00',
  artist: 'Daft Punk', dayIndex: 0, date: '2026-06-01', createdAt: '', updatedAt: '',
};
const set2 = {
  id: 'set-2', festivalId: 'f1', stageId: 's2', startTime: '16:00', endTime: '17:00',
  artist: 'Deadmau5', dayIndex: 0, date: '2026-06-01', createdAt: '', updatedAt: '',
};
const set3 = {
  id: 'set-3', festivalId: 'f1', stageId: 's1', startTime: '14:00', endTime: '15:00',
  artist: 'Avicii', dayIndex: 1, date: '2026-06-02', createdAt: '', updatedAt: '',
};

function resetStores() {
  useFestivalDataStore.setState({
    festivals: [],
    currentFestivalId: null,
    currentFestival: null,
    currentProfile: null,
    allProfiles: [],
    sets: [],
    stages: [],
    days: [],
    isLoading: false,
    error: null,
  });
  useFestivalUIStore.setState({
    selectedDay: 0,
    activeStages: [],
    searchQuery: '',
  });
}

describe('useFestival hook', () => {
  beforeEach(() => {
    resetStores();
    vi.clearAllMocks();
  });

  describe('getDays', () => {
    it('returns empty array when no days', () => {
      const { result } = renderHook(() => useFestival());
      expect(result.current.getDays()).toEqual([]);
    });

    it('returns days with index, date, and label', () => {
      useFestivalDataStore.setState({ days: [day1, day2] });
      const { result } = renderHook(() => useFestival());
      const days = result.current.getDays();
      expect(days).toHaveLength(2);
      expect(days[0]).toEqual({ index: 0, date: '2026-06-01', label: 'Friday' });
      expect(days[1]).toEqual({ index: 1, date: '2026-06-02', label: 'Saturday' });
    });

    it('uses date as label fallback when label is missing', () => {
      useFestivalDataStore.setState({
        days: [{ ...day1, label: undefined }],
      });
      const { result } = renderHook(() => useFestival());
      const days = result.current.getDays();
      expect(days[0]!.label).toBe('2026-06-01');
    });
  });

  describe('getCurrentDaySets', () => {
    it('returns sets matching the selected day index', () => {
      useFestivalDataStore.setState({ sets: [set1, set2, set3], days: [day1, day2] });
      useFestivalUIStore.setState({ selectedDay: 0 });
      const { result } = renderHook(() => useFestival());
      const daySets = result.current.getCurrentDaySets();
      expect(daySets).toHaveLength(2);
      expect(daySets.map((s) => s.id)).toEqual(['set-1', 'set-2']);
    });

    it('returns only day 2 sets when selectedDay is 1', () => {
      useFestivalDataStore.setState({ sets: [set1, set2, set3], days: [day1, day2] });
      useFestivalUIStore.setState({ selectedDay: 1 });
      const { result } = renderHook(() => useFestival());
      const daySets = result.current.getCurrentDaySets();
      expect(daySets).toHaveLength(1);
      expect(daySets[0]!.id).toBe('set-3');
    });

    it('returns empty when selectedDay is out of range (negative)', () => {
      useFestivalDataStore.setState({ sets: [set1], days: [day1] });
      useFestivalUIStore.setState({ selectedDay: -1 });
      const { result } = renderHook(() => useFestival());
      expect(result.current.getCurrentDaySets()).toEqual([]);
    });

    it('returns empty when selectedDay exceeds days length', () => {
      useFestivalDataStore.setState({ sets: [set1], days: [day1] });
      useFestivalUIStore.setState({ selectedDay: 5 });
      const { result } = renderHook(() => useFestival());
      expect(result.current.getCurrentDaySets()).toEqual([]);
    });
  });

  describe('getFilteredSets', () => {
    it('returns all sets for the day when no filter is active', () => {
      useFestivalDataStore.setState({ sets: [set1, set2, set3], days: [day1, day2], stages: [stage1, stage2] });
      useFestivalUIStore.setState({ selectedDay: 0, activeStages: ['s1', 's2'], searchQuery: '' });
      const { result } = renderHook(() => useFestival());
      expect(result.current.getFilteredSets()).toHaveLength(2);
    });

    it('filters by active stages when only some stages are selected', () => {
      useFestivalDataStore.setState({ sets: [set1, set2], days: [day1], stages: [stage1, stage2] });
      useFestivalUIStore.setState({ selectedDay: 0, activeStages: ['s1'], searchQuery: '' });
      const { result } = renderHook(() => useFestival());
      const filtered = result.current.getFilteredSets();
      expect(filtered).toHaveLength(1);
      expect(filtered[0]!.stageId).toBe('s1');
    });

    it('does not filter by stage when ALL stages are active', () => {
      useFestivalDataStore.setState({ sets: [set1, set2], days: [day1], stages: [stage1, stage2] });
      useFestivalUIStore.setState({ selectedDay: 0, activeStages: ['s1', 's2'], searchQuery: '' });
      const { result } = renderHook(() => useFestival());
      expect(result.current.getFilteredSets()).toHaveLength(2);
    });

    it('filters by search query matching artist name', () => {
      useFestivalDataStore.setState({ sets: [set1, set2], days: [day1], stages: [stage1, stage2] });
      useFestivalUIStore.setState({ selectedDay: 0, activeStages: ['s1', 's2'], searchQuery: 'daft' });
      const { result } = renderHook(() => useFestival());
      const filtered = result.current.getFilteredSets();
      expect(filtered).toHaveLength(1);
      expect(filtered[0]!.artist).toBe('Daft Punk');
    });

    it('filters by search query matching stage name', () => {
      useFestivalDataStore.setState({ sets: [set1, set2], days: [day1], stages: [stage1, stage2] });
      useFestivalUIStore.setState({ selectedDay: 0, activeStages: ['s1', 's2'], searchQuery: 'side' });
      const { result } = renderHook(() => useFestival());
      const filtered = result.current.getFilteredSets();
      expect(filtered).toHaveLength(1);
      expect(filtered[0]!.stageId).toBe('s2');
    });

    it('search is case-insensitive', () => {
      useFestivalDataStore.setState({ sets: [set1], days: [day1], stages: [stage1] });
      useFestivalUIStore.setState({ selectedDay: 0, activeStages: ['s1'], searchQuery: 'DAFT' });
      const { result } = renderHook(() => useFestival());
      expect(result.current.getFilteredSets()).toHaveLength(1);
    });

    it('returns empty when search matches nothing', () => {
      useFestivalDataStore.setState({ sets: [set1], days: [day1], stages: [stage1] });
      useFestivalUIStore.setState({ selectedDay: 0, activeStages: ['s1'], searchQuery: 'zzzzz' });
      const { result } = renderHook(() => useFestival());
      expect(result.current.getFilteredSets()).toHaveLength(0);
    });

    it('searches within artists array names', () => {
      const setWithArtists = {
        ...set1,
        artist: undefined,
        artists: [{ name: 'Bob Moses' }, { name: 'Lane 8' }],
      };
      useFestivalDataStore.setState({ sets: [setWithArtists], days: [day1], stages: [stage1] });
      useFestivalUIStore.setState({ selectedDay: 0, activeStages: ['s1'], searchQuery: 'lane' });
      const { result } = renderHook(() => useFestival());
      expect(result.current.getFilteredSets()).toHaveLength(1);
    });
  });

  describe('getStageColor', () => {
    it('returns the stage color', () => {
      useFestivalDataStore.setState({ stages: [stage1] });
      const { result } = renderHook(() => useFestival());
      expect(result.current.getStageColor('s1')).toBe('#ff0000');
    });

    it('returns default color for unknown stage', () => {
      useFestivalDataStore.setState({ stages: [stage1] });
      const { result } = renderHook(() => useFestival());
      expect(result.current.getStageColor('unknown')).toBe('var(--text-muted)');
    });

    it('returns default when stage has no color', () => {
      useFestivalDataStore.setState({
        stages: [{ ...stage1, color: undefined }],
      });
      const { result } = renderHook(() => useFestival());
      expect(result.current.getStageColor('s1')).toBe('var(--text-muted)');
    });
  });

  describe('getStageName', () => {
    it('returns the stage name', () => {
      useFestivalDataStore.setState({ stages: [stage1] });
      const { result } = renderHook(() => useFestival());
      expect(result.current.getStageName('s1')).toBe('Main Stage');
    });

    it('returns undefined for unknown stage', () => {
      useFestivalDataStore.setState({ stages: [stage1] });
      const { result } = renderHook(() => useFestival());
      expect(result.current.getStageName('unknown')).toBeUndefined();
    });
  });
});
