import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useOffline } from '../useOffline';
import { useUIStore } from '../../stores/uiStore';

function resetStore() {
  useUIStore.setState({
    offlineMode: false,
    pendingSync: 0,
  });
}

describe('useOffline hook', () => {
  beforeEach(() => {
    resetStore();
    localStorage.clear();
    // Ensure navigator.onLine starts as true
    Object.defineProperty(navigator, 'onLine', { writable: true, value: true });
  });

  it('returns isOffline=false when online', () => {
    const { result } = renderHook(() => useOffline());
    expect(result.current.isOffline).toBe(false);
  });

  it('returns pendingSync from store', () => {
    useUIStore.setState({ pendingSync: 3 });
    const { result } = renderHook(() => useOffline());
    expect(result.current.pendingSync).toBe(3);
  });

  it('responds to online event', () => {
    Object.defineProperty(navigator, 'onLine', { writable: true, value: false });
    const { result } = renderHook(() => useOffline());
    expect(result.current.isOffline).toBe(true);

    act(() => {
      Object.defineProperty(navigator, 'onLine', { writable: true, value: true });
      window.dispatchEvent(new Event('online'));
    });
    expect(result.current.isOffline).toBe(false);
  });

  it('responds to offline event', () => {
    const { result } = renderHook(() => useOffline());
    expect(result.current.isOffline).toBe(false);

    act(() => {
      window.dispatchEvent(new Event('offline'));
    });
    expect(result.current.isOffline).toBe(true);
  });

  it('sets offlineMode in store on offline event', () => {
    renderHook(() => useOffline());
    act(() => {
      window.dispatchEvent(new Event('offline'));
    });
    expect(useUIStore.getState().offlineMode).toBe(true);
  });

  it('clears offlineMode in store on online event', () => {
    useUIStore.setState({ offlineMode: true });
    renderHook(() => useOffline());
    act(() => {
      window.dispatchEvent(new Event('online'));
    });
    expect(useUIStore.getState().offlineMode).toBe(false);
  });

  describe('saveSnapshot', () => {
    it('saves data to localStorage', () => {
      const { result } = renderHook(() => useOffline());
      act(() => {
        result.current.saveSnapshot({ festivals: [{ id: '1' }] });
      });
      const stored = JSON.parse(localStorage.getItem('festie-offline-snapshot')!);
      expect(stored.data).toEqual({ festivals: [{ id: '1' }] });
      expect(stored.timestamp).toBeTypeOf('number');
    });
  });

  describe('restoreSnapshot', () => {
    it('returns null when no snapshot exists', () => {
      const { result } = renderHook(() => useOffline());
      expect(result.current.restoreSnapshot()).toBeNull();
    });

    it('returns saved snapshot', () => {
      const snapshot = { timestamp: Date.now(), data: { test: true } };
      localStorage.setItem('festie-offline-snapshot', JSON.stringify(snapshot));
      const { result } = renderHook(() => useOffline());
      const restored = result.current.restoreSnapshot();
      expect(restored).not.toBeNull();
      expect(restored!.data).toEqual({ test: true });
    });

    it('returns null for invalid JSON', () => {
      localStorage.setItem('festie-offline-snapshot', 'not-json');
      const { result } = renderHook(() => useOffline());
      expect(result.current.restoreSnapshot()).toBeNull();
    });
  });

  it('cleans up event listeners on unmount', () => {
    const removeSpy = vi.spyOn(window, 'removeEventListener');
    const { unmount } = renderHook(() => useOffline());
    unmount();
    const calls = removeSpy.mock.calls.map((c) => c[0]);
    expect(calls).toContain('online');
    expect(calls).toContain('offline');
    removeSpy.mockRestore();
  });
});
