import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useFestivalStore } from '@festie/shared/stores';
import { useUIStore } from '@festie/shared/stores/uiStore';
import { useFestival } from '@festie/shared/hooks';
import { artistDisplayName } from '@festie/shared/utils';
import type { FestivalSet, Priority } from '@festie/shared/types';
import EmptyState from '../components/ui/EmptyState';
import { CalendarX } from 'lucide-react';

// Countdown flips to coral + bolder when a set is ≤ this many minutes away,
// so a user scanning the view in a crowd can grok "run, now" at a glance.
const IMMINENT_MIN = 5;

function fmtClock(d: Date): string {
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function fmtCountdown(mins: number): string {
  if (mins < 1) return 'starting now';
  if (mins < 60) return `in ${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `in ${h}h ${m}m` : `in ${h}h`;
}

// Festival days commonly span midnight: a Friday-night lineup may include a
// 02:00 set that's wall-clock-Saturday but logically part of Friday's day.
// Matches timeline.tsx's end-past-midnight extension (line 96). Sets with
// startTime before the cutoff (default 06:00) are shifted forward one day so
// they sort and compare correctly against the real wall clock.
const POST_MIDNIGHT_CUTOFF_MIN = 6 * 60;

function parseSetMs(dateStr: string, timeStr: string): number {
  const [h, m] = timeStr.split(':').map(Number);
  const base = new Date(`${dateStr}T00:00:00`).getTime();
  const totalMins = h * 60 + m;
  // Wall-clock-before-6am on this festival day → it's the NEXT calendar day.
  const rollover = totalMins < POST_MIDNIGHT_CUTOFF_MIN ? 24 * 60 : 0;
  return base + (totalMins + rollover) * 60_000;
}

interface TimedSet {
  set: FestivalSet;
  start: number;
  end: number;
  priority: Priority;
}

export default function FestivalModeView() {
  const currentFestival = useFestivalStore((s) => s.currentFestival);
  const sets = useFestivalStore((s) => s.sets);
  const days = useFestivalStore((s) => s.days);
  const currentProfile = useFestivalStore((s) => s.currentProfile);
  const setDetailSet = useUIStore((s) => s.setDetailSet);
  const { getStageName } = useFestival();
  const navigate = useNavigate();

  // 60s tick so Now/Next and countdowns refresh without reload. Matches legacy
  // cadence (public/app/festival-mode.js line 32).
  const [now, setNow] = useState<Date>(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

  const picks = currentProfile?.picks;

  const { current, upcoming } = useMemo(() => {
    if (!picks || !sets.length || !days.length) {
      return { current: [] as TimedSet[], upcoming: [] as TimedSet[] };
    }
    const nowMs = now.getTime();
    const timed: TimedSet[] = [];
    for (const s of sets) {
      const priority = picks[s.id];
      if (!priority) continue;
      if (!s.startTime) continue;
      const day = days[s.dayIndex ?? -1];
      const date = s.date || day?.date;
      if (!date) continue;
      const start = parseSetMs(date, s.startTime);
      let end: number;
      if (s.endTime) {
        end = parseSetMs(date, s.endTime);
        // End ≤ start means the set spans midnight — shift end forward one
        // day (same pattern as timeline.tsx line 96, hasSetStarted, etc).
        if (end <= start) end += 24 * 60 * 60_000;
      } else {
        end = start + 60 * 60_000;
      }
      timed.push({ set: s, start, end, priority });
    }
    const current = timed.filter((t) => t.start <= nowMs && t.end > nowMs);
    const upcoming = timed
      .filter((t) => t.start > nowMs)
      .sort((a, b) => a.start - b.start)
      .slice(0, 5);
    return { current, upcoming };
  }, [picks, sets, days, now]);

  if (!currentFestival) {
    return (
      <div className="festival-mode-view">
        <EmptyState
          icon={<CalendarX className="w-12 h-12" aria-hidden="true" />}
          title="No festival loaded"
          description="Pick a festival from the top menu to see what's playing now and next."
        />
      </div>
    );
  }

  return (
    <div className="festival-mode-view" data-testid="festival-mode-view">
      <div className="fm-header">
        <div className="fm-festival-name">{currentFestival.name}</div>
        <div className="fm-time" aria-label="Current time">{fmtClock(now)}</div>
      </div>

      <section className="fm-section" aria-labelledby="fm-now-title">
        <h2 id="fm-now-title" className="fm-section-title">
          <span className="fm-live-dot" aria-hidden="true" /> NOW
        </h2>
        {current.length > 0 ? (
          current.map(({ set: s, end }) => {
            const stageName = getStageName(s.stageId) || '';
            return (
              <button
                key={s.id}
                type="button"
                className="fm-set-card fm-now"
                data-testid="fm-now-card"
                onClick={() => setDetailSet(s)}
                aria-label={`${artistDisplayName(s, currentFestival.b2bSeparator)} playing now${stageName ? ' at ' + stageName : ''}, open details`}
              >
                <div className="fm-set-name">{artistDisplayName(s, currentFestival.b2bSeparator)}</div>
                {stageName && <div className="fm-set-stage">{stageName}</div>}
                <div className="fm-set-time fm-now-until">until {fmtClock(new Date(end))}</div>
              </button>
            );
          })
        ) : (
          <div className="fm-empty">Nothing playing right now — enjoy the walk.</div>
        )}
      </section>

      <section className="fm-section" aria-labelledby="fm-next-title">
        <h2 id="fm-next-title" className="fm-section-title">
          <span aria-hidden="true">⏭</span> UP NEXT
        </h2>
        {upcoming.length > 0 ? (
          upcoming.map(({ set: s, start }) => {
            const stageName = getStageName(s.stageId) || '';
            const mins = Math.round((start - now.getTime()) / 60_000);
            const imminent = mins <= IMMINENT_MIN;
            return (
              <button
                key={s.id}
                type="button"
                className="fm-set-card"
                data-testid="fm-next-card"
                onClick={() => setDetailSet(s)}
                aria-label={`${artistDisplayName(s, currentFestival.b2bSeparator)}${stageName ? ' at ' + stageName : ''} ${fmtCountdown(mins)}, open details`}
              >
                <div className="fm-set-name">{artistDisplayName(s, currentFestival.b2bSeparator)}</div>
                <div className="fm-set-info">
                  {stageName && <span className="fm-set-stage">{stageName}</span>}
                  <span className="fm-set-time">{fmtClock(new Date(start))}</span>
                  <span className={'fm-countdown' + (imminent ? ' fm-countdown--imminent' : '')}>
                    {fmtCountdown(mins)}
                  </span>
                </div>
              </button>
            );
          })
        ) : picks && Object.keys(picks).length === 0 ? (
          <div className="fm-empty fm-empty--cta">
            <span>No picks yet. </span>
            <button
              type="button"
              className="fm-empty-link"
              onClick={() => navigate({ to: '/cards' })}
              data-testid="fm-empty-pick-cta"
            >
              Browse the lineup →
            </button>
          </div>
        ) : (
          <div className="fm-empty">No more picks today — rest those legs.</div>
        )}
      </section>
    </div>
  );
}
