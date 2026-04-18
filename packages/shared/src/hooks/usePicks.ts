import { useCallback } from 'react';
import { useFestivalStore } from '../stores/festivalStore';
import { Priority, SavePickRequest, SaveNoteRequest } from '../types';

export interface UsePicksReturn {
  savePick: (festivalId: string, setId: string, priority: Priority | null) => Promise<void>;
  removePick: (festivalId: string, setId: string) => Promise<void>;
  saveNote: (festivalId: string, setId: string, note: string) => Promise<void>;
  getMyPick: (setId: string) => Priority | null | undefined;
  getMyNote: (setId: string) => string | undefined;
  getOtherPicks: (setId: string) => Array<{ profileId: string; priority: Priority }>;
}

export function usePicks(): UsePicksReturn {
  const currentProfile = useFestivalStore((state) => state.currentProfile);
  const allProfiles = useFestivalStore((state) => state.allProfiles);
  const savePick = useFestivalStore((state) => state.savePick);
  const removePick = useFestivalStore((state) => state.removePick);
  const saveNoteStore = useFestivalStore((state) => state.saveNote);

  const handleSavePick = useCallback(
    async (festivalId: string, setId: string, priority: Priority | null) => {
      // NOTE: SavePickRequest.updatedAt/etag are defined (optional) on the type
      // but festivalStore.savePick ignores them — not populating avoids
      // misleading optimistic-locking signals. Re-add if the store wires them.
      const request: SavePickRequest = {
        festivalId,
        setId,
        priority,
      };
      await savePick(request);
    },
    [savePick],
  );

  const handleRemovePick = useCallback(
    async (festivalId: string, setId: string) => {
      await removePick(festivalId, setId);
    },
    [removePick],
  );

  const handleSaveNote = useCallback(
    async (festivalId: string, setId: string, note: string) => {
      const request: SaveNoteRequest = { festivalId, setId, note };
      await saveNoteStore(request);
    },
    [saveNoteStore],
  );

  // Defensive reads — `picks` / `notes` are typed as Record but API payloads
  // have occasionally arrived as null when a profile has never had picks/
  // notes written. Bare `currentProfile.picks[setId]` then throws
  // "Cannot read properties of null (reading ...)" inside the /picks render.
  const getMyPick = useCallback(
    (setId: string): Priority | null | undefined => {
      if (!currentProfile) return undefined;
      const picks = currentProfile.picks || {};
      const value = picks[setId];
      return (value as Priority) || null;
    },
    [currentProfile],
  );

  const getMyNote = useCallback(
    (setId: string): string | undefined => {
      if (!currentProfile) return undefined;
      const notes = currentProfile.notes || {};
      return notes[setId];
    },
    [currentProfile],
  );

  const getOtherPicks = useCallback(
    (setId: string): Array<{ profileId: string; priority: Priority }> => {
      if (!currentProfile) return [];
      return allProfiles
        .filter((p) => p.id !== currentProfile.id && (p.picks || {})[setId])
        .map((p) => ({
          profileId: p.id,
          priority: (p.picks || {})[setId] as Priority,
        }));
    },
    [currentProfile, allProfiles],
  );

  return {
    savePick: handleSavePick,
    removePick: handleRemovePick,
    saveNote: handleSaveNote,
    getMyPick,
    getMyNote,
    getOtherPicks,
  };
}
