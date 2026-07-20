import { useEffect, useRef, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useAuthStore } from '@festie/shared';
import { useFestivalStore } from '@festie/shared/stores';
import { useCrewStore } from '@festie/shared/stores/crewStore';
import { api } from '@festie/shared/services';
import { useToast } from '../lib/toastContext';

/**
 * Handles all festival/session/crew bootstrapping logic:
 * - Session check on mount
 * - Auto-load festivals + select first one
 * - Load crews when user logs in
 * - ?joinCrew=<code> deep-link handling: stages the code as `pendingJoinCode`
 *   for the caller to confirm via `confirmJoinCrew()` -- it is never joined
 *   automatically without explicit user consent -- + post-login replay
 * - Re-fetch profiles on login
 */
export function useFestivalLoader() {
  const navigate = useNavigate();
  const checkSession = useAuthStore((s) => s.checkSession);
  const user = useAuthStore((s) => s.user);
  const loadFestivals = useFestivalStore((s) => s.loadFestivals);
  const selectFestival = useFestivalStore((s) => s.selectFestival);
  const currentFestival = useFestivalStore((s) => s.currentFestival);
  const currentProfile = useFestivalStore((s) => s.currentProfile);
  const loadProfiles = useFestivalStore((s) => s.loadProfiles);
  const loadCrews = useCrewStore((s) => s.loadCrews);
  const joinByCode = useCrewStore((s) => s.joinByCode);
  const { toast } = useToast();
  const joinAttemptedRef = useRef<string | null>(null);
  const [pendingJoinCode, setPendingJoinCode] = useState<string | null>(null);
  const [joinBusy, setJoinBusy] = useState(false);

  // Check session on mount — but only if a user was persisted. A cold guest
  // boot has no stored user, so an unconditional checkSession() guarantees a
  // 401 on every load. Wait for zustand persist rehydration first (the store
  // reads as logged-out until then), then probe only when a user is present.
  useEffect(() => {
    let cancelled = false;
    const persist = (
      useAuthStore as unknown as {
        persist?: { hasHydrated: () => boolean; onFinishHydration: (cb: () => void) => () => void };
      }
    ).persist;
    const probe = () => {
      if (!cancelled && useAuthStore.getState().user) checkSession().catch(() => {});
    };
    if (!persist || persist.hasHydrated()) {
      probe();
      return () => {
        cancelled = true;
      };
    }
    const unsub = persist.onFinishHydration(() => {
      unsub();
      probe();
    });
    return () => {
      cancelled = true;
      unsub();
    };
  }, [checkSession]);

  // Auto-load festivals + select first one on boot (mirrors legacy init())
  useEffect(() => {
    loadFestivals()
      .then(() => {
        const fests = useFestivalStore.getState().festivals;
        if (fests.length > 0 && !useFestivalStore.getState().currentFestival) {
          selectFestival(fests[0]!.id).catch(() => {});
        }
      })
      .catch(() => {});
  }, [loadFestivals, selectFestival]);

  // Load crews whenever auth state transitions to logged-in
  useEffect(() => {
    if (user) {
      loadCrews().catch(() => {});
    }
  }, [user?.id, loadCrews]); // eslint-disable-line react-hooks/exhaustive-deps -- intentional: use user.id to avoid re-fetching on every auth object change

  // ?joinCrew=<inviteCode> deep-link handler. Validates the code's shape
  // (mirrors routes/crew-invites.ts:156's own check) and STAGES it for
  // explicit confirmation -- see confirmJoinCrew/cancelJoinCrew below -- a
  // bare link must never be able to silently enroll a logged-in visitor.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const raw = params.get('joinCrew');
    if (!raw) return;
    if (joinAttemptedRef.current === raw) return;

    // Unauthenticated: stash and redirect to /register
    if (!user) {
      try {
        sessionStorage.setItem('fk.pendingJoinCrew', raw);
      } catch {
        /* sessionStorage unavailable */
      }
      joinAttemptedRef.current = raw;
      navigate({ to: '/register' });
      return;
    }
    // Authenticated: wait for festival context to be ready
    if (!currentFestival) return;

    joinAttemptedRef.current = raw;
    if (!/^[a-zA-Z0-9]{4,12}$/.test(raw)) {
      const url = new URL(window.location.href);
      url.searchParams.delete('joinCrew');
      window.history.replaceState({}, '', url.pathname + url.search + url.hash);
      toast('Invalid invite link', 'error');
      return;
    }
    setPendingJoinCode(raw);
  }, [user?.id, currentFestival?.id, navigate, toast]); // eslint-disable-line react-hooks/exhaustive-deps -- intentional: use ?.id to avoid re-running on every object reference change

  // Performs the join after the user explicitly confirms the pending
  // ?joinCrew= code staged above.
  const confirmJoinCrew = async () => {
    const code = pendingJoinCode;
    if (!code || !currentFestival) return;
    setJoinBusy(true);
    try {
      if (!currentProfile) {
        await api.post('/profiles', { festivalId: currentFestival.id });
        await loadProfiles(currentFestival.id);
      }
      await joinByCode({ inviteCode: code });
      toast('Joined crew', 'success');
      navigate({ to: '/crew' });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Couldn't join crew";
      if (/already/i.test(msg)) {
        toast('You are already in this crew', 'info');
      } else {
        toast("Couldn't join crew: " + msg, 'error');
      }
    } finally {
      setJoinBusy(false);
      setPendingJoinCode(null);
      const url = new URL(window.location.href);
      url.searchParams.delete('joinCrew');
      window.history.replaceState({}, '', url.pathname + url.search + url.hash);
    }
  };

  // Dismisses the pending join prompt without joining.
  const cancelJoinCrew = () => {
    setPendingJoinCode(null);
    const url = new URL(window.location.href);
    url.searchParams.delete('joinCrew');
    window.history.replaceState({}, '', url.pathname + url.search + url.hash);
  };

  // Replay pending crew join after registration/login
  useEffect(() => {
    if (!user) return;
    let pending: string | null = null;
    try {
      pending = sessionStorage.getItem('fk.pendingJoinCrew');
    } catch {
      /* sessionStorage unavailable */
    }
    if (!pending) return;
    try {
      sessionStorage.removeItem('fk.pendingJoinCrew');
    } catch {
      /* sessionStorage unavailable */
    }
    const url = new URL(window.location.href);
    url.searchParams.set('joinCrew', pending);
    window.history.replaceState({}, '', url.pathname + url.search + url.hash);
    joinAttemptedRef.current = null;
  }, [user?.id]); // eslint-disable-line react-hooks/exhaustive-deps -- intentional: only replay on login, not on every user object change

  // Re-fetch festival profiles on login once a festival is selected
  useEffect(() => {
    if (user && currentFestival) {
      selectFestival(currentFestival.id).catch(() => {});
    }
  }, [user?.id, currentFestival?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  return { pendingJoinCode, joinBusy, confirmJoinCrew, cancelJoinCrew };
}
