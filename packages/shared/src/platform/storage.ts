/**
 * Injectable storage adapter for cross-platform persistence.
 *
 * Defaults to `localStorage` on the web (guarded with `typeof window`).
 * React Native consumers call `configureStorage()` at app startup to
 * inject an AsyncStorage-backed adapter before any store hydrates.
 *
 * The interface intentionally allows both sync (localStorage) and async
 * (AsyncStorage) return types so the same adapter shape works on both
 * platforms without requiring callers to await web reads.
 */

export interface StorageAdapter {
  getItem(key: string): Promise<string | null> | string | null;
  setItem(key: string, value: string): Promise<void> | void;
  removeItem(key: string): Promise<void> | void;
}

const noopStorage: StorageAdapter = {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
};

function createDefaultStorage(): StorageAdapter {
  if (typeof window !== 'undefined' && typeof window.localStorage !== 'undefined') {
    return window.localStorage;
  }
  return noopStorage;
}

let _storage: StorageAdapter = createDefaultStorage();

/**
 * Replace the default storage adapter.
 *
 * Call this once at app startup (before any Zustand store hydrates)
 * to inject a platform-specific adapter such as AsyncStorage.
 *
 * ```ts
 * import AsyncStorage from '@react-native-async-storage/async-storage';
 * import { configureStorage } from '@festie/shared/platform';
 * configureStorage(AsyncStorage);
 * ```
 */
export function configureStorage(adapter: StorageAdapter): void {
  _storage = adapter;
}

/**
 * Returns the currently configured storage adapter.
 */
export function getStorage(): StorageAdapter {
  return _storage;
}
