import { create } from 'zustand';
import { api } from '../services/api';
import { mapErrorToUserMessage } from '../services/errors';

/**
 * Per-user notification preferences, backed by GET/PUT /notifications/prefs.
 * (Named NotificationPreferences to avoid clashing with the legacy
 * domain.ts `NotificationPrefs` shape, which does not match this endpoint.)
 * The backend stores booleans as 0/1, so reads are normalized to booleans.
 * DND times are 'HH:MM' (24h) strings or null.
 */
export interface NotificationPreferences {
  crewUpdates: boolean;
  setReminders: boolean;
  scheduleChanges: boolean;
  dndStart: string | null;
  dndEnd: string | null;
}

export const DEFAULT_NOTIFICATION_PREFS: NotificationPreferences = {
  crewUpdates: true,
  setReminders: true,
  scheduleChanges: true,
  dndStart: null,
  dndEnd: null,
};

function toBool(v: unknown, dflt: boolean): boolean {
  if (v === undefined || v === null) return dflt;
  return v === true || v === 1 || v === '1';
}

function normalize(raw: Record<string, unknown> | null | undefined): NotificationPreferences {
  const r = raw || {};
  return {
    crewUpdates: toBool(r.crewUpdates, true),
    setReminders: toBool(r.setReminders, true),
    scheduleChanges: toBool(r.scheduleChanges, true),
    dndStart: (r.dndStart as string) ?? null,
    dndEnd: (r.dndEnd as string) ?? null,
  };
}

interface NotificationPrefsState {
  prefs: NotificationPreferences;
  loaded: boolean;
  isLoading: boolean;
  error: string | null;
  loadPrefs: () => Promise<void>;
  updatePrefs: (patch: Partial<NotificationPreferences>) => Promise<void>;
}

export const useNotificationPrefsStore = create<NotificationPrefsState>((set, get) => ({
  prefs: DEFAULT_NOTIFICATION_PREFS,
  loaded: false,
  isLoading: false,
  error: null,

  loadPrefs: async () => {
    set({ isLoading: true, error: null });
    try {
      const raw = await api.get<Record<string, unknown>>('/notifications/prefs');
      set({ prefs: normalize(raw), loaded: true, isLoading: false });
    } catch (err) {
      set({ error: mapErrorToUserMessage(err, 'Failed to load notification settings'), isLoading: false });
      throw err;
    }
  },

  updatePrefs: async (patch: Partial<NotificationPreferences>) => {
    const prev = get().prefs;
    const next = { ...prev, ...patch };
    set({ prefs: next, error: null }); // optimistic
    try {
      // Server accepts the patch and merges; keep the optimistic value rather
      // than re-deriving from the response (its shape isn't guaranteed full).
      await api.put('/notifications/prefs', patch);
    } catch (err) {
      set({ prefs: prev, error: mapErrorToUserMessage(err, 'Failed to save notification settings') });
      throw err;
    }
  },
}));
