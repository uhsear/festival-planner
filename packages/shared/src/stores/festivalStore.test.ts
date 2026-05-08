import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useFestivalDataStore } from './festivalDataStore';
import { useFestivalUIStore } from './festivalUIStore';
import { useFestivalStore } from './festivalStore';

vi.mock('../services/api', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock('./resetStores', () => ({
  resetAllStores: vi.fn(),
}));

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

describe('festivalStore (facade)', () => {
  beforeEach(() => {
    resetStores();
    vi.clearAllMocks();
  });

  // ── getState merges both stores ─────────────────────────────────────

  describe('getState', () => {
    it('returns merged state from data and UI stores', () => {
      const state = useFestivalStore.getState();
      // Data store fields
      expect(state).toHaveProperty('festivals');
      expect(state).toHaveProperty('currentFestivalId');
      expect(state).toHaveProperty('currentFestival');
      expect(state).toHaveProperty('currentProfile');
      expect(state).toHaveProperty('allProfiles');
      expect(state).toHaveProperty('sets');
      expect(state).toHaveProperty('stages');
      expect(state).toHaveProperty('days');
      expect(state).toHaveProperty('isLoading');
      expect(state).toHaveProperty('error');
      // UI store fields
      expect(state).toHaveProperty('selectedDay');
      expect(state).toHaveProperty('activeStages');
      expect(state).toHaveProperty('searchQuery');
    });

    it('reflects current data store values', () => {
      useFestivalDataStore.setState({
        currentFestivalId: 'fest-1',
        isLoading: true,
        error: 'test-error',
      });
      const state = useFestivalStore.getState();
      expect(state.currentFestivalId).toBe('fest-1');
      expect(state.isLoading).toBe(true);
      expect(state.error).toBe('test-error');
    });

    it('reflects current UI store values', () => {
      useFestivalUIStore.setState({
        selectedDay: 2,
        activeStages: ['stage-a', 'stage-b'],
        searchQuery: 'headliner',
      });
      const state = useFestivalStore.getState();
      expect(state.selectedDay).toBe(2);
      expect(state.activeStages).toEqual(['stage-a', 'stage-b']);
      expect(state.searchQuery).toBe('headliner');
    });

    it('includes action functions from data store', () => {
      const state = useFestivalStore.getState();
      expect(typeof state.loadFestivals).toBe('function');
      expect(typeof state.selectFestival).toBe('function');
      expect(typeof state.loadProfiles).toBe('function');
      expect(typeof state.setCurrentProfile).toBe('function');
      expect(typeof state.savePick).toBe('function');
      expect(typeof state.removePick).toBe('function');
      expect(typeof state.saveNote).toBe('function');
      expect(typeof state.setError).toBe('function');
    });

    it('includes action functions from UI store', () => {
      const state = useFestivalStore.getState();
      expect(typeof state.setSelectedDay).toBe('function');
      expect(typeof state.setActiveStages).toBe('function');
      expect(typeof state.setSearchQuery).toBe('function');
    });
  });

  // ── setState routes fields to correct store ─────────────────────────

  describe('setState', () => {
    it('routes data fields to the data store', () => {
      useFestivalStore.setState({ currentFestivalId: 'fest-99', isLoading: true });
      expect(useFestivalDataStore.getState().currentFestivalId).toBe('fest-99');
      expect(useFestivalDataStore.getState().isLoading).toBe(true);
    });

    it('routes UI fields to the UI store', () => {
      useFestivalStore.setState({ selectedDay: 3, searchQuery: 'rock' });
      expect(useFestivalUIStore.getState().selectedDay).toBe(3);
      expect(useFestivalUIStore.getState().searchQuery).toBe('rock');
    });

    it('routes mixed fields to their respective stores', () => {
      useFestivalStore.setState({
        currentFestivalId: 'fest-42',
        selectedDay: 1,
        activeStages: ['s1'],
        error: 'mixed-test',
      });
      expect(useFestivalDataStore.getState().currentFestivalId).toBe('fest-42');
      expect(useFestivalDataStore.getState().error).toBe('mixed-test');
      expect(useFestivalUIStore.getState().selectedDay).toBe(1);
      expect(useFestivalUIStore.getState().activeStages).toEqual(['s1']);
    });

    it('does not call setState on stores with no matching fields', () => {
      const dataSpy = vi.spyOn(useFestivalDataStore, 'setState');
      const uiSpy = vi.spyOn(useFestivalUIStore, 'setState');

      useFestivalStore.setState({ selectedDay: 5 });
      // Only UI store should have been called
      expect(uiSpy).toHaveBeenCalledTimes(1);
      expect(dataSpy).not.toHaveBeenCalled();

      dataSpy.mockRestore();
      uiSpy.mockRestore();
    });

    it('ignores unknown fields silently', () => {
      // Should not throw
      useFestivalStore.setState({ unknownField: 'value' } as Partial<never>);
      // State should be unchanged
      expect(useFestivalDataStore.getState().currentFestivalId).toBeNull();
      expect(useFestivalUIStore.getState().selectedDay).toBe(0);
    });
  });

  // ── Live merge: getState reflects updates from underlying stores ────

  describe('live merge', () => {
    it('getState picks up data store changes immediately', () => {
      useFestivalDataStore.setState({ currentFestivalId: 'live-1' });
      expect(useFestivalStore.getState().currentFestivalId).toBe('live-1');
    });

    it('getState picks up UI store changes immediately', () => {
      useFestivalUIStore.setState({ selectedDay: 7 });
      expect(useFestivalStore.getState().selectedDay).toBe(7);
    });

    it('calling an action through the facade updates the underlying store', () => {
      useFestivalStore.getState().setSelectedDay(4);
      expect(useFestivalUIStore.getState().selectedDay).toBe(4);
      expect(useFestivalStore.getState().selectedDay).toBe(4);
    });

    it('calling setError through the facade updates data store', () => {
      useFestivalStore.getState().setError('facade-error');
      expect(useFestivalDataStore.getState().error).toBe('facade-error');
      expect(useFestivalStore.getState().error).toBe('facade-error');
    });

    it('calling setActiveStages through the facade updates UI store', () => {
      useFestivalStore.getState().setActiveStages(['s1', 's2']);
      expect(useFestivalUIStore.getState().activeStages).toEqual(['s1', 's2']);
      expect(useFestivalStore.getState().activeStages).toEqual(['s1', 's2']);
    });

    it('calling setSearchQuery through the facade updates UI store', () => {
      useFestivalStore.getState().setSearchQuery('jazz');
      expect(useFestivalUIStore.getState().searchQuery).toBe('jazz');
      expect(useFestivalStore.getState().searchQuery).toBe('jazz');
    });
  });

  // ── Type exports ────────────────────────────────────────────────────

  describe('type re-exports', () => {
    it('re-exports useFestivalDataStore', async () => {
      const mod = await import('./festivalStore');
      expect(mod.useFestivalDataStore).toBe(useFestivalDataStore);
    });

    it('re-exports useFestivalUIStore', async () => {
      const mod = await import('./festivalStore');
      expect(mod.useFestivalUIStore).toBe(useFestivalUIStore);
    });
  });
});
