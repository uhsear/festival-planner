import { useCallback } from 'react';
import { useFestivalStore } from '../stores/festivalStore';
import { Priority, SavePickRequest, SaveNoteRequest, SaveReminderRequest } from '../types';

export interface UsePicksReturn {
  savePick: (festivalId: string, setId: string, priority: Priority | null) => Promise<void>;
  removePick: (festivalId: string, setId: string) => Promise<void>;
  saveNote: (festivalId: string, setId: string, note: string) => Promise<void>;
  saveReminder: (festivalId: string, setId: string, minutes: number | null) => Promise<void>;
  getMyPick: (setId: string) => Priority | null | undefined;
  getMyNote: (setId: string) => string | undefined;
  getMyReminder: (setId: string) => number | undefined;
  getOtherPicks: (setId: string) => Array<{ profileId: string; priority: Priority; name?: string }>;
}

export function usePicks(): UsePicksReturn {
  const currentProfile = useFestivalStore((state) => state.currentProfile);
  // Select picks/notes/reminders sub-maps directly so the getMyPick/getMyNote/
  // getMyReminder callbacks only get new identity when THEIR slice changes —
  // not on every write to an unrelated slice (e.g. saving a note doesn't
  // invalidate getMyPick, preventing needless React.memo busts on grid columns).
  const myPicks = useFestivalStore((state) => state.currentProfile?.picks ?? null);
  const myNotes = useFestivalStore((state) => state.currentProfile?.notes ?? null);
  const myReminders = useFestivalStore((state) => state.currentProfile?.reminders ?? null);
  const allProfiles = useFestivalStore((state) => state.allProfiles);
  const savePick = useFestivalStore((state) => state.savePick);
  const removePick = useFestivalStore((state) => state.removePick);
  const saveNoteStore = useFestivalStore((state) => state.saveNote);
  const saveReminderStore = useFestivalStore((state) => state.saveReminder);

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

  const handleSaveReminder = useCallback(
    async (festivalId: string, setId: string, minutes: number | null) => {
      const request: SaveReminderRequest = { festivalId, setId, minutes };
      await saveReminderStore(request);
    },
    [saveReminderStore],
  );

  // Defensive reads — `picks` / `notes` are typed as Record but API payloads
  // have occasionally arrived as null when a profile has never had picks/
  // notes written. Bare `currentProfile.picks[setId]` then throws
  // "Cannot read properties of null (reading ...)" inside the /picks render.
  //
  // Each callback depends only on its own sub-map so saving a note doesn't
  // produce a new getMyPick identity (and vice-versa), preventing unnecessary
  // React.memo cache-busts on grid columns that only consume getMyPick.
  const getMyPick = useCallback(
    (setId: string): Priority | null | undefined => {
      if (!currentProfile) return undefined;
      const picks = myPicks || {};
      const value = picks[setId];
      return (value as Priority) || null;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [currentProfile?.id, myPicks],
  );

  const getMyNote = useCallback(
    (setId: string): string | undefined => {
      if (!currentProfile) return undefined;
      const notes = myNotes || {};
      return notes[setId];
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [currentProfile?.id, myNotes],
  );

  const getMyReminder = useCallback(
    (setId: string): number | undefined => {
      if (!currentProfile) return undefined;
      const reminders = myReminders || {};
      return reminders[setId];
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [currentProfile?.id, myReminders],
  );

  // Depend on the id only (not the whole currentProfile object): toggling your
  // own pick flips the object identity but not your id, so this memo stays
  // stable across self-edits and only recomputes when the roster changes.
  const currentProfileId = currentProfile?.id;
  const getOtherPicks = useCallback(
    (setId: string): Array<{ profileId: string; priority: Priority; name?: string }> => {
      if (!currentProfileId) return [];
      return allProfiles
        .filter((p) => p.id !== currentProfileId && (p.picks || {})[setId])
        .map((p) => ({
          profileId: p.id,
          priority: (p.picks || {})[setId] as Priority,
          name: p.name,
        }));
    },
    [currentProfileId, allProfiles],
  );

  return {
    savePick: handleSavePick,
    removePick: handleRemovePick,
    saveNote: handleSaveNote,
    saveReminder: handleSaveReminder,
    getMyPick,
    getMyNote,
    getMyReminder,
    getOtherPicks,
  };
}
