/// <reference types="vitest/globals" />
import '@testing-library/jest-dom/vitest';
import { expect } from 'vitest';
import { toBeAccessible } from '@sa11y/vitest';

// Register sa11y's `toBeAccessible()` matcher for fast, per-component structural
// a11y checks in the unit suite (roles/names/aria) — complements the slower
// real-browser axe gates (Storybook test-runner + e2e). jsdom can't do
// layout/contrast rules, so this catches structural regressions, not contrast.
expect.extend({ toBeAccessible });

declare module 'vitest' {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- must mirror vitest's own `Assertion<T = any>` signature (TS2428).
  interface Assertion<T = any> {
    toBeAccessible(config?: unknown): Promise<T>;
  }
  interface AsymmetricMatchersContaining {
    toBeAccessible(config?: unknown): Promise<void>;
  }
}

// Stub matchMedia — jsdom doesn't implement it, but motion/react and some
// components query prefers-reduced-motion. Default: no preference.
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

// Stub IntersectionObserver — used by lazy-loading components.
class MockIntersectionObserver {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
}
Object.defineProperty(window, 'IntersectionObserver', {
  writable: true,
  value: MockIntersectionObserver,
});

// Stub ResizeObserver — used by Radix UI primitives.
class MockResizeObserver {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
}
Object.defineProperty(window, 'ResizeObserver', {
  writable: true,
  value: MockResizeObserver,
});

// Stub navigator.vibrate — used by useHaptics.
Object.defineProperty(navigator, 'vibrate', {
  writable: true,
  value: vi.fn(() => true),
});

// Stub Element.scrollTo — jsdom doesn't implement it. GridView/TimelineView
// auto-scroll to "now" on mount, which only fires when the wall clock falls
// within the mock festival's hours, so without this the grid test fails
// non-deterministically depending on the time of day it runs.
if (!Element.prototype.scrollTo) {
  Element.prototype.scrollTo = vi.fn();
}
