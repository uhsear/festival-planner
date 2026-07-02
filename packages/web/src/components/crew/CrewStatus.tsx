import React, { useEffect, useMemo, useState } from 'react';
import { useCrewStore, formatStaleness, etaMinutes, type CrewMemberStatus } from '@festie/shared';
import { useCurrentPosition } from '@festie/shared/hooks';
import { useToast } from '../../lib/toastContext';
import Button from '../ui/Button';
import { Navigation, LocateFixed, X, MapPin, Footprints, CircleCheck, Hourglass } from 'lucide-react';
import { inputBase } from '../../lib/styles';

// A meeting point as the parent passes it (snake_case server shape). Only the
// fields CrewStatus needs to render the ETA target + compute distance.
interface MeetingPointLite {
  id: string;
  label: string;
  latitude?: number | null;
  longitude?: number | null;
}

interface Props {
  crewId: string;
  currentUserId: string;
  festivalId?: string;
  /** Meeting points (for the ETA-target picker + coord-based ETA). */
  meetingPoints: MeetingPointLite[];
}

// Status enum → user-facing label + lucide icon. `null` means "cleared".
// Icons (not emoji) keep the crew UI on the app's single icon vocabulary.
const STATUS_META: Record<string, { Icon: React.ComponentType<{ className?: string }>; label: string }> = {
  'on-my-way': { Icon: Footprints, label: 'On my way' },
  here: { Icon: CircleCheck, label: "I'm here" },
  delayed: { Icon: Hourglass, label: 'Running late' },
};

/**
 * Crew member status (M5) — last-synced "On my way to [meeting point] · ETA ~N
 * min" action + a crew status list with HONEST staleness.
 *
 * CARDINAL RULE: this is offline-DEGRADED-SYNCS, NOT live GPS. Every row is a
 * snapshot the member set (often offline) that delivered on the next signal
 * blip. The copy ALWAYS says "as of N ago" (formatStaleness) and "sent when
 * signal returns" — it NEVER implies a live, moving position.
 *
 * Offline path: updateMyStatus queues the PUT with a deterministic clientId so
 * repeated toggles collapse, optimistically upserts my row, and reconciles on
 * reconnect. ETA is computed from the device's last captured position to the
 * target meeting point's saved coord (geo.ts) when both exist; otherwise the
 * member can type a manual estimate.
 */
export default function CrewStatus({ crewId, currentUserId, meetingPoints }: Props) {
  const { toast } = useToast();

  const statuses = useCrewStore((s) => s.crewStatuses);
  const loadStatuses = useCrewStore((s) => s.loadStatuses);
  const updateMyStatus = useCrewStore((s) => s.updateMyStatus);

  const [showForm, setShowForm] = useState(false);
  const [status, setStatus] = useState<'on-my-way' | 'here' | 'delayed'>('on-my-way');
  const [targetId, setTargetId] = useState<string>('');
  const [manualEta, setManualEta] = useState<string>('');
  const [note, setNote] = useState('');
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const { locating, getCurrentPosition } = useCurrentPosition();
  const [busy, setBusy] = useState(false);

  // Load once per crew. Offline this resolves from the persisted read-cache.
  useEffect(() => {
    if (crewId) loadStatuses(crewId).catch(() => {});
  }, [crewId, loadStatuses]);

  // Realtime crew:status-updated patching is wired centrally in
  // useRealtimeSync (it owns the single shared socket), so this component just
  // reads crewStore.crewStatuses — no per-component socket here.

  // Meeting points that actually have a saved coord — only these can produce a
  // geo-computed ETA. The picker still lists all points (coordless ones just
  // fall back to the manual estimate).
  const target = useMemo(() => meetingPoints.find((m) => m.id === targetId) ?? null, [meetingPoints, targetId]);

  // Geo-computed ETA: device position → target coord. null when either is
  // missing (no coord target, or no captured position) — then the manual
  // estimate is used.
  const computedEta = useMemo(() => {
    if (!coords || !target || typeof target.latitude !== 'number' || typeof target.longitude !== 'number') {
      return null;
    }
    return etaMinutes(
      { latitude: coords.lat, longitude: coords.lng },
      { latitude: target.latitude, longitude: target.longitude },
    );
  }, [coords, target]);

  const effectiveEta = computedEta ?? (manualEta.trim() ? Number(manualEta.trim()) : null);

  function reset() {
    setStatus('on-my-way');
    setTargetId('');
    setManualEta('');
    setNote('');
    setCoords(null);
    setShowForm(false);
  }

  // Capture the device position (browser Geolocation — no dep). Used to compute
  // a distance-based ETA to the target meeting point's saved coord. Denial
  // gracefully falls back to the manual estimate.
  async function captureLocation() {
    const pos = await getCurrentPosition((message) =>
      toast(
        message === 'Location is not available on this device'
          ? message
          : "Couldn't get your location — type an ETA estimate instead",
        'error',
      ),
    );
    if (pos) {
      setCoords({ lat: pos.lat, lng: pos.lng });
      toast('Location captured for ETA', 'success');
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      const eta = effectiveEta != null && Number.isFinite(effectiveEta) ? Math.round(effectiveEta) : null;
      await updateMyStatus(
        crewId,
        {
          status,
          targetMeetingPointId: targetId || null,
          etaMinutes: eta != null && eta >= 0 ? Math.min(eta, 1440) : null,
          note: note.trim() || null,
          // Persist the captured device coord as a last-synced breadcrumb (never
          // live). Omit position entirely when nothing was captured so the
          // server COALESCEs and leaves any prior breadcrumb untouched.
          ...(coords ? { position: { lat: coords.lat, lng: coords.lng } } : {}),
        },
        currentUserId,
      );
      // Honest, never "live": the write may be queued offline.
      toast('Status shared — sent when signal returns', 'success');
      reset();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Couldn't share status. Try again.", 'error');
    } finally {
      setBusy(false);
    }
  }

  async function clearMine() {
    setBusy(true);
    try {
      await updateMyStatus(
        crewId,
        { status: null, targetMeetingPointId: null, etaMinutes: null, note: null },
        currentUserId,
      );
      toast('Status cleared', 'success');
    } catch (err) {
      toast(err instanceof Error ? err.message : "Couldn't clear status. Try again.", 'error');
    } finally {
      setBusy(false);
    }
  }

  const mine = statuses.find((s) => s.user_id === currentUserId && s.status);
  const labelFor = (id: string | null) => (id ? (meetingPoints.find((m) => m.id === id)?.label ?? null) : null);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-text-primary flex items-center gap-1.5">
          <Navigation className="w-4 h-4 text-accent-aqua" aria-hidden="true" /> Crew status
        </h3>
        {!showForm && (
          <Button variant="outline" onClick={() => setShowForm(true)} className="text-xs">
            {mine ? 'Update mine' : 'On my way…'}
          </Button>
        )}
      </div>

      {/* Honesty banner: this is NEVER live. */}
      <p className="text-[11px] text-text-muted leading-snug">
        Last-synced positions, not live tracking. Sent when signal returns; shown “as of” when each crewmate last
        synced.
      </p>

      {showForm && (
        <form onSubmit={submit} className="p-3 rounded-lg bg-bg-card border border-border space-y-3">
          <div className="flex items-center justify-between">
            <span className="font-semibold text-sm text-text-primary">Share my status</span>
            <button
              type="button"
              aria-label="Cancel"
              onClick={reset}
              className="text-text-muted hover:text-text-primary"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Status">
            {(['on-my-way', 'here', 'delayed'] as const).map((key) => {
              const { Icon, label } = STATUS_META[key]!;
              return (
                <button
                  key={key}
                  type="button"
                  role="radio"
                  aria-checked={status === key}
                  onClick={() => setStatus(key)}
                  className={`px-2 py-2 rounded-lg border text-xs font-medium min-h-11 flex flex-col items-center gap-1 transition-colors ${
                    status === key
                      ? 'bg-accent-aqua/15 border-accent-aqua text-accent-aqua'
                      : 'bg-bg-card border-border text-text-secondary hover:border-border-light'
                  }`}
                >
                  <Icon className="w-5 h-5" aria-hidden="true" />
                  <span>{label}</span>
                </button>
              );
            })}
          </div>

          {/* ETA target: a meeting point. Coordless points still work (manual ETA). */}
          <label className="block text-xs text-text-secondary">
            Heading to
            <select
              className={`${inputBase} min-h-11 mt-1`}
              value={targetId}
              onChange={(e) => setTargetId(e.target.value)}
              aria-label="Target meeting point"
            >
              <option value="">— no specific point —</option>
              {meetingPoints.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                  {typeof m.latitude === 'number' && typeof m.longitude === 'number' ? ' (pinned)' : ''}
                </option>
              ))}
            </select>
          </label>

          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={captureLocation}
              isLoading={locating}
              className="min-h-11"
            >
              <LocateFixed className="w-4 h-4" aria-hidden="true" /> Use my location
            </Button>
            {computedEta != null ? (
              <span className="text-xs text-accent-aqua font-medium">ETA ~{computedEta} min</span>
            ) : (
              <input
                type="number"
                min={0}
                max={1440}
                inputMode="numeric"
                className={`${inputBase} min-h-11 w-28`}
                placeholder="ETA min"
                aria-label="ETA in minutes"
                value={manualEta}
                onChange={(e) => setManualEta(e.target.value)}
              />
            )}
          </div>

          <input
            className={`${inputBase} min-h-11`}
            placeholder="Note (optional, e.g. 'grabbing water first')"
            aria-label="Status note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={280}
          />

          <Button type="submit" variant="primary" isLoading={busy} className="w-full min-h-11">
            {target && status === 'on-my-way'
              ? `On my way to ${target.label}${effectiveEta != null ? ` · ETA ~${Math.round(effectiveEta)} min` : ''}`
              : 'Share status'}
          </Button>
        </form>
      )}

      {/* Crew status list with HONEST staleness. */}
      {statuses.filter((s) => s.status).length > 0 && (
        <ul className="space-y-2">
          {statuses
            .filter((s) => s.status)
            .map((s: CrewMemberStatus) => {
              const meta = s.status ? STATUS_META[s.status] : null;
              const isMe = s.user_id === currentUserId;
              const targetLabel = labelFor(s.target_meeting_point_id);
              return (
                <li key={s.user_id} className="p-2.5 rounded-lg bg-bg-card border border-border">
                  <div className="flex items-start gap-2">
                    {meta ? (
                      <meta.Icon className="w-5 h-5 text-text-secondary shrink-0" aria-hidden="true" />
                    ) : (
                      <MapPin className="w-5 h-5 text-text-muted shrink-0" aria-hidden="true" />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium text-text-primary truncate">
                          {isMe ? 'You' : s.name || s.username || 'Crewmate'}
                        </span>
                        <span className="text-xs text-text-secondary">{meta?.label ?? ''}</span>
                      </div>
                      {targetLabel && (
                        <div className="text-xs text-accent-aqua mt-0.5 flex items-center gap-1">
                          <MapPin className="w-3 h-3" aria-hidden="true" />
                          {targetLabel}
                          {typeof s.eta_minutes === 'number' ? ` · ETA ~${s.eta_minutes} min` : ''}
                        </div>
                      )}
                      {!targetLabel && typeof s.eta_minutes === 'number' && (
                        <div className="text-xs text-accent-aqua mt-0.5">ETA ~{s.eta_minutes} min</div>
                      )}
                      {s.note && <div className="text-xs text-text-secondary mt-0.5">{s.note}</div>}
                      {/* Last-synced breadcrumb — NOT live. Staleness is read from
                          location_captured_at (when the device stamped the fix),
                          distinct from updated_at (when the row last synced). */}
                      {typeof s.latitude === 'number' && typeof s.longitude === 'number' && s.location_captured_at && (
                        <a
                          href={`https://maps.google.com/?q=${s.latitude},${s.longitude}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[11px] text-text-secondary hover:text-accent-aqua mt-0.5 inline-flex items-center gap-1"
                        >
                          <MapPin className="w-3 h-3" aria-hidden="true" />
                          last seen {formatStaleness(s.location_captured_at)}
                        </a>
                      )}
                      {/* Honest staleness — the cardinal rule. */}
                      <div className="text-[11px] text-text-muted mt-1">{formatStaleness(s.updated_at)}</div>
                    </div>
                    {isMe && (
                      <button
                        type="button"
                        onClick={clearMine}
                        disabled={busy}
                        className="text-[11px] text-text-muted hover:text-accent-coral shrink-0 min-h-11 min-w-11 inline-flex items-center px-2"
                      >
                        Clear
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
        </ul>
      )}
    </div>
  );
}
