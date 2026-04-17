import React, { useMemo } from 'react';
import { useFestivalStore, useAuthStore } from '@festie/shared/stores';
import { useUIStore } from '@festie/shared/stores/uiStore';
import { usePicks, useFestival } from '@festie/shared/hooks';
import { Priority } from '@festie/shared/types';
import { formatTime, artistDisplayName } from '@festie/shared/utils';

const PRIORITY_SECTIONS: Array<[Priority, string, string]> = [
  ['must', 'Must See', 'var(--priority-must)'],
  ['want-to-see', 'Want to See', 'var(--priority-want)'],
  ['maybe', 'Maybe', 'var(--priority-maybe)'],
];

export default function PicksView() {
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

  // Guest teaser — matches legacy
  if (!user) {
    return (
      <div className="picks-container" role="region" aria-label="My picks">
        <div className="guest-teaser">
          <div className="empty-state-icon" aria-hidden="true">
            ★
          </div>
          <h2 style={{ margin: '12px 0 8px', fontSize: '18px', color: 'var(--text-primary)' }}>
            Save your festival picks
          </h2>
          <p
            style={{
              color: 'var(--text-secondary)',
              fontSize: '14px',
              maxWidth: '280px',
              margin: '0 auto 16px',
            }}
          >
            Sign in to mark artists as Must See, Want to See, or Maybe — sync across devices and
            share with your crew.
          </p>
          <button
            className="btn btn-primary"
            type="button"
            onClick={() => (window.location.href = '/register')}
          >
            Sign Up Free
          </button>
        </div>
      </div>
    );
  }

  if (!currentFestival || !currentProfile) {
    return (
      <div className="picks-container" role="region" aria-label="My picks">
        <div className="no-festival">
          <p>Select a festival first.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="picks-container" role="region" aria-label="My picks">
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
              const sn = getStageName(set.stageId);
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
                  <span
                    className="pick-stage"
                    style={{
                      background: sc,
                      color: '#fff',
                      fontWeight: 700,
                      textShadow: '0 1px 2px rgba(0, 0, 0, 0.35)',
                    }}
                  >
                    {sn}
                  </span>
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
  );
}
