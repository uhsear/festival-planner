// Copyright (c) 2026 Asir Khan. All rights reserved.
// All Rights Reserved. See the LICENSE file.

import React, { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Square, Siren, Navigation, ShieldCheck, X, MapPin } from 'lucide-react';
import { api } from '@festie/shared';
import { useLiveLocationStore } from '@festie/shared/stores/liveLocationStore';
import { useFestivalModeStore } from '@festie/shared/stores/festivalModeStore';
import { useLiveLocationPublisher, type GeoWatcher } from '@festie/shared/hooks';
import { LIVE_LOCATION } from '@festie/shared/constants';
import { formatStaleness, formatShareWindow } from '@festie/shared/utils';
import { useSharedSocket } from '../../lib/socketContext';
import { useToast } from '../../lib/toastContext';
import Button from '../ui/Button';
import IconButton from '../ui/IconButton';
import { inputBase } from '../../lib/styles';

interface Props {
  crewId: string;
  currentUserId: string;
}

const SESSION_MINUTES = Math.round(LIVE_LOCATION.MAX_SESSION_MS / 60_000);

/**
 * LiveLocationControls — opt-in live-location sharing + SOS for the active crew.
 *
 * PRIVACY MODEL (see liveLocationStore header): sharing is OFF by default, is a
 * per-session opt-in that is never persisted (resets on reload), is scoped to
 * THIS crew only, and auto-stops on every exit path (toggle off, unmount, socket
 * disconnect, and a hard MAX_SESSION_MS cap). While sharing, a hard-to-miss,
 * non-dismissible banner with a one-tap Stop is always shown.
 *
 * SOS is HTTP (not a fire-and-forget socket emit) so it reliably writes the
 * crew_activity row + fans out push; it is online-only (never queued), so an
 * offline raise surfaces an explicit "use your phone/radio" error rather than a
 * silently-queued stale rescue.
 */
export default function LiveLocationControls({ crewId, currentUserId }: Props) {
  const socket = useSharedSocket();
  const { toast } = useToast();

  // Per-session opt-in. NOT persisted — always starts OFF (privacy requirement).
  const [sharing, setSharing] = useState(false);
  const sharingCrewId = useLiveLocationStore((s) => s.sharingCrewId);
  const sharingExpiresAt = useLiveLocationStore((s) => s.sharingExpiresAt);
  const sos = useLiveLocationStore((s) => s.sos);

  // Phase 4C: tick once a minute so the own-side "sharing ends in Nm" countdown
  // stays current. Only runs while sharing (cleared otherwise).
  const [nowTick, setNowTick] = useState(() => Date.now());
  useEffect(() => {
    if (!sharingExpiresAt) return;
    setNowTick(Date.now());
    const id = setInterval(() => setNowTick(Date.now()), 30_000);
    return () => clearInterval(id);
  }, [sharingExpiresAt]);
  const shareCountdown = sharingExpiresAt ? formatShareWindow(sharingExpiresAt, nowTick) : null;
  // Low-power mode disables the battery-hungry live-location auto-share (GPS
  // watch + socket emit loop). SOS stays available — it's an essential.
  const lowPowerMode = useFestivalModeStore((s) => s.lowPowerMode);

  // If low-power mode flips on while we're sharing, stop the GPS watch loop.
  useEffect(() => {
    if (lowPowerMode && sharing) setSharing(false);
  }, [lowPowerMode, sharing]);

  // Reactively track prefers-reduced-motion so the SOS ring class is always in
  // sync even if the user changes the OS setting while the component is mounted.
  const prefersReducedMotion = useSyncExternalStore(
    (cb) => {
      const mql = typeof window !== 'undefined' ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
      mql?.addEventListener('change', cb);
      return () => mql?.removeEventListener('change', cb);
    },
    () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    () => false,
  );

  const [sosOpen, setSosOpen] = useState(false);
  const [sosMessage, setSosMessage] = useState('');
  const [sosBusy, setSosBusy] = useState(false);
  const [clearBusy, setClearBusy] = useState(false);

  // Adapter: navigator.geolocation.watchPosition → the publisher's GeoWatcher
  // shape. Stable identity (the publisher assumes a stable watcher). Balanced
  // accuracy (enableHighAccuracy:false) to spare battery at a festival.
  const watchPosition = useMemo<GeoWatcher>(
    () => (onFix, onError) => {
      if (typeof navigator === 'undefined' || !navigator.geolocation) {
        onError?.(new Error('GEO_UNSUPPORTED'));
        return () => {};
      }
      const id = navigator.geolocation.watchPosition(
        (pos) =>
          onFix({
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            accuracy: pos.coords.accuracy ?? undefined,
            heading: pos.coords.heading ?? undefined,
            speed: pos.coords.speed ?? undefined,
            // TODO(battery): the Battery Status API (navigator.getBattery()) is
            // non-standard and unavailable in Safari/iOS, so battery is left
            // undefined here for parity with mobile (build-gated). The payload
            // field + peer popup already exist; wire getBattery().level×100 when a
            // cross-browser source is acceptable.
            capturedAt: new Date(pos.timestamp).toISOString(),
          }),
        (err) => onError?.(err),
        { enableHighAccuracy: false, maximumAge: 10_000, timeout: 20_000 },
      );
      return () => navigator.geolocation.clearWatch(id);
    },
    [],
  );

  useLiveLocationPublisher({
    socket,
    crewId,
    enabled: sharing,
    watchPosition,
    onAutoStop: () => {
      setSharing(false);
      toast(`Live location stopped automatically after ${SESSION_MINUTES} minutes.`, 'info');
    },
    onError: (err) => {
      setSharing(false);
      const denied =
        typeof err === 'object' && err !== null && 'code' in err && (err as GeolocationPositionError).code === 1;
      toast(
        denied
          ? 'Location permission denied — turn it on in your browser to share.'
          : "Couldn't read your location — live sharing stopped.",
        'error',
      );
    },
  });

  function toggleSharing() {
    if (sharing) {
      setSharing(false);
      return;
    }
    if (lowPowerMode) {
      toast('Low-power mode is on — turn it off to share your live location.', 'info');
      return;
    }
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      toast('Location is not available on this device.', 'error');
      return;
    }
    if (!socket || !socket.connected) {
      toast('Not connected — can’t share your location right now.', 'error');
      return;
    }
    setSharing(true);
  }

  // Best-effort one-shot fix to attach to the SOS so the crew can actually find
  // the person. Never blocks the raise — resolves null on denial/timeout.
  function oneShotPosition(): Promise<{ lat: number; lng: number; accuracy?: number; capturedAt: string } | undefined> {
    return new Promise((resolve) => {
      if (typeof navigator === 'undefined' || !navigator.geolocation) return resolve(undefined);
      navigator.geolocation.getCurrentPosition(
        (pos) =>
          resolve({
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            accuracy: pos.coords.accuracy ?? undefined,
            capturedAt: new Date(pos.timestamp).toISOString(),
          }),
        () => resolve(undefined),
        { enableHighAccuracy: true, maximumAge: 0, timeout: 8_000 },
      );
    });
  }

  async function raiseSos() {
    if (sosBusy) return;
    setSosBusy(true);
    try {
      const position = await oneShotPosition();
      const message = sosMessage.trim();
      await api.post(`/crews/${crewId}/sos`, {
        ...(message ? { message } : {}),
        ...(position ? { position } : {}),
      });
      toast('SOS sent to your crew', 'success');
      setSosOpen(false);
      setSosMessage('');
    } catch {
      // SOS is online-only (never queued). The safe failure is to TELL the user.
      toast('No signal — SOS not sent. Use your phone or radio.', 'error');
    } finally {
      setSosBusy(false);
    }
  }

  async function clearSos() {
    if (clearBusy) return;
    setClearBusy(true);
    try {
      await api.post(`/crews/${crewId}/sos/clear`, {});
      // The server broadcasts sos:cleared back to the room (we're in it) which
      // clears the store; clear optimistically too so the banner dismisses now.
      useLiveLocationStore.getState().clearSos();
      toast('SOS cleared', 'success');
    } catch {
      toast('Couldn’t clear the SOS — check your connection.', 'error');
    } finally {
      setClearBusy(false);
    }
  }

  const isSharingThisCrew = sharing && sharingCrewId === crewId;
  const showSos = sos && sos.crewId === crewId;
  const sosIsMine = showSos && sos.userId === currentUserId;

  return (
    <div className="space-y-2">
      {/* ── Active SOS banner (crew-wide, prominent) ───────────────────────── */}
      {showSos && (
        <div
          role="alert"
          aria-atomic="true"
          data-testid="sos-banner"
          className="rounded-lg border-2 border-accent-coral bg-accent-coral/15 p-3 space-y-2 animate-[card-in_220ms_var(--ease-out,ease-out)_both] motion-reduce:!animate-none"
        >
          <div className="flex items-start gap-2">
            <Siren className="w-5 h-5 text-accent-coral shrink-0 mt-0.5" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <p className="font-bold text-text-primary">
                {sosIsMine ? 'You raised an SOS' : `${sos!.username} raised an SOS`}
              </p>
              {sos!.message && <p className="text-sm text-text-secondary mt-0.5 break-words">{sos!.message}</p>}
              <p className="text-xs text-text-muted mt-0.5">{formatStaleness(sos!.raisedAt)}</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {sos!.position && (
              <Button
                variant="secondary"
                size="sm"
                onClick={() =>
                  window.open(
                    `https://maps.google.com/?q=${sos!.position!.lat},${sos!.position!.lng}`,
                    '_blank',
                    'noopener,noreferrer',
                  )
                }
              >
                <Navigation className="w-4 h-4" aria-hidden="true" /> Get directions
              </Button>
            )}
            {sosIsMine && (
              <Button variant="primary" size="sm" onClick={clearSos} isLoading={clearBusy}>
                <ShieldCheck className="w-4 h-4" aria-hidden="true" /> I&apos;m safe — clear SOS
              </Button>
            )}
          </div>
        </div>
      )}

      {/* ── Sharing indicator (non-dismissible while active) ───────────────── */}
      {isSharingThisCrew && (
        <div
          role="status"
          aria-live="polite"
          data-testid="sharing-indicator"
          className="flex items-center gap-3 rounded-lg border border-accent-aqua bg-accent-aqua/10 p-3"
        >
          <span className="festie-live-dot" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-text-primary">You&apos;re sharing your live location</p>
            <p className="text-xs text-text-muted">
              Only this crew can see it. Stops automatically when you leave{shareCountdown ? ` — ${shareCountdown}` : ''}.
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setSharing(false)}
            aria-label="Stop sharing my live location"
          >
            <Square className="w-4 h-4" aria-hidden="true" /> Stop
          </Button>
        </div>
      )}

      {/* ── Share toggle + SOS button ──────────────────────────────────────── */}
      <div className="flex flex-col gap-2 rounded-lg border border-border bg-bg-card p-3">
        <div className="flex items-center gap-3">
          <MapPin className="w-5 h-5 text-text-secondary shrink-0" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <p id="live-share-label" className="text-sm font-semibold text-text-primary">
              Share my live location with this crew
            </p>
            <p id="live-share-desc" className="text-xs text-text-muted">
              {lowPowerMode
                ? 'Paused by low-power mode to save battery. Turn it off in Festival Mode to share.'
                : `Ephemeral and crew-only. Auto-stops on exit and after ${SESSION_MINUTES} min.`}
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={isSharingThisCrew}
            aria-labelledby="live-share-label"
            aria-describedby="live-share-desc"
            onClick={toggleSharing}
            disabled={lowPowerMode}
            data-testid="live-share-toggle"
            className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-aqua disabled:opacity-40 disabled:cursor-not-allowed ${
              isSharingThisCrew ? 'bg-accent-aqua' : 'bg-border-light'
            }`}
          >
            <span
              className={`inline-block h-5 w-5 transform rounded-full bg-white transition-transform ${
                isSharingThisCrew ? 'translate-x-[22px]' : 'translate-x-0.5'
              }`}
            />
          </button>
        </div>

        <div className="h-px bg-border" />

        {/* R24: pulse ring ONLY while an active SOS exists (emergency context;
            continuous animation is justified here). sos-fab-alerting is the
            animated ring; sos-fab-static-ring is the reduce-motion fallback
            (high-contrast static outline, no animation). */}
        <Button
          variant="danger"
          onClick={() => setSosOpen(true)}
          className={`w-full min-h-11${
            showSos
              ? prefersReducedMotion
                ? ' sos-fab-static-ring'
                : ' sos-fab-alerting'
              : ''
          }`}
          aria-label="Raise an SOS to your crew"
        >
          <Siren className="w-4 h-4" aria-hidden="true" /> Raise SOS
        </Button>
      </div>

      {/* ── SOS confirm dialog (guards against accidental triggers) ─────────── */}
      <Dialog.Root open={sosOpen} onOpenChange={(o: boolean) => !sosBusy && setSosOpen(o)}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm data-[state=open]:animate-in data-[state=open]:fade-in" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[92vw] max-w-sm -translate-x-1/2 -translate-y-1/2 space-y-4 rounded-2xl border border-border-light bg-bg-card p-5 shadow-2xl data-[state=open]:animate-in data-[state=open]:zoom-in-95">
            <div className="flex items-start justify-between gap-3">
              <div>
                <Dialog.Title className="flex items-center gap-2 text-base font-bold text-text-primary">
                  <Siren className="w-5 h-5 text-accent-coral" aria-hidden="true" /> Raise an SOS?
                </Dialog.Title>
                <Dialog.Description className="mt-1 text-sm text-text-secondary">
                  This alerts everyone in your crew with a push notification and your last-known location. Use it only
                  in an emergency.
                </Dialog.Description>
              </div>
              <Dialog.Close asChild>
                <IconButton label="Close" icon={<X className="w-5 h-5" />} disabled={sosBusy} />
              </Dialog.Close>
            </div>

            <textarea
              value={sosMessage}
              onChange={(e) => setSosMessage(e.target.value)}
              placeholder="Optional: what's happening? (e.g. 'Lost near Main Stage')"
              maxLength={280}
              rows={3}
              aria-label="Optional SOS message"
              disabled={sosBusy}
              className={`${inputBase} resize-none`}
            />

            <div className="flex gap-2">
              <Dialog.Close asChild>
                <Button variant="outline" type="button" className="flex-1 min-h-11" disabled={sosBusy}>
                  Cancel
                </Button>
              </Dialog.Close>
              <Button type="button" variant="danger" onClick={raiseSos} isLoading={sosBusy} className="flex-1 min-h-11">
                {sosBusy ? 'Sending…' : 'Send SOS'}
              </Button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}
