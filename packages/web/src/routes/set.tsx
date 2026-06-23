import { useEffect, useRef } from 'react';
import { useParams, useNavigate } from '@tanstack/react-router';
import { useFestivalStore } from '@festie/shared/stores';
import { useUIStore } from '@festie/shared/stores/uiStore';
import { api } from '@festie/shared/services';
import CardsSkeleton from '../components/ui/skeletons/CardsSkeleton';

/**
 * Deep-link target for shareable artist links — festie.us/set/:setId.
 * Resolves which festival the set belongs to, loads that festival if the user
 * isn't already on it, opens the set's detail panel, then drops them on the
 * schedule with the panel open. Public: festival data needs no auth (picks /
 * notes still prompt for login inside the panel). The redirect leaves the URL
 * as `/` so closing the panel behaves like a normal browse.
 */
export default function SetDeepLink() {
  const { setId } = useParams({ from: '/set/$setId' });
  const navigate = useNavigate();
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    (async () => {
      try {
        const store = useFestivalStore.getState();
        if (!store.festivals?.length) {
          await store.loadFestivals().catch(() => {});
        }
        let set = useFestivalStore.getState().sets.find((s) => s.id === setId);
        if (!set) {
          const { festivalId } = await api.get<{ festivalId: string }>(
            `/festivals/locate-set/${setId}`,
          );
          if (festivalId && useFestivalStore.getState().currentFestivalId !== festivalId) {
            await useFestivalStore.getState().selectFestival(festivalId);
          }
          set = useFestivalStore.getState().sets.find((s) => s.id === setId);
        }
        if (set) useUIStore.getState().setDetailSet(set);
      } catch {
        /* fall through — land on the schedule */
      } finally {
        navigate({ to: '/', replace: true });
      }
    })();
  }, [setId, navigate]);

  return <CardsSkeleton />;
}
