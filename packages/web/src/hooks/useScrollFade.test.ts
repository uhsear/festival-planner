import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useScrollFade } from './useScrollFade';

describe('useScrollFade', () => {
  let _rafCallback: FrameRequestCallback | null = null;

  beforeEach(() => {
    _rafCallback = null;
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      _rafCallback = cb;
      return 1;
    });
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
    vi.spyOn(window, 'addEventListener').mockImplementation(() => {});
    vi.spyOn(window, 'removeEventListener').mockImplementation(() => {});
  });

  it('returns a ref, scroll state booleans, and check function', () => {
    const { result } = renderHook(() => useScrollFade());
    expect(result.current.ref).toBeDefined();
    expect(typeof result.current.canScrollLeft).toBe('boolean');
    expect(typeof result.current.canScrollRight).toBe('boolean');
    expect(typeof result.current.check).toBe('function');
  });

  it('initializes with canScrollLeft=false and canScrollRight=false', () => {
    const { result } = renderHook(() => useScrollFade());
    expect(result.current.canScrollLeft).toBe(false);
    expect(result.current.canScrollRight).toBe(false);
  });

  it('detects right scroll availability when content overflows', () => {
    const { result } = renderHook(() => useScrollFade<HTMLDivElement>());

    // Simulate a DOM element with overflow
    const mockEl = {
      scrollLeft: 0,
      clientWidth: 200,
      scrollWidth: 500,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    } as unknown as HTMLDivElement;

    // Manually assign the ref
    Object.defineProperty(result.current.ref, 'current', {
      writable: true,
      value: mockEl,
    });

    act(() => {
      result.current.check();
    });

    expect(result.current.canScrollLeft).toBe(false);
    expect(result.current.canScrollRight).toBe(true);
  });

  it('detects left scroll availability when scrolled right', () => {
    const { result } = renderHook(() => useScrollFade<HTMLDivElement>());

    const mockEl = {
      scrollLeft: 100,
      clientWidth: 200,
      scrollWidth: 500,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    } as unknown as HTMLDivElement;

    Object.defineProperty(result.current.ref, 'current', {
      writable: true,
      value: mockEl,
    });

    act(() => {
      result.current.check();
    });

    expect(result.current.canScrollLeft).toBe(true);
    expect(result.current.canScrollRight).toBe(true);
  });

  it('reports no scrolling when content fits within container', () => {
    const { result } = renderHook(() => useScrollFade<HTMLDivElement>());

    const mockEl = {
      scrollLeft: 0,
      clientWidth: 500,
      scrollWidth: 500,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    } as unknown as HTMLDivElement;

    Object.defineProperty(result.current.ref, 'current', {
      writable: true,
      value: mockEl,
    });

    act(() => {
      result.current.check();
    });

    expect(result.current.canScrollLeft).toBe(false);
    expect(result.current.canScrollRight).toBe(false);
  });

  it('uses 2px threshold to absorb sub-pixel rounding', () => {
    const { result } = renderHook(() => useScrollFade<HTMLDivElement>());

    // scrollLeft of 1 should NOT trigger canScrollLeft (below 2px threshold)
    const mockEl = {
      scrollLeft: 1,
      clientWidth: 200,
      scrollWidth: 203, // difference of 2 — at threshold, should be false
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    } as unknown as HTMLDivElement;

    Object.defineProperty(result.current.ref, 'current', {
      writable: true,
      value: mockEl,
    });

    act(() => {
      result.current.check();
    });

    expect(result.current.canScrollLeft).toBe(false);
    expect(result.current.canScrollRight).toBe(false);
  });

  it('detects scroll when past the 2px threshold', () => {
    const { result } = renderHook(() => useScrollFade<HTMLDivElement>());

    const mockEl = {
      scrollLeft: 5,
      clientWidth: 200,
      scrollWidth: 500,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    } as unknown as HTMLDivElement;

    Object.defineProperty(result.current.ref, 'current', {
      writable: true,
      value: mockEl,
    });

    act(() => {
      result.current.check();
    });

    expect(result.current.canScrollLeft).toBe(true);
    expect(result.current.canScrollRight).toBe(true);
  });

  it('is safe to call check when ref is null', () => {
    const { result } = renderHook(() => useScrollFade());
    // Should not throw
    act(() => {
      result.current.check();
    });
    expect(result.current.canScrollLeft).toBe(false);
    expect(result.current.canScrollRight).toBe(false);
  });
});
