import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// We need to mock localStorage and UA detection before importing the hook.
// The hook reads `isIOSSafari()` and `isStandalone()` at effect time, so we
// control them through the environment (navigator.userAgent, matchMedia, etc.).

// ---- helpers to swap userAgent ----
function setUserAgent(ua: string) {
  Object.defineProperty(navigator, 'userAgent', {
    writable: true,
    configurable: true,
    value: ua,
  });
}

const IOS_SAFARI_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const ANDROID_UA =
  'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';
const IOS_CHROME_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/120.0.0.0 Mobile/15E148 Safari/604.1';
const IOS_INSTAGRAM_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram';

describe('useIOSInstall', () => {
  let originalUA: string;
  let localStorageData: Record<string, string>;

  beforeEach(() => {
    vi.useFakeTimers();
    originalUA = navigator.userAgent;
    localStorageData = {};

    // Mock localStorage
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(
      (key: string) => localStorageData[key] ?? null,
    );
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(
      (key: string, value: string) => { localStorageData[key] = value; },
    );

    // Ensure matchMedia returns standalone=false by default (from test-setup)
    vi.mocked(window.matchMedia).mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
  });

  afterEach(() => {
    vi.useRealTimers();
    setUserAgent(originalUA);
    vi.restoreAllMocks();
  });

  // Fresh import each test to reset module-level state
  async function importHook() {
    // Clear the module cache so the hook re-evaluates isIOSSafari etc.
    vi.resetModules();
    const mod = await import('./useIOSInstall');
    return mod.useIOSInstall;
  }

  it('does not show on non-iOS browsers', async () => {
    setUserAgent(ANDROID_UA);
    const useIOSInstall = await importHook();
    const { result } = renderHook(() => useIOSInstall());
    expect(result.current.shouldShow).toBe(false);
  });

  it('does not show on iOS Chrome (CriOS)', async () => {
    setUserAgent(IOS_CHROME_UA);
    const useIOSInstall = await importHook();
    const { result } = renderHook(() => useIOSInstall());
    expect(result.current.shouldShow).toBe(false);
  });

  it('does not show on in-app browsers (Instagram)', async () => {
    setUserAgent(IOS_INSTAGRAM_UA);
    const useIOSInstall = await importHook();
    const { result } = renderHook(() => useIOSInstall());
    expect(result.current.shouldShow).toBe(false);
  });

  it('does not show when already installed (standalone)', async () => {
    setUserAgent(IOS_SAFARI_UA);
    // Simulate standalone mode
    vi.mocked(window.matchMedia).mockImplementation((query: string) => ({
      matches: query === '(display-mode: standalone)',
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
    const useIOSInstall = await importHook();
    const { result } = renderHook(() => useIOSInstall());
    expect(result.current.shouldShow).toBe(false);
  });

  it('shows after engagement gate (10s + 1 interaction) on iOS Safari', async () => {
    setUserAgent(IOS_SAFARI_UA);
    const useIOSInstall = await importHook();
    const { result } = renderHook(() => useIOSInstall());

    // Initially not shown
    expect(result.current.shouldShow).toBe(false);

    // Simulate a user interaction
    act(() => {
      window.dispatchEvent(new Event('pointerdown'));
    });

    // Still not shown — need to wait 10s
    expect(result.current.shouldShow).toBe(false);

    // Advance past the 10s engagement timer
    act(() => {
      vi.advanceTimersByTime(10_000);
    });

    expect(result.current.shouldShow).toBe(true);
  });

  it('shows when timer fires first, then interaction happens', async () => {
    setUserAgent(IOS_SAFARI_UA);
    const useIOSInstall = await importHook();
    const { result } = renderHook(() => useIOSInstall());

    // Timer fires first
    act(() => {
      vi.advanceTimersByTime(10_000);
    });

    // Not shown yet — no interaction
    expect(result.current.shouldShow).toBe(false);

    // Now interact
    act(() => {
      window.dispatchEvent(new Event('pointerdown'));
    });

    expect(result.current.shouldShow).toBe(true);
  });

  it('dismiss sets shouldShow to false and writes dismissed-at to localStorage', async () => {
    setUserAgent(IOS_SAFARI_UA);
    const useIOSInstall = await importHook();
    const { result } = renderHook(() => useIOSInstall());

    // Trigger the prompt
    act(() => {
      window.dispatchEvent(new Event('pointerdown'));
      vi.advanceTimersByTime(10_000);
    });
    expect(result.current.shouldShow).toBe(true);

    // Dismiss
    act(() => {
      result.current.dismiss('close');
    });

    expect(result.current.shouldShow).toBe(false);
    expect(localStorageData['fp:install:ios-dismissed-at']).toBeDefined();
  });

  it('does not show when within the 30-day cooldown', async () => {
    setUserAgent(IOS_SAFARI_UA);
    // Simulate a recent dismissal (1 day ago)
    const oneDayAgo = Date.now() - 1 * 24 * 60 * 60 * 1000;
    localStorageData['fp:install:ios-dismissed-at'] = String(oneDayAgo);

    const useIOSInstall = await importHook();
    const { result } = renderHook(() => useIOSInstall());

    act(() => {
      window.dispatchEvent(new Event('pointerdown'));
      vi.advanceTimersByTime(10_000);
    });

    expect(result.current.shouldShow).toBe(false);
  });

  it('does not show when max show count (3) is reached', async () => {
    setUserAgent(IOS_SAFARI_UA);
    localStorageData['fp:install:ios-show-count'] = '3';

    const useIOSInstall = await importHook();
    const { result } = renderHook(() => useIOSInstall());

    act(() => {
      window.dispatchEvent(new Event('pointerdown'));
      vi.advanceTimersByTime(10_000);
    });

    expect(result.current.shouldShow).toBe(false);
  });

  it('increments show count when prompt is displayed', async () => {
    setUserAgent(IOS_SAFARI_UA);
    localStorageData['fp:install:ios-show-count'] = '1';

    const useIOSInstall = await importHook();
    renderHook(() => useIOSInstall());

    act(() => {
      window.dispatchEvent(new Event('pointerdown'));
      vi.advanceTimersByTime(10_000);
    });

    expect(localStorageData['fp:install:ios-show-count']).toBe('2');
  });

  it('touchstart also counts as an interaction', async () => {
    setUserAgent(IOS_SAFARI_UA);
    const useIOSInstall = await importHook();
    const { result } = renderHook(() => useIOSInstall());

    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(result.current.shouldShow).toBe(false);

    act(() => {
      window.dispatchEvent(new Event('touchstart'));
    });

    expect(result.current.shouldShow).toBe(true);
  });
});
