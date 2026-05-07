import { describe, it, expect, beforeEach } from 'vitest';
import { useFestivalModeStore, isTodayFestivalDay } from './festivalModeStore';

describe('festivalModeStore', () => {
  beforeEach(() => {
    useFestivalModeStore.setState({
      isFestivalMode: false,
      festivalStarted: false,
      showPastSets: true,
      autoScrollToNow: false,
      manuallyDisabled: false,
    });
  });

  describe('initial state', () => {
    it('starts with festival mode off', () => {
      expect(useFestivalModeStore.getState().isFestivalMode).toBe(false);
    });

    it('starts with festivalStarted false', () => {
      expect(useFestivalModeStore.getState().festivalStarted).toBe(false);
    });

    it('starts showing past sets', () => {
      expect(useFestivalModeStore.getState().showPastSets).toBe(true);
    });

    it('starts with auto-scroll off', () => {
      expect(useFestivalModeStore.getState().autoScrollToNow).toBe(false);
    });

    it('starts not manually disabled', () => {
      expect(useFestivalModeStore.getState().manuallyDisabled).toBe(false);
    });
  });

  describe('toggleFestivalMode', () => {
    it('enables festival mode with correct side effects', () => {
      useFestivalModeStore.getState().toggleFestivalMode();
      const state = useFestivalModeStore.getState();
      expect(state.isFestivalMode).toBe(true);
      expect(state.showPastSets).toBe(false);
      expect(state.autoScrollToNow).toBe(true);
      expect(state.manuallyDisabled).toBe(false);
    });

    it('disables festival mode with correct side effects', () => {
      useFestivalModeStore.getState().toggleFestivalMode(); // enable
      useFestivalModeStore.getState().toggleFestivalMode(); // disable
      const state = useFestivalModeStore.getState();
      expect(state.isFestivalMode).toBe(false);
      expect(state.showPastSets).toBe(true);
      expect(state.autoScrollToNow).toBe(false);
      expect(state.manuallyDisabled).toBe(true);
    });
  });

  describe('setFestivalMode', () => {
    it('enables with correct side effects', () => {
      useFestivalModeStore.getState().setFestivalMode(true);
      const state = useFestivalModeStore.getState();
      expect(state.isFestivalMode).toBe(true);
      expect(state.showPastSets).toBe(false);
      expect(state.autoScrollToNow).toBe(true);
    });

    it('disables with correct side effects', () => {
      useFestivalModeStore.getState().setFestivalMode(true);
      useFestivalModeStore.getState().setFestivalMode(false);
      const state = useFestivalModeStore.getState();
      expect(state.isFestivalMode).toBe(false);
      expect(state.showPastSets).toBe(true);
      expect(state.autoScrollToNow).toBe(false);
    });

    it('is a no-op when setting to current value', () => {
      const before = useFestivalModeStore.getState();
      useFestivalModeStore.getState().setFestivalMode(false);
      const after = useFestivalModeStore.getState();
      expect(after.isFestivalMode).toBe(before.isFestivalMode);
    });
  });

  describe('setFestivalStarted', () => {
    it('sets festivalStarted to true', () => {
      useFestivalModeStore.getState().setFestivalStarted(true);
      expect(useFestivalModeStore.getState().festivalStarted).toBe(true);
    });

    it('sets festivalStarted to false', () => {
      useFestivalModeStore.getState().setFestivalStarted(true);
      useFestivalModeStore.getState().setFestivalStarted(false);
      expect(useFestivalModeStore.getState().festivalStarted).toBe(false);
    });
  });

  describe('toggleShowPastSets', () => {
    it('toggles from true to false', () => {
      expect(useFestivalModeStore.getState().showPastSets).toBe(true);
      useFestivalModeStore.getState().toggleShowPastSets();
      expect(useFestivalModeStore.getState().showPastSets).toBe(false);
    });

    it('toggles from false to true', () => {
      useFestivalModeStore.getState().toggleShowPastSets(); // false
      useFestivalModeStore.getState().toggleShowPastSets(); // true
      expect(useFestivalModeStore.getState().showPastSets).toBe(true);
    });
  });

  describe('toggleAutoScrollToNow', () => {
    it('toggles from false to true', () => {
      useFestivalModeStore.getState().toggleAutoScrollToNow();
      expect(useFestivalModeStore.getState().autoScrollToNow).toBe(true);
    });

    it('toggles from true to false', () => {
      useFestivalModeStore.getState().toggleAutoScrollToNow(); // true
      useFestivalModeStore.getState().toggleAutoScrollToNow(); // false
      expect(useFestivalModeStore.getState().autoScrollToNow).toBe(false);
    });
  });

  describe('persistence partialize', () => {
    it('only persists isFestivalMode and manuallyDisabled', () => {
      // The persist middleware is configured with partialize that only
      // includes isFestivalMode and manuallyDisabled. We verify via
      // the store's persist API.
      useFestivalModeStore.getState().setFestivalMode(true);
      useFestivalModeStore.getState().setFestivalStarted(true);

      // Zustand persist stores to localStorage under the configured key
      const stored = localStorage.getItem('festie-festival-mode-v2');
      expect(stored).toBeTruthy();
      const parsed = JSON.parse(stored!);
      // The state sub-object should only have the partialized keys
      expect(parsed.state).toHaveProperty('isFestivalMode');
      expect(parsed.state).toHaveProperty('manuallyDisabled');
      expect(parsed.state).not.toHaveProperty('festivalStarted');
      expect(parsed.state).not.toHaveProperty('showPastSets');
    });
  });
});

describe('isTodayFestivalDay', () => {
  it('returns false for empty array', () => {
    expect(isTodayFestivalDay([])).toBe(false);
  });

  it('returns false for null/undefined', () => {
    expect(isTodayFestivalDay(null as unknown as string[])).toBe(false);
    expect(isTodayFestivalDay(undefined as unknown as string[])).toBe(false);
  });

  it('returns true when today is in the list', () => {
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const today = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    expect(isTodayFestivalDay([today])).toBe(true);
  });

  it('returns false when today is not in the list', () => {
    expect(isTodayFestivalDay(['1999-01-01', '1999-01-02'])).toBe(false);
  });

  it('returns true when today is among multiple dates', () => {
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const today = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    expect(isTodayFestivalDay(['1999-01-01', today, '2099-12-31'])).toBe(true);
  });
});
