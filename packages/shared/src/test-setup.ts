import '@testing-library/jest-dom/vitest';

// Stub localStorage for Zustand persist middleware
const store: Record<string, string> = {};
const localStorageMock: Storage = {
  getItem: (key: string) => store[key] ?? null,
  setItem: (key: string, value: string) => {
    store[key] = value;
  },
  removeItem: (key: string) => {
    delete store[key];
  },
  clear: () => {
    for (const key of Object.keys(store)) {
      delete store[key];
    }
  },
  get length() {
    return Object.keys(store).length;
  },
  key: (index: number) => Object.keys(store)[index] ?? null,
};

Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock });

// Stub navigator.onLine
Object.defineProperty(globalThis.navigator, 'onLine', {
  writable: true,
  value: true,
});

// Stub window properties used by services
Object.defineProperty(globalThis, '__FP_BEARER_TOKEN', {
  writable: true,
  configurable: true,
  value: undefined,
});

Object.defineProperty(globalThis, '__FP_API_BASE', {
  writable: true,
  configurable: true,
  value: undefined,
});
