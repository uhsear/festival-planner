import React, { useMemo, useEffect, useCallback, Component, ReactNode } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useFestivalStore, useAuthStore } from '@festie/shared/stores';
import { useUIStore } from '@festie/shared/stores/uiStore';
import { usePicks, useFestival } from '@festie/shared/hooks';
import { Priority } from '@festie/shared/types';
import { formatTime, artistDisplayName, buildPicksIcs } from '@festie/shared/utils';
import StageBadge from '../components/ui/StageBadge';
import EmptyState from '../components/ui/EmptyState';
import Badge from '../components/ui/Badge';
import Button from '../components/ui/Button';
import RefreshableView from '../components/layout/RefreshableView';
import { Star, CalendarX, UserPlus, CalendarPlus } from 'lucide-react';

// Each section carries its priority value, label, the dot accent token, and the
// matching tint-ring Badge variant — mirroring the mobile Picks tab where every
// bucket (Must/Want/Maybe) shares one accent across its dot, count pill, and the
// set card's left border.
const PRIORITY_SECTIONS: Array<{
  value: Priority;
  label: string;
  accent: string;
  badge: 'must' | 'want' | 'maybe';
}> = [
  { value: 'must', label: 'Must See', accent: 'var(--color-priority-must)', badge: 'must' },
  { value: 'want-to-see', label: 'Want to See', accent: 'var(--color-priority-want)', badge: 'want' },
  { value: 'maybe', label: 'Maybe', accent: 'var(--color-priority-maybe)', badge: 'maybe' },
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
          <div className="flex flex-col items-center justify-center h-full text-center text-text-muted p-6">
            <h2 className="mt-0">Something went wrong loading your picks.</h2>
            <p className="text-sm text-[var(--color-text-secondary)] max-w-[400px]">
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
  const stages = useFestivalStore((state) => state.stages);
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

  // True when the profile has any pick at all (across every day), which gates
  // the calendar export independently of the day filter — you can be on a day
  // with no picks and still export the whole festival plan.
  const hasAnyPicks = useMemo(
    () => !!currentProfile && sets.some((s) => currentProfile.picks?.[s.id]),
    [sets, currentProfile],
  );

  // Build the user's picks into an RFC-5545 .ics and trigger a browser
  // download. Mirrors the mobile Picks export (same shared buildPicksIcs over
  // the already-loaded store data — fully client-side, no server round-trip);
  // mobile hands the file to the OS share sheet, the web equivalent is a Blob
  // download. Exports ALL picks across days, not just the selected day.
  const handleExportCalendar = useCallback(() => {
    if (!currentFestival || !currentProfile) return;
    const ics = buildPicksIcs({
      festival: {
        id: currentFestival.id,
        name: currentFestival.name,
        location: currentFestival.location,
      },
      sets,
      stages,
      picks: currentProfile.picks,
      notes: currentProfile.notes,
    });
    const safeName = (currentFestival.name || 'festival')
      .replace(/[^a-z0-9_-]/gi, '_')
      .slice(0, 60);
    const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${safeName}_picks.ics`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }, [currentFestival, currentProfile, sets, stages]);

  const exportButton = hasAnyPicks ? (
    <Button
      variant="secondary"
      size="sm"
      type="button"
      onClick={handleExportCalendar}
      aria-label="Add picks to calendar"
    >
      <CalendarPlus className="w-4 h-4" aria-hidden="true" />
      Add to calendar
    </Button>
  ) : null;

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
          {exportButton && (
            <div className="flex justify-end mb-3">{exportButton}</div>
          )}
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
      {exportButton && (
        <div className="flex justify-end mb-3">{exportButton}</div>
      )}
      {/* Priority sections */}
      {PRIORITY_SECTIONS.map(({ value: pri, label, accent, badge }) => {
        const items = picksGrouped[pri];
        return (
          <div key={pri} className="mb-4">
            {/* Mobile section-header pattern: round accent dot + label role text +
                tint-ring count pill, separated from the rows by a hairline divider. */}
            <div className="flex items-center gap-2 mb-2 pb-2 border-b border-border">
              <div className="w-2.5 h-2.5 rounded-full" style={{ background: accent }} />
              <span className="text-sm font-medium text-text-secondary">{label}</span>
              <Badge variant={badge} className="ml-auto">{items.length}</Badge>
            </div>

            {items.map((set) => {
              const sc = getStageColor(set.stageId);
              const sn = getStageName(set.stageId) || '';
              const dn = artistDisplayName(set, currentFestival?.b2bSeparator);
              const dayLabel = days[set.dayIndex ?? 0]?.label || '';

              return (
                <button
                  key={set.id}
                  className="flex items-center gap-x-3 px-4 py-3 w-full text-left bg-bg-card border border-border border-l-4 rounded-xl mb-2 cursor-pointer transition-[background,transform] duration-200 ease-standard hover:bg-bg-card-hover active:scale-[0.97] motion-reduce:transition-none motion-reduce:transform-none focus-visible:outline-2 focus-visible:outline-accent-aqua focus-visible:outline-offset-2"
                  style={{ borderLeftColor: accent }}
                  type="button"
                  aria-label={`${dn} — ${dayLabel}${set.startTime ? ' ' + formatTime(set.startTime) : ' TBA'}`}
                  onClick={() => setDetailSet(set)}
                >
                  <div className="text-xs text-text-muted min-w-[100px] font-semibold tabular-nums">
                    {dayLabel}
                    {set.startTime ? ' ' + formatTime(set.startTime) : ' TBA'}
                  </div>
                  <div className="flex-1 text-sm font-bold min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">{dn}</div>
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
