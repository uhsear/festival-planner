import React, { useEffect, useMemo } from 'react';
import { Link, useNavigate } from '@tanstack/react-router';
import { useAuthStore, useCrewStore, useFestivalStore } from '@festie/shared/stores';
import { artistDisplayName, formatTime, pickActiveMeetingPoint, buildSlots } from '@festie/shared/utils';
import { PRIORITY_LABEL } from '@festie/shared/constants';
import type { FestivalDay, FestivalSet, Priority, Profile } from '@festie/shared/types';
import FreshnessChip from '../components/features/FreshnessChip';
import EmptyState from '../components/ui/EmptyState';
import { Card } from '../components/ui/Card';
import { RenderErrorBoundary } from '../components/layout/RouteErrorBoundary';
import { MapPin, Home, CalendarClock, Users, ArrowLeft } from 'lucide-react';

// ── Pure digest assembly (offline-native, zero network) ────────────────────
// Everything below reads ONLY from the persisted stores already in memory:
// crewStore.meetingPoints / activeCrew, festivalDataStore.sets / allProfiles /
// days, and the shared getSetTimeBounds. No fetches, no effects that hit the
// network — the whole screen renders from cache.
// Per-priority badge tint using the priority tokens (must=coral, want=aqua,
// maybe=amber). Static literal class strings so Tailwind detects them — the
// badge previously hardcoded coral for EVERY pick regardless of priority.
const PRIORITY_BADGE: Record<Priority, string> = {
  must: 'bg-priority-must/15 text-priority-must',
  'want-to-see': 'bg-priority-want/15 text-priority-want',
  maybe: 'bg-priority-maybe/15 text-priority-maybe',
};
// Pure digest assembly (pickActiveMeetingPoint + buildSlots) lives in
// @festie/shared/utils so web + mobile share one implementation.

export default function CrewPlanView() {
  return (
    <RenderErrorBoundary name="crew-plan">
      <CrewPlanInner />
    </RenderErrorBoundary>
  );
}

function CrewPlanInner() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const activeCrew = useCrewStore((s) => s.activeCrew);
  const crewMembers = useCrewStore((s) => s.crewMembers);
  const meetingPoints = useCrewStore((s) => s.meetingPoints);
  const sets = useFestivalStore((s) => s.sets) as FestivalSet[];
  const days = useFestivalStore((s) => s.days) as FestivalDay[];
  const allProfiles = useFestivalStore((s) => s.allProfiles) as Profile[];

  useEffect(() => {
    if (!user) navigate({ to: '/login' }).catch(() => {});
  }, [user, navigate]);

  // Crew-scoped profiles: only members of the active crew (mirrors useCrew).
  const crewProfiles = useMemo(() => {
    const memberIds = new Set([
      ...crewMembers.map((m) => m.userId),
      ...(activeCrew?.members ?? []).map((m) => m.userId),
    ]);
    return allProfiles.filter((p) => memberIds.has(p.userId));
  }, [crewMembers, activeCrew, allProfiles]);

  const nowMs = Date.now();
  const meetingPoint = useMemo(() => pickActiveMeetingPoint(meetingPoints, nowMs), [meetingPoints, nowMs]);
  const slots = useMemo(() => buildSlots(sets, days, crewProfiles, nowMs), [sets, days, crewProfiles, nowMs]);

  if (!user) return null;

  if (!activeCrew) {
    return (
      <div className="space-y-4 pb-6 max-w-[600px] mx-auto w-full">
        <BackLink />
        <Card padding="lg">
          <EmptyState
            icon={<Users className="w-12 h-12" aria-hidden="true" />}
            title="No crew selected"
            description="Open the Crew tab and pick a crew to see its plan."
          />
        </Card>
      </div>
    );
  }

  const slotsWithPicks = slots.filter((s) => s.picks.length > 0);

  return (
    <div className="space-y-4 pb-6 max-w-2xl mx-auto px-3 w-full">
      <BackLink />

      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h1 className="text-xl font-display font-bold text-text-primary">{activeCrew.name}’s plan</h1>
        <FreshnessChip surface="crew" />
      </div>

      {/* Active meeting point */}
      <Card padding="md">
        <Card.Header>
          <MapPin className="w-5 h-5 text-accent-coral flex-shrink-0" aria-hidden="true" />
          <span className="font-semibold text-text-primary">Meet up</span>
        </Card.Header>
        <Card.Body>
          {meetingPoint ? (
            <div className="space-y-1">
              <p className="text-text-primary font-medium">{meetingPoint.label}</p>
              <p className="text-sm text-text-secondary">{meetingPoint.location}</p>
              {meetingPoint.meet_at && (
                <p className="text-sm text-accent-aqua font-medium">
                  {new Date(meetingPoint.meet_at).toLocaleString([], {
                    weekday: 'short',
                    hour: 'numeric',
                    minute: '2-digit',
                  })}
                </p>
              )}
            </div>
          ) : (
            <p className="text-sm text-text-secondary">No active meeting point set.</p>
          )}
        </Card.Body>
      </Card>

      {/* Crew home base */}
      <Card padding="md">
        <Card.Header>
          <Home className="w-5 h-5 text-accent-aqua flex-shrink-0" aria-hidden="true" />
          <span className="font-semibold text-text-primary">Home base</span>
        </Card.Header>
        <Card.Body>
          {activeCrew.homeBaseLocation || activeCrew.homeBaseTime ? (
            <div className="space-y-1">
              {activeCrew.homeBaseLocation && (
                <p className="text-text-primary font-medium">{activeCrew.homeBaseLocation}</p>
              )}
              {activeCrew.homeBaseTime && <p className="text-sm text-text-secondary">{activeCrew.homeBaseTime}</p>}
            </div>
          ) : (
            <p className="text-sm text-text-secondary">No home base set.</p>
          )}
        </Card.Body>
      </Card>

      {/* Who's seeing what next */}
      <Card padding="md">
        <Card.Header>
          <CalendarClock className="w-5 h-5 text-accent-amber flex-shrink-0" aria-hidden="true" />
          <span className="font-semibold text-text-primary">Up next</span>
        </Card.Header>
        <Card.Body className="space-y-4">
          {slotsWithPicks.length === 0 ? (
            <p className="text-sm text-text-secondary">
              No upcoming crew picks. Add sets to your schedule to fill this in.
            </p>
          ) : (
            slotsWithPicks.map((slot) => (
              <div key={slot.startMs} className="space-y-2">
                <p className="text-xs uppercase tracking-[var(--letter-spacing-caps)] text-text-secondary font-semibold">
                  {slot.startTime ? formatTime(slot.startTime) : 'Soon'}
                </p>
                <ul className="space-y-1.5">
                  {slot.picks.map((p) => (
                    <li key={p.memberId} className="flex items-center gap-2 text-sm">
                      <span
                        className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold flex-shrink-0 ${PRIORITY_BADGE[p.priority]}`}
                        aria-label={PRIORITY_LABEL[p.priority]}
                      >
                        {PRIORITY_LABEL[p.priority]}
                      </span>
                      <span className="text-text-primary font-medium truncate">{p.memberName}</span>
                      <span className="text-text-secondary">→</span>
                      <span className="text-text-secondary truncate">{artistDisplayName(p.set)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))
          )}
        </Card.Body>
      </Card>
    </div>
  );
}

function BackLink() {
  return (
    <Link
      to="/crew"
      aria-label="Back to crew"
      className="inline-flex items-center gap-1.5 text-sm text-text-secondary hover:text-text-primary transition-colors"
    >
      <ArrowLeft className="w-4 h-4" aria-hidden="true" />
      <span>Back to crew</span>
    </Link>
  );
}
