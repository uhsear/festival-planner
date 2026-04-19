import React, { useMemo, useEffect, Component, ReactNode } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useFestivalStore, useAuthStore } from '@festie/shared/stores';
import { useUIStore } from '@festie/shared/stores/uiStore';
import { usePicks, useFestival } from '@festie/shared/hooks';
import { Priority } from '@festie/shared/types';
import { formatTime, artistDisplayName } from '@festie/shared/utils';
import StageBadge from '../components/ui/StageBadge';
import EmptyState from '../components/ui/EmptyState';
import RefreshableView from '../components/layout/RefreshableView';
import { Star } from 'lucide-react';

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
    // eslint-disable-next-line no-console
    console.error('[picks] render failed:', error, info.componentStack);
  }
  render() {
    if (this.state.error) {
      return (
        <div className="picks-container" role="alert" aria-label="Picks view error">
          <div className="no-festival" style={{ padding: 24 }}>
            <h2 style={{ marginTop: 0 }}>Something went wrong loading your picks.</h2>
            <p style={{ color: 'var(--color-text-secondary)', fontSize: 14 }}>
              Try reloading the page. If this keeps happening, switch festivals
              and back, or sign out and back in.
            </p>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => window.location.reload()}
              style={{ marginTop: 12 }}
            >
              Reload
            </button>
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
      <div className="picks-container" role="region" aria-label="My picks">
        <div className="no-festival">
          <p>Select a festival first.</p>
        </div>
      </div>
    );
  }

  if (!currentProfile) {
    return (
      <div className="picks-container" role="region" aria-label="My picks">
        <div className="no-festival">
          <p>Join this festival to start saving picks.</p>
          <p style={{ color: 'var(--color-text-secondary)', fontSize: 13, marginTop: 8 }}>
            Open the Schedule tab and tap <strong>Join festival</strong>.
          </p>
        </div>
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
      <RefreshableView queryKeys={[['picks'], ['profiles']]} className="picks-container h-full">
        <div role="region" aria-label="My picks">
          <EmptyState
            icon={<Star className="w-12 h-12" aria-hidden="true" />}
            title={`No picks yet${days[selectedDay]?.label ? ` for ${days[selectedDay].label}` : ''}`}
            description="Browse artists and tap Must, Want, or Maybe to build your plan."
            cta={{ label: 'Browse Artists', onClick: () => navigate({ to: '/cards' }) }}
          />
        </div>
      </RefreshableView>
    );
  }

  return (
    <RefreshableView queryKeys={[['picks'], ['profiles']]} className="picks-container h-full">
      <div role="region" aria-label="My picks">
      {/* Priority sections */}
      {PRIORITY_SECTIONS.map(([pri, label, color]) => {
        const items = picksGrouped[pri];
        return (
          <div key={pri} className="picks-section">
            <div className="picks-section-title">
              <div className="dot" style={{ background: color }} />
              <span>{label}</span>
              <span className="count">{items.length}</span>
            </div>

            {items.map((set) => {
              const sc = getStageColor(set.stageId);
              const sn = getStageName(set.stageId) || '';
              const dn = artistDisplayName(set, currentFestival?.b2bSeparator);
              const dayLabel = days[set.dayIndex ?? 0]?.label || '';

              return (
                <button
                  key={set.id}
                  className="pick-item"
                  type="button"
                  aria-label={`${dn} — ${dayLabel}${set.startTime ? ' ' + formatTime(set.startTime) : ' TBA'}`}
                  onClick={() => setDetailSet(set)}
                >
                  <div className="pick-time">
                    {dayLabel}
                    {set.startTime ? ' ' + formatTime(set.startTime) : ' TBA'}
                  </div>
                  <div className="pick-artist">{dn}</div>
                  <StageBadge variant="pick" stageName={sn} stageColor={sc} />
                </button>
              );
            })}

            {items.length === 0 && (
              <div className="empty-state-guide">
                <div className="empty-state-icon">
                  {pri === 'must' ? '★' : pri === 'want-to-see' ? '◆' : '●'}
                </div>
                <div className="empty-state-text">
                  {pri === 'must'
                    ? 'Tap ★ on any set to mark it as must-see.'
                    : pri === 'want-to-see'
                      ? "Tap ◆ on sets you'd like to catch."
                      : "Tap ● on sets you're considering."}
                </div>
              </div>
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
