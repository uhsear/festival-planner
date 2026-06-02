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
