import '@testing-library/jest-dom/vitest';

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
