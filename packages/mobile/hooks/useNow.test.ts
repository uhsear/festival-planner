import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { subscribeInterval, getNow, __resetForTests } from './useNow';

// `useNow.ts` imports `react-native` (for AppState) at module scope. This
// package's vitest config runs `environment: 'node'` with no RN/Flow
// transform (see vitest.config.ts), so the REAL `react-native` package fails
// to parse here ("Flow is not supported") and `useNow()` itself cannot be
// rendered (no React renderer is available either). Mocking the one RN import
// (hoisted above these imports by vitest, same as Jest) lets the module load
// so the shared-timer singleton logic — the actual subject of this defect —
// can be exercised directly via its exported `subscribeInterval`/`getNow`
// functions, the same ones `useNow` calls internally.
vi.mock('react-native', () => ({
  AppState: { addEventListener: vi.fn(() => ({ remove: vi.fn() })) },
}));

describe('useNow shared clock', () => {
  beforeEach(() => {
    __resetForTests();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('shares exactly one setInterval across multiple subscribers at the same intervalMs', () => {
    const setIntervalSpy = vi.spyOn(global, 'setInterval');
    const listenerA = vi.fn();
    const listenerB = vi.fn();

    // Models two mounted SetCardMobile rows, both going through
    // useSetStatus's useNow(60_000).
    subscribeInterval(60_000, listenerA);
    subscribeInterval(60_000, listenerB);

    expect(setIntervalSpy).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(60_000);

    // Both consumers observe the one shared tick.
    expect(listenerA).toHaveBeenCalledTimes(1);
    expect(listenerB).toHaveBeenCalledTimes(1);
  });

  it('tears the timer down only once the last subscriber leaves', () => {
    const clearIntervalSpy = vi.spyOn(global, 'clearInterval');
    const unsubscribeA = subscribeInterval(60_000, vi.fn());
    const unsubscribeB = subscribeInterval(60_000, vi.fn());

    unsubscribeA();
    // A sibling consumer (e.g. grid.tsx's useNow(60_000)) is still mounted.
    expect(clearIntervalSpy).not.toHaveBeenCalled();

    unsubscribeB();
    expect(clearIntervalSpy).toHaveBeenCalledTimes(1);
  });

  it('creates independent buckets per distinct intervalMs (30s callers do not share the 60s bucket)', () => {
    const setIntervalSpy = vi.spyOn(global, 'setInterval');
    const listener30 = vi.fn();
    const listener60 = vi.fn();

    subscribeInterval(30_000, listener30);
    subscribeInterval(60_000, listener60);

    expect(setIntervalSpy).toHaveBeenCalledTimes(2);

    // Advancing only 30s should tick the 30s bucket, not the 60s one.
    vi.advanceTimersByTime(30_000);
    expect(listener30).toHaveBeenCalledTimes(1);
    expect(listener60).not.toHaveBeenCalled();

    vi.advanceTimersByTime(30_000);
    expect(listener30).toHaveBeenCalledTimes(2);
    expect(listener60).toHaveBeenCalledTimes(1);
  });

  it('advances the shared now value on every tick', () => {
    const start = new Date(2026, 5, 15, 12, 0, 0).getTime();
    vi.setSystemTime(start);
    subscribeInterval(30_000, vi.fn());

    vi.advanceTimersByTime(30_000);

    expect(getNow()).toBe(start + 30_000);
  });

  it('re-creates a bucket if all subscribers left and a new one arrives later', () => {
    const setIntervalSpy = vi.spyOn(global, 'setInterval');
    const unsubscribe = subscribeInterval(60_000, vi.fn());
    unsubscribe();

    subscribeInterval(60_000, vi.fn());

    expect(setIntervalSpy).toHaveBeenCalledTimes(2);
  });
});
