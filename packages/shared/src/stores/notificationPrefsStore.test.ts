import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../services/api', () => ({
  api: { get: vi.fn(), put: vi.fn() },
}));

import { api } from '../services/api';
import { useNotificationPrefsStore, DEFAULT_NOTIFICATION_PREFS } from './notificationPrefsStore';

const mockApi = api as unknown as { get: ReturnType<typeof vi.fn>; put: ReturnType<typeof vi.fn> };

describe('notificationPrefsStore', () => {
  beforeEach(() => {
    useNotificationPrefsStore.setState({
      prefs: DEFAULT_NOTIFICATION_PREFS,
      loaded: false,
      isLoading: false,
      error: null,
    });
    mockApi.get.mockReset();
    mockApi.put.mockReset();
  });

  it('normalizes 0/1 ints to booleans on load and keeps DND strings', async () => {
    mockApi.get.mockResolvedValue({
      crewUpdates: 1,
      setReminders: 0,
      scheduleChanges: 1,
      dndStart: '23:00',
      dndEnd: '08:00',
    });
    await useNotificationPrefsStore.getState().loadPrefs();
    const p = useNotificationPrefsStore.getState().prefs;
    expect(p.crewUpdates).toBe(true);
    expect(p.setReminders).toBe(false);
    expect(p.scheduleChanges).toBe(true);
    expect(p.dndStart).toBe('23:00');
    expect(p.dndEnd).toBe('08:00');
    expect(useNotificationPrefsStore.getState().loaded).toBe(true);
  });

  it('defaults missing toggles to true', async () => {
    mockApi.get.mockResolvedValue({});
    await useNotificationPrefsStore.getState().loadPrefs();
    const p = useNotificationPrefsStore.getState().prefs;
    expect(p.crewUpdates).toBe(true);
    expect(p.dndStart).toBeNull();
  });

  it('applies updatePrefs optimistically and PUTs the patch', async () => {
    mockApi.put.mockResolvedValue({});
    await useNotificationPrefsStore.getState().updatePrefs({ setReminders: false });
    expect(useNotificationPrefsStore.getState().prefs.setReminders).toBe(false);
    expect(mockApi.put).toHaveBeenCalledWith('/notifications/prefs', { setReminders: false });
  });

  it('rolls back on update failure', async () => {
    mockApi.put.mockRejectedValue(new Error('network down'));
    const before = useNotificationPrefsStore.getState().prefs.crewUpdates;
    await expect(useNotificationPrefsStore.getState().updatePrefs({ crewUpdates: !before })).rejects.toThrow();
    expect(useNotificationPrefsStore.getState().prefs.crewUpdates).toBe(before);
    expect(useNotificationPrefsStore.getState().error).toBeTruthy();
  });
});
