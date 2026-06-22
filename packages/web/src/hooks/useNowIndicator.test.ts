import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useNowIndicator } from './useNowIndicator';
import type { TimeBounds } from './useTimelineFilters';

describe('useNowIndicator', () => {
  let _rafCallback: FrameRequestCallback | null;

  beforeEach(() => {
    vi.useFakeTimers();
    _rafCallback = null;
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      _rafCallback = cb;
      return 1;
    });
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  function makeBounds(minMin: number, maxMin: number): TimeBounds {
    return {
      minMin,
      maxMin,
      totalSlots: Math.ceil((maxMin - minMin) / 15),
    };
  }

  it('returns null when timeBounds is null', () => {
    const { result } = renderHook(() => useNowIndicator(null, 0));
    expect(result.current.nowIndicator).toBeNull();
  });

  it('returns null when current time is outside time bounds', () => {
    // Set "now" to 8:00 AM (480 min), bounds 600..960 (10AM-4PM)
    vi.setSystemTime(new Date(2026, 5, 15, 8, 0, 0));
    const bounds = makeBounds(600, 960);
    const { result } = renderHook(() => useNowIndicator(bounds, 0));
    expect(result.current.nowIndicator).toBeNull();
  });

  it('returns 0% when current time equals the start of bounds', () => {
    // "now" = 10:00 AM (600 min), bounds 600..960
    vi.setSystemTime(new Date(2026, 5, 15, 10, 0, 0));
    const bounds = makeBounds(600, 960);
    const { result } = renderHook(() => useNowIndicator(bounds, 0));
    expect(result.current.nowIndicator).toBe(0);
  });

  it('returns 50% when current time is at the midpoint', () => {
    // bounds 600..960, midpoint = 780 = 1:00 PM
    vi.setSystemTime(new Date(2026, 5, 15, 13, 0, 0));
    const bounds = makeBounds(600, 960);
    const { result } = renderHook(() => useNowIndicator(bounds, 0));
    expect(result.current.nowIndicator).toBe(50);
  });

  it('returns 100% when current time equals the end of bounds', () => {
    // "now" = 4:00 PM (960 min), bounds 600..960
    vi.setSystemTime(new Date(2026, 5, 15, 16, 0, 0));
    const bounds = makeBounds(600, 960);
    const { result } = renderHook(() => useNowIndicator(bounds, 0));
    expect(result.current.nowIndicator).toBe(100);
  });

  it('updates nowIndicator every 30 seconds', () => {
    // Start at 12:00 (720 min), bounds 600..960 => (720-600)/(960-600)*100 = 33.33%
    vi.setSystemTime(new Date(2026, 5, 15, 12, 0, 0));
    const bounds = makeBounds(600, 960);
    const { result } = renderHook(() => useNowIndicator(bounds, 0));

    const initial = result.current.nowIndicator;
    expect(initial).toBeCloseTo(33.33, 1);

    // Advance 30 seconds + shift system time by 1 minute to see a change
    vi.setSystemTime(new Date(2026, 5, 15, 12, 1, 0));
    act(() => {
      vi.advanceTimersByTime(30_000);
    });

    const updated = result.current.nowIndicator;
    // 721 min => (721-600)/(960-600)*100 ≈ 33.61%
    expect(updated).toBeCloseTo(33.61, 1);
    expect(updated).not.toBe(initial);
  });

  it('provides a gridRef', () => {
    const { result } = renderHook(() => useNowIndicator(null, 0));
    expect(result.current.gridRef).toBeDefined();
    expect(result.current.gridRef.current).toBeNull();
  });

  it('provides a scrollToNow function', () => {
    const { result } = renderHook(() => useNowIndicator(null, 0));
    expect(typeof result.current.scrollToNow).toBe('function');
  });

  it('scrollToNow scrolls the now-line into view', () => {
    vi.setSystemTime(new Date(2026, 5, 15, 13, 0, 0));
    const bounds = makeBounds(600, 960);
    const { result } = renderHook(() => useNowIndicator(bounds, 0));

    // Set up a mock grid element with a .timeline-now-label child
    const mockGrid = document.createElement('div');
    const nowLine = document.createElement('div');
    nowLine.className = 'timeline-now-label';
    nowLine.scrollIntoView = vi.fn();
    mockGrid.appendChild(nowLine);

    // Assign to the gridRef
    Object.defineProperty(result.current.gridRef, 'current', {
      writable: true,
      value: mockGrid,
    });

    act(() => {
      result.current.scrollToNow();
    });

    expect(nowLine.scrollIntoView).toHaveBeenCalledWith({
      behavior: 'smooth',
      block: 'center',
    });
  });

  it('scrollToNow is safe to call when gridRef is null', () => {
    vi.setSystemTime(new Date(2026, 5, 15, 13, 0, 0));
    const bounds = makeBounds(600, 960);
    const { result } = renderHook(() => useNowIndicator(bounds, 0));

    expect(() => {
      act(() => {
        result.current.scrollToNow();
      });
    }).not.toThrow();
  });

  it('cleans up the interval on unmount', () => {
    const clearSpy = vi.spyOn(window, 'clearInterval');
    const { unmount } = renderHook(() => useNowIndicator(null, 0));
    unmount();
    expect(clearSpy).toHaveBeenCalled();
  });

  it('calculates percentage correctly for narrow bounds', () => {
    // bounds 720..780 (12PM-1PM), now = 12:30 => 50%
    vi.setSystemTime(new Date(2026, 5, 15, 12, 30, 0));
    const bounds = makeBounds(720, 780);
    const { result } = renderHook(() => useNowIndicator(bounds, 0));
    expect(result.current.nowIndicator).toBe(50);
  });
});
