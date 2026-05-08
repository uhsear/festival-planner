import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useScrollReset } from './useScrollReset';

describe('useScrollReset', () => {
  let rafCallbacks: FrameRequestCallback[];
  let rafIdCounter: number;
  let mainContent: HTMLDivElement;
  let parentScroller: HTMLDivElement;

  beforeEach(() => {
    rafCallbacks = [];
    rafIdCounter = 0;

    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      rafCallbacks.push(cb);
      return ++rafIdCounter;
    });
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});

    // Set up DOM: a parent scroller containing #main-content
    parentScroller = document.createElement('div');
    mainContent = document.createElement('div');
    mainContent.id = 'main-content';
    parentScroller.appendChild(mainContent);
    document.body.appendChild(parentScroller);

    // Give them non-zero scrollTop to verify reset
    Object.defineProperty(mainContent, 'scrollTop', { writable: true, value: 200 });
    Object.defineProperty(parentScroller, 'scrollTop', { writable: true, value: 150 });
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  // Helper to flush queued rAF callbacks
  function flushRafs() {
    while (rafCallbacks.length > 0) {
      const cb = rafCallbacks.shift()!;
      cb(performance.now());
    }
  }

  it('resets scrollTop on main-content immediately', () => {
    renderHook(({ path }) => useScrollReset(path), {
      initialProps: { path: '/page-a' },
    });

    expect(mainContent.scrollTop).toBe(0);
  });

  it('resets scrollTop on parent scroller when it has scrollTop > 0', () => {
    renderHook(({ path }) => useScrollReset(path), {
      initialProps: { path: '/page-a' },
    });

    expect(parentScroller.scrollTop).toBe(0);
  });

  it('resets again via rAF callbacks (double-rAF strategy)', () => {
    renderHook(({ path }) => useScrollReset(path), {
      initialProps: { path: '/page-a' },
    });

    // Simulate content re-scrolling after initial reset (lazy-loaded routes)
    mainContent.scrollTop = 100;
    parentScroller.scrollTop = 80;

    // Flush first rAF
    const cb1 = rafCallbacks.shift()!;
    cb1(performance.now());

    expect(mainContent.scrollTop).toBe(0);
    expect(parentScroller.scrollTop).toBe(0);

    // Second rAF should also reset
    mainContent.scrollTop = 50;
    const cb2 = rafCallbacks.shift()!;
    cb2(performance.now());

    expect(mainContent.scrollTop).toBe(0);
  });

  it('re-runs when pathname changes', () => {
    const { rerender } = renderHook(({ path }) => useScrollReset(path), {
      initialProps: { path: '/page-a' },
    });

    // After initial render, set scroll back
    mainContent.scrollTop = 300;
    parentScroller.scrollTop = 200;
    flushRafs();

    // Change route
    rerender({ path: '/page-b' });

    expect(mainContent.scrollTop).toBe(0);
  });

  it('does not crash when #main-content is missing', () => {
    document.body.innerHTML = ''; // Remove all elements

    expect(() => {
      renderHook(({ path }) => useScrollReset(path), {
        initialProps: { path: '/page-a' },
      });
    }).not.toThrow();
  });

  it('cancels rAF on cleanup (unmount)', () => {
    const { unmount } = renderHook(({ path }) => useScrollReset(path), {
      initialProps: { path: '/page-a' },
    });

    unmount();
    expect(window.cancelAnimationFrame).toHaveBeenCalled();
  });

  it('does not include parent in scroll list when its scrollTop is 0', () => {
    // Reset the DOM with a parent that has scrollTop = 0
    document.body.innerHTML = '';
    const parent = document.createElement('div');
    const child = document.createElement('div');
    child.id = 'main-content';
    parent.appendChild(child);
    document.body.appendChild(parent);

    // parent.scrollTop defaults to 0 so the hook should skip it.
    // We verify by checking that only main-content's scrollTop is reset,
    // and rAF callbacks don't touch the parent.
    Object.defineProperty(child, 'scrollTop', { writable: true, value: 100 });

    renderHook(({ path }) => useScrollReset(path), {
      initialProps: { path: '/page-a' },
    });

    expect(child.scrollTop).toBe(0);
    // parent.scrollTop should remain 0 (never touched)
    expect(parent.scrollTop).toBe(0);
  });
});
