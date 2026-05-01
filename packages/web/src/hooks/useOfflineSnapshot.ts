import { useCallback, useState, useEffect } from 'react';
import type { User, Festival, Profile, Priority } from '@festie/shared/types';

const SNAPSHOT_KEY = 'festie-offline-snapshot-v2';

export interface OfflineSnapshot {
  timestamp: number;
  user?: User;
  festival?: Festival;
  profile?: Profile;
  picks?: Record<string, Priority>;
}

export interface UseOfflineSnapshotReturn {
  saveSnapshot: (data: OfflineSnapshot) => void;
  restoreSnapshot: () => OfflineSnapshot | null;
  hasSnapshot: boolean;
  clearSnapshot: () => void;
}

/**
 * Hook for saving and restoring app state snapshots for offline use.
 * On successful data load, snapshots are saved. On app start while offline,
 * state is restored from snapshot.
 */
export function useOfflineSnapshot(): UseOfflineSnapshotReturn {
  const [hasSnapshot, setHasSnapshot] = useState(false);

  // Check if snapshot exists on mount
  useEffect(() => {
    try {
      const item = localStorage.getItem(SNAPSHOT_KEY);
      setHasSnapshot(!!item);
    } catch {
      setHasSnapshot(false);
    }
  }, []);

  const saveSnapshot = useCallback((data: OfflineSnapshot): void => {
    try {
      const snapshot: OfflineSnapshot = {
        ...data,
        timestamp: Date.now(),
      };
      localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(snapshot));
      setHasSnapshot(true);
    } catch (err) {
      console.error('Failed to save offline snapshot:', err);
    }
  }, []);

  const restoreSnapshot = useCallback((): OfflineSnapshot | null => {
    try {
      const item = localStorage.getItem(SNAPSHOT_KEY);
      if (!item) return null;
      const snapshot = JSON.parse(item) as OfflineSnapshot;
      // Validate snapshot structure — only timestamp is required. user/festival
      // are optional so fresh snapshots (pre-login) can still be restored.
      if (typeof snapshot.timestamp !== 'number') {
        return null;
      }
      return snapshot;
    } catch (err) {
      console.error('Failed to restore offline snapshot:', err);
      return null;
    }
  }, []);

  const clearSnapshot = useCallback((): void => {
    try {
      localStorage.removeItem(SNAPSHOT_KEY);
      setHasSnapshot(false);
    } catch (err) {
      console.error('Failed to clear offline snapshot:', err);
    }
  }, []);

  return {
    saveSnapshot,
    restoreSnapshot,
    hasSnapshot,
    clearSnapshot,
  };
}
