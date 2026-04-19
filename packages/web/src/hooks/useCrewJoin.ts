import { useEffect, useRef } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useAuthStore } from '@festie/shared';
import { useFestivalStore } from '@festie/shared/stores';
import { useCrewStore } from '@festie/shared/stores/crewStore';
import { api } from '@festie/shared/services';
import { useToast } from '../lib/toastContext';

export function useCrewJoin() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const currentFestival = useFestivalStore((s) => s.currentFestival);
  const currentProfile = useFestivalStore((s) => s.currentProfile);
  const loadProfiles = useFestivalStore((s) => s.loadProfiles);
  const joinByCode = useCrewStore((s) => s.joinByCode);
  const { toast } = useToast();
  const joinAttemptedRef = useRef<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('joinCrew');
    if (!code) return;
    if (joinAttemptedRef.current === code) return;

    if (!user) {
      try { sessionStorage.setItem('fk.pendingJoinCrew', code); } catch (_) {}
      joinAttemptedRef.current = code;
      navigate({ to: '/register' });
      return;
    }
    if (!currentFestival) return;

    joinAttemptedRef.current = code;
    (async () => {
      try {
        if (!currentProfile) {
          await api.post('/profiles', { festivalId: currentFestival.id });
          await loadProfiles(currentFestival.id);
        }
        await joinByCode({ inviteCode: code });
        toast('Joined crew!', 'success');
        const url = new URL(window.location.href);
        url.searchParams.delete('joinCrew');
        window.history.replaceState({}, '', url.pathname + url.search + url.hash);
        navigate({ to: '/crew' });
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Could not join crew';
        if (/already/i.test(msg)) {
          toast('You are already in this crew', 'info');
        } else {
          toast('Could not join crew: ' + msg, 'error');
        }
        const url = new URL(window.location.href);
        url.searchParams.delete('joinCrew');
        window.history.replaceState({}, '', url.pathname + url.search + url.hash);
      }
    })();
  }, [user?.id, currentFestival?.id, currentProfile?.id, joinByCode, loadProfiles, navigate, toast]);

  useEffect(() => {
    if (!user) return;
    let pending: string | null = null;
    try { pending = sessionStorage.getItem('fk.pendingJoinCrew'); } catch (_) {}
    if (!pending) return;
    try { sessionStorage.removeItem('fk.pendingJoinCrew'); } catch (_) {}
    const url = new URL(window.location.href);
    url.searchParams.set('joinCrew', pending);
    window.history.replaceState({}, '', url.pathname + url.search + url.hash);
    joinAttemptedRef.current = null;
  }, [user?.id]);
}
