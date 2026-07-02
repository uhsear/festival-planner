import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';

// Shared mutable refs, hoisted so the vi.mock factories below can read them.
const h = vi.hoisted(() => ({
  checkSession: vi.fn(async () => {}),
  state: { user: null as unknown, hydrated: true, cb: null as null | (() => void) },
}));

vi.mock('@tanstack/react-router', () => ({ useNavigate: () => vi.fn() }));

vi.mock('@festie/shared', () => {
  const authState = () => ({ user: h.state.user, checkSession: h.checkSession });
  // useAuthStore is both a selector-hook and carries getState()/persist statics.
  const useAuthStore = Object.assign((sel: (s: ReturnType<typeof authState>) => unknown) => sel(authState()), {
    getState: authState,
    persist: {
      hasHydrated: () => h.state.hydrated,
      onFinishHydration: (cb: () => void) => {
        h.state.cb = cb;
        return () => {};
      },
    },
  });
  return { useAuthStore };
});

vi.mock('@festie/shared/stores', () => {
  const slice = {
    loadFestivals: vi.fn(async () => {}),
    selectFestival: vi.fn(async () => {}),
    currentFestival: null,
    currentProfile: null,
    loadProfiles: vi.fn(async () => {}),
  };
  const useFestivalStore = Object.assign((sel: (s: typeof slice) => unknown) => sel(slice), {
    getState: () => ({ festivals: [] as unknown[], currentFestival: null }),
  });
  return { useFestivalStore };
});

vi.mock('@festie/shared/stores/crewStore', () => ({
  useCrewStore: (sel: (s: Record<string, unknown>) => unknown) =>
    sel({ loadCrews: vi.fn(async () => {}), joinByCode: vi.fn(async () => {}) }),
}));

vi.mock('@festie/shared/services', () => ({ api: { post: vi.fn(async () => {}) } }));

vi.mock('../lib/toastContext', () => ({ useToast: () => ({ toast: vi.fn() }) }));

import { useFestivalLoader } from './useFestivalLoader';

describe('useFestivalLoader session probe', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.state.user = null;
    h.state.hydrated = true;
    h.state.cb = null;
  });

  it('does not call checkSession when no user is persisted', () => {
    h.state.user = null;
    renderHook(() => useFestivalLoader());
    expect(h.checkSession).not.toHaveBeenCalled();
  });

  it('calls checkSession when a user is persisted', () => {
    h.state.user = { id: 'u1' };
    renderHook(() => useFestivalLoader());
    expect(h.checkSession).toHaveBeenCalledTimes(1);
  });

  it('waits for persist hydration before probing', () => {
    h.state.hydrated = false;
    h.state.user = { id: 'u1' };
    renderHook(() => useFestivalLoader());
    expect(h.checkSession).not.toHaveBeenCalled();
    h.state.cb?.(); // simulate onFinishHydration firing
    expect(h.checkSession).toHaveBeenCalledTimes(1);
  });
});
