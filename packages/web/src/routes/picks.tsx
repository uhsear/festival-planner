import React, { useMemo, useEffect, Component, ReactNode } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useFestivalStore, useAuthStore } from '@festie/shared/stores';
import { useUIStore } from '@festie/shared/stores/uiStore';
import { usePicks, useFestival } from '@festie/shared/hooks';
import { Priority } from '@festie/shared/types';
import { formatTime, artistDisplayName } from '@festie/shared/utils';
import StageBadge from '../components/ui/StageBadge';
import EmptyState from '../components/ui/EmptyState';
import Button from '../components/ui/Button';
import RefreshableView from '../components/layout/RefreshableView';
import { Star, CalendarX, UserPlus } from 'lucide-react';

const PRIORITY_SECTIONS: Array<[Priority, string, string]> = [
  ['must', 'Must See', 'var(--priority-must)'],
  ['want-to-see', 'Want to See', 'var(--priority-want)'],
  ['maybe', 'Maybe', 'var(--priority-maybe)'],
];

/**
 * Route-level error boundary for /picks. User reported the view "erroring
 * out" without a reproducible stack. Rather than ship a blank page on a
 * render throw, catch + render a helpful card that tells them what to try
 * (reload, re-select festival, report). Also logs to console so production
 * Sentry breadcrumbs pick it up. Defensive reads in usePicks already
 * handle the known null-picks case — this is belt + suspenders for
 * anything that slips through.
 */
class PicksErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[picks] render failed:', error, info.componentStack);
  }
  render() {
    if (this.state.error) {
      return (
        <div className="pb-5" role="alert" aria-label="Picks view error">
          <div className="no-festival p-6">
            <h2 className="mt-0">Something went wrong loading your picks.</h2>
            <p className="text-sm text-[var(--color-text-secondary)]">
              Try reloading the page. If this keeps happening, switch festivals
              and back, or sign out and back in.
            </p>
            <Button
              variant="primary"
              size="sm"
              className="mt-3"
              type="button"
              onClick={() => window.location.reload()}
            >
              Reload
            </Button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

function PicksViewInner() {
  const navigate = useNavigate();
  const user = useAuthStore((state) => state.user);
  const currentProfile = useFestivalStore((state) => state.currentProfile);
  const currentFestival = useFestivalStore((state) => state.currentFestival);
  const sets = useFestivalStore((state) => state.sets);
  const days = useFestivalStore((state) => state.days);
  const selectedDay = useFestivalStore((state) => state.selectedDay);

  const setDetailSet = useUIStore((state) => state.setDetailSet);
  const { getMyPick } = usePicks();
  const { getStageColor, getStageName } = useFestival();

  // Filter sets by selected day using dayIndex
  const daySets = useMemo(() => {
    return sets.filter((s) => s.dayIndex === selectedDay);
  }, [sets, selectedDay]);

  // Group picks by priority
  const picksGrouped = useMemo(() => {
    const groups: Record<Priority, typeof sets> = {
      must: [],
      'want-to-see': [],
      maybe: [],
    };

    daySets.forEach((set) => {
      const priority = getMyPick(set.id);
      if (priority && priority in groups) {
        groups[priority].push(set);
      }
    });

    // Sort each group by time, then name
    Object.keys(groups).forEach((key) => {
      groups[key as Priority].sort((a, b) => {
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
    });

    return groups;
  }, [daySets, getMyPick, currentFestival?.b2bSeparator]);

  // /picks is a logged-in-only surface. Router `beforeLoad` normally catches
  // this and redirects; this useEffect is a belt-and-suspenders fallback for
  // the case where the user logs out while already sitting on /picks (no
  // new `beforeLoad` fires on auth-state change). Render null while the
  // redirect is in-flight so we never flash the picks UI to a guest.
  useEffect(() => {
    if (!user) navigate({ to: '/login' }).catch(() => {});
  }, [user, navigate]);
  if (!user) return null;

  if (!currentFestival) {
    return (
      <div className="pb-5" role="region" aria-label="My picks">
        <EmptyState
          icon={<CalendarX className="w-9 h-9" aria-hidden="true" />}
          title="No festival selected"
          description="Choose a festival from the top menu to start saving picks."
        />
      </div>
    );
  }

  if (!currentProfile) {
    return (
      <div className="pb-5" role="region" aria-label="My picks">
        <EmptyState
          icon={<UserPlus className="w-9 h-9" aria-hidden="true" />}
          title="Join this festival first"
          description="Open the Schedule tab and tap Join festival to start saving picks."
          cta={{ label: 'Browse Artists', onClick: () => navigate({ to: '/cards' }) }}
        />
      </div>
    );
  }

  const totalPicksThisDay =
    picksGrouped.must.length +
    picksGrouped['want-to-see'].length +
    picksGrouped.maybe.length;

  // Global empty state: zero picks on this day → single friendly CTA pointing
  // at /cards, rather than three stacked "Tap X on…" hint blocks which looked
  // like broken/stuck UI on first visit.
  if (totalPicksThisDay === 0) {
    // Was a bespoke inline-styled block referencing legacy classes
    // (.empty-state-guide / .empty-state-icon) that have no CSS rule in
    // the React package — rendered as an un-styled stack of text on this
    // route. EmptyState matches /crew + /wrap + /timeline empty surfaces.
    return (
      <RefreshableView queryKeys={[['picks'], ['profiles']]} className="pb-5 h-full">
        <div role="region" aria-label="My picks">
          <EmptyState
            icon={<Star className="w-9 h-9" aria-hidden="true" />}
            title={`No picks yet${days[selectedDay]?.label ? ` for ${days[selectedDay].label}` : ''}`}
            description="Browse artists and tap Must, Want, or Maybe to build your plan."
            cta={{ label: 'Browse Artists', onClick: () => navigate({ to: '/cards' }) }}
          />
        </div>
      </RefreshableView>
    );
  }

  return (
    <RefreshableView queryKeys={[['picks'], ['profiles']]} className="pb-5 h-full">
      <div role="region" aria-label="My picks">
      {/* Priority sections */}
      {PRIORITY_SECTIONS.map(([pri, label, color]) => {
        const items = picksGrouped[pri];
        return (
          <div key={pri} className="mb-4">
            <div className="relative overflow-hidden col-span-full font-display text-[11px] font-bold uppercase tracking-[3px] mb-3.5 pb-2.5 border-b border-border-light flex items-center gap-[var(--space-5)] after:content-[''] after:absolute after:bottom-0 after:left-0 after:right-0 after:h-px after:bg-[linear-gradient(90deg,var(--border-light),transparent_80%)]">
              <div className="w-2.5 h-2.5 rounded-full" style={{ background: color }} />
              <span>{label}</span>
              <span className="ml-auto font-body text-xs font-semibold px-2.5 py-0.5 rounded-[var(--radius-md)] bg-bg-card text-text-secondary tracking-normal">{items.length}</span>
            </div>

            {items.map((set, idx) => {
              const sc = getStageColor(set.stageId);
              const sn = getStageName(set.stageId) || '';
              const dn = artistDisplayName(set, currentFestival?.b2bSeparator);
              const dayLabel = days[set.dayIndex ?? 0]?.label || '';

              return (
                <button
                  key={set.id}
                  className="stagger-item grid grid-cols-[auto_1fr_auto_auto] items-center gap-x-3 gap-y-2 px-4 py-3 bg-bg-card backdrop-blur-[8px] border border-border rounded-[var(--radius-sm)] mb-1.5 cursor-pointer transition-[background,transform,box-shadow,border-color] duration-[250ms] ease-standard hover:bg-bg-card-hover hover:translate-x-1 hover:shadow-[0_4px_16px_var(--shade-7)] hover:border-[var(--overlay-4)] focus-visible:outline-2 focus-visible:outline-accent-aqua focus-visible:outline-offset-2 focus-visible:shadow-[0_0_0_4px_var(--aqua-a15)] w-full text-left"
                  style={{ '--i': Math.min(idx, 20) } as React.CSSProperties}
                  type="button"
                  aria-label={`${dn} — ${dayLabel}${set.startTime ? ' ' + formatTime(set.startTime) : ' TBA'}`}
                  onClick={() => setDetailSet(set)}
                >
                  <div className="text-xs text-text-muted min-w-[100px] font-semibold tabular-nums">
                    {dayLabel}
                    {set.startTime ? ' ' + formatTime(set.startTime) : ' TBA'}
                  </div>
                  <div className="text-sm font-bold min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">{dn}</div>
                  <StageBadge variant="pick" stageName={sn} stageColor={sc} />
                </button>
              );
            })}

            {items.length === 0 && (
              <EmptyState
                className="py-3"
                icon={<Star className="w-6 h-6" aria-hidden="true" />}
                title={
                  pri === 'must'
                    ? 'No must-see picks yet'
                    : pri === 'want-to-see'
                      ? 'No want-to-see picks yet'
                      : 'No maybe picks yet'
                }
                description={
                  pri === 'must'
                    ? 'Tap the star on any set to mark it as must-see.'
                    : pri === 'want-to-see'
                      ? "Tap the diamond on sets you'd like to catch."
                      : 'Tap the circle on sets you\'re considering.'
                }
              />
            )}
          </div>
        );
      })}
      </div>
    </RefreshableView>
  );
}

export default function PicksView() {
  return (
    <PicksErrorBoundary>
      <PicksViewInner />
    </PicksErrorBoundary>
  );
}
