import React, { useCallback, useMemo, useSyncExternalStore } from 'react';
import { useFestivalStore, useAuthStore } from '@festie/shared/stores';
import { useUIStore } from '@festie/shared/stores/uiStore';
import { usePicks, useFestival } from '@festie/shared/hooks';
import {
  artistDisplayName,
  getSetHotness,
  getConflictingSetIds,
  festivalPhase,
  resolveStageColor,
} from '@festie/shared/utils';
import SetCard from '../components/features/SetCard';
import PhaseHomeActions from '../components/features/PhaseHomeActions';
import EmptyState from '../components/ui/EmptyState';
import CardsSkeleton from '../components/ui/skeletons/CardsSkeleton';
import { RenderErrorBoundary } from '../components/layout/RouteErrorBoundary';
import { Music, SearchX } from 'lucide-react';

export default function CardsView() {
  return (
    <RenderErrorBoundary name="cards">
      <CardsViewInner />
    </RenderErrorBoundary>
  );
}

/**
 * Reduce-motion guard. Tracks `prefers-reduced-motion: reduce` so the card
 * stagger entrance can be skipped entirely (matching the global a11y media
 * query in animations.css) rather than just shortened.
 */
function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      if (typeof window === 'undefined' || !window.matchMedia) return () => {};
      const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
      mq.addEventListener('change', onChange);
      return () => mq.removeEventListener('change', onChange);
    },
    () =>
      typeof window !== 'undefined' && !!window.matchMedia
        ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
        : false,
    () => false,
  );
}

function CardsViewInner() {
  const currentProfile = useFestivalStore((state) => state.currentProfile);
  const currentFestival = useFestivalStore((state) => state.currentFestival);
  const days = useFestivalStore((state) => state.days);
  const user = useAuthStore((state) => state.user);
  const sets = useFestivalStore((state) => state.sets);
  const stages = useFestivalStore((state) => state.stages);
  const selectedDay = useFestivalStore((state) => state.selectedDay);
  const searchQuery = useFestivalStore((state) => state.searchQuery);
  const activeStages = useFestivalStore((state) => state.activeStages);

  const setDetailSet = useUIStore((state) => state.setDetailSet);
  const setDetailAutoSpotify = useUIStore((state) => state.setDetailAutoSpotify);
  const { getMyPick, getOtherPicks } = usePicks();
  const { getStageColor: getStageColorRaw, getStageName } = useFestival();
  // Map shared's platform-neutral fallback sentinel to the web muted CSS var.
  const getStageColor = useCallback(
    (stageId: string) => resolveStageColor(getStageColorRaw(stageId), 'var(--text-muted)'),
    [getStageColorRaw],
  );
  const prefersReducedMotion = usePrefersReducedMotion();

  const handlePreview = useCallback(
    (set: Parameters<typeof setDetailSet>[0]) => {
      setDetailAutoSpotify(true);
      setDetailSet(set);
    },
    [setDetailAutoSpotify, setDetailSet],
  );

  // Filter sets by day, stages, and search query — mirrors legacy filteredSets()
  const filteredSets = useMemo(() => {
    // Filter by selected day using dayIndex (legacy: getCurrentDaySets via day array index)
    let filtered = sets.filter((s) => s.dayIndex === selectedDay);

    // Filter by search query
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter(
        (s) => s.artists?.some((a) => a.name.toLowerCase().includes(q)) || (s.artist || '').toLowerCase().includes(q),
      );
    }

    // Filter by active stages — legacy: only filters when SOME but NOT ALL selected
    if (activeStages.length > 0 && activeStages.length < stages.length) {
      filtered = filtered.filter((s) => activeStages.includes(s.stageId));
    }

    // Sort by hotness (picks count), then by time, then by artist name
    return filtered.sort((a, b) => {
      const hotA = getSetHotness(a);
      const hotB = getSetHotness(b);
      if (hotA > 0 || hotB > 0) return hotB - hotA;

      const timeA = a.startTime || '';
      const timeB = b.startTime || '';
      if (timeA && timeB) return timeA.localeCompare(timeB);
      if (timeA && !timeB) return -1;
      if (!timeA && timeB) return 1;

      return artistDisplayName(a, currentFestival?.b2bSeparator).localeCompare(
        artistDisplayName(b, currentFestival?.b2bSeparator),
        undefined,
        { sensitivity: 'base' },
      );
    });
  }, [sets, selectedDay, stages, activeStages, searchQuery, currentFestival?.b2bSeparator]);

  // Compute conflict set IDs
  const conflictIds = useMemo(() => {
    return getConflictingSetIds(filteredSets, getMyPick);
  }, [filteredSets, getMyPick]);

  const conflictsBySetId = useMemo(() => {
    const conflictSets = filteredSets.filter((s) => conflictIds.has(s.id));
    const map = new Map<string, typeof conflictSets>();
    for (const s of conflictSets) {
      map.set(
        s.id,
        conflictSets.filter((c) => c.id !== s.id),
      );
    }
    return map;
  }, [filteredSets, conflictIds]);

  // P1-5 — festival lifecycle phase (pre / live / post), derived from the
  // festival's date range vs now (shared `festivalPhase`). Drives the
  // phase-aware home action band; null when the festival has no usable dates.
  const phase = useMemo(() => festivalPhase(currentFestival, days), [currentFestival, days]);

  // Show layout-matched skeleton while festivals are being fetched on boot
  // — same component the router uses for the chunk-load fallback so the
  // visual is continuous across route-transition → data-fetch.
  if (!currentFestival) {
    return <CardsSkeleton />;
  }

  return (
    <>
      {/* P1-5 — phase-aware home actions (authed only; matches BottomNav hiding
          crew/picks/wrap from guests). Re-prioritizes destinations by phase. */}
      {user && phase ? <PhaseHomeActions phase={phase} /> : null}

      {/* Card grid */}
      {filteredSets.length === 0 ? (
        <EmptyState
          icon={
            searchQuery ? (
              <SearchX className="w-12 h-12" aria-hidden="true" />
            ) : (
              <Music className="w-12 h-12" aria-hidden="true" />
            )
          }
          title={searchQuery ? 'No artists match your search' : 'No sets for this day'}
          description={
            searchQuery
              ? 'Try a different spelling or clear the search to see the full lineup.'
              : 'Pick another day from the day selector to browse the schedule.'
          }
        />
      ) : (
        <div
          // `card-grid` is kept for its behavioral hooks (scroll-container
          // detection, focus-visible, priority-button styling) — layout below
          // is driven by tokens to match the mobile FlatList rhythm.
          className="card-grid grid w-full mx-auto max-w-[1440px] md:[--cards-gap:var(--space-4)]"
          // Auto-fill grid + token gap set inline so the mobile single-column →
          // calm multi-col rhythm wins over the legacy (unlayered) `.card-grid`
          // desktop overrides in pages.css. Gap steps from spacing[3] (12px,
          // tight mobile-list rhythm) to spacing[4] (16px) past the md
          // breakpoint. Top/side padding is intentionally NOT set here — the
          // shell `#main-content` (`px-6 py-4`) owns the single top/side inset
          // for every route, so the grid (and the empty-state branch above)
          // share one origin instead of stacking an extra grid pad on top.
          style={{
            gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 260px), 1fr))',
            gap: 'var(--cards-gap, var(--space-3))',
          }}
          role="region"
          aria-label="Card view"
        >
          {filteredSets.map((set, idx) => {
            const sc = getStageColor(set.stageId);
            const sn = getStageName(set.stageId) || 'Unknown';
            const others = getOtherPicks(set.id);
            const setConflicts = conflictsBySetId.get(set.id) || [];

            return (
              <div
                key={set.id}
                // No windowing lib is a dependency, so the interim quick win:
                // content-visibility:auto lets the browser skip layout/paint for
                // off-screen cards, with contain-intrinsic-size reserving an
                // approximate box so the scrollbar stays stable. Cuts render cost
                // on long single-day lineups without virtualization machinery.
                className="[content-visibility:auto] [contain-intrinsic-size:auto_240px]"
                // Softened stagger entrance on the motion tokens
                // (duration.med + easing.out). Skipped entirely when the user
                // prefers reduced motion.
                style={
                  prefersReducedMotion
                    ? undefined
                    : ({
                        animation: 'stagger-fade-in var(--duration-med) var(--ease-out) both',
                        animationDelay: `calc(${Math.min(idx, 20)} * 24ms)`,
                      } as React.CSSProperties)
                }
              >
                <SetCard
                  set={set}
                  onTap={() => setDetailSet(set)}
                  onPreview={() => handlePreview(set)}
                  showPicks={!!currentProfile}
                  stageName={sn}
                  stageColor={sc}
                  friendProfiles={others}
                  conflicts={setConflicts}
                  b2bSeparator={currentFestival?.b2bSeparator}
                />
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
