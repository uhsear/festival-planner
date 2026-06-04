// Copyright (c) 2026 Asir Khan. All rights reserved.
// Licensed under the Business Source License 1.1. See LICENSE file for details.

import { useMemo, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { QRCodeSVG } from 'qrcode.react';
import { QrCode, X } from 'lucide-react';
import { useFestivalStore, useCrewStore } from '@festie/shared/stores';
import {
  encodePlanSnapshot,
  toPickPriority,
  MAX_PICKS,
  MAX_ENCODED_LENGTH,
  type PlanSnapshotInput,
} from '@festie/shared/utils';
import type { CrewMeetingPoint, Priority } from '@festie/shared/types';
import Button from '../ui/Button';
import IconButton from '../ui/IconButton';

// ── Snapshot assembly (offline-native, zero network) ───────────────────────
// Mirrors mobile PlanQRShare EXACTLY: builds the compact P2P snapshot ENTIRELY
// from the persisted stores already in memory — currentFestival +
// currentProfile.picks (festivalStore) and the active meeting point
// (crewStore). No fetches: works on a dead-signal device. Picks are
// priority-ranked (must > want > maybe) and capped to MAX_PICKS so an
// over-long plan still produces a single scannable code; the SAME shared
// codec mobile uses also truncates defensively.

const PRIORITY_RANK: Record<string, number> = { must: 3, 'want-to-see': 2, maybe: 1 };

/** Soonest active, future meeting point with a coord; falls back to any active+coord one. */
function pickShareMeetingPoint(points: CrewMeetingPoint[], nowMs: number): CrewMeetingPoint | null {
  const withCoord = points.filter((p) => p.active && typeof p.latitude === 'number' && typeof p.longitude === 'number');
  const future = withCoord
    .filter((p) => p.meet_at)
    .map((p) => ({ p, ms: new Date(p.meet_at as string).getTime() }))
    .filter(({ ms }) => Number.isFinite(ms) && ms >= nowMs)
    .sort((a, b) => a.ms - b.ms);
  if (future.length > 0) return future[0]!.p;
  return withCoord[0] ?? null;
}

interface SnapshotState {
  encoded: string | null;
  picksCount: number;
  meetingPoint: CrewMeetingPoint | null;
  tooLong: boolean;
  ready: boolean;
}

/**
 * Builds (memoised) the encoded plan snapshot from the live stores. Exported so
 * tests can exercise the encode path without rendering the modal.
 */
function usePlanSnapshot(): SnapshotState {
  const currentFestival = useFestivalStore((s) => s.currentFestival);
  const currentProfile = useFestivalStore((s) => s.currentProfile);
  const meetingPoints = useCrewStore((s) => s.meetingPoints);

  return useMemo<SnapshotState>(() => {
    if (!currentFestival || !currentProfile) {
      return { encoded: null, picksCount: 0, meetingPoint: null, tooLong: false, ready: false };
    }

    // Rank picks must > want > maybe, then cap to MAX_PICKS so the most
    // important picks survive the bound (the codec truncates the tail).
    const picks = Object.entries((currentProfile.picks as Record<string, Priority>) || {})
      .map(([setId, priority]) => ({ setId, priority: priority as string }))
      .sort((a, b) => (PRIORITY_RANK[b.priority] ?? 0) - (PRIORITY_RANK[a.priority] ?? 0))
      .slice(0, MAX_PICKS)
      .map((p) => ({ setId: p.setId, priority: toPickPriority(p.priority) }));

    const mp = pickShareMeetingPoint(meetingPoints ?? [], Date.now());

    const input: PlanSnapshotInput = {
      festivalId: currentFestival.id,
      festivalName: currentFestival.name,
      picks,
      ...(mp && typeof mp.latitude === 'number' && typeof mp.longitude === 'number'
        ? { meetingPoint: { label: mp.label, lat: mp.latitude, lng: mp.longitude } }
        : {}),
    };

    const enc = encodePlanSnapshot(input);
    return {
      encoded: enc,
      picksCount: picks.length,
      meetingPoint: mp,
      tooLong: enc.length > MAX_ENCODED_LENGTH,
      ready: true,
    };
  }, [currentFestival, currentProfile, meetingPoints]);
}

/** Inner panel content — pulled out so the modal body stays focused. */
function PlanQRBody() {
  const { encoded, picksCount, meetingPoint, tooLong, ready } = usePlanSnapshot();

  if (!ready) {
    return (
      <p className="text-sm text-text-secondary text-center py-6">
        Open a festival and add a few picks, then come back to share them.
      </p>
    );
  }

  // Defensive: the codec is size-bounded, but if a plan somehow exceeds the
  // scannable limit, say so honestly rather than render an unscannable code.
  if (!encoded || tooLong) {
    return (
      <p className="text-sm text-text-secondary text-center py-6" data-testid="plan-qr-too-large">
        This plan is too big to fit in one QR code. Trim a few picks and try again — a QR code can only hold so much.
      </p>
    );
  }

  return (
    <div className="flex flex-col items-center gap-4">
      <p className="text-sm text-text-secondary text-center">
        {picksCount} pick{picksCount === 1 ? '' : 's'}
        {meetingPoint ? ` · meet at ${meetingPoint.label}` : ''}
      </p>

      {/* High-contrast dark-on-white tile so cameras lock fast in low festival light. */}
      <div
        className="rounded-xl bg-white p-4"
        data-testid="plan-qr-code"
        role="img"
        aria-label="QR code of your festival plan — scan with another Festie app to share your picks and meeting point"
      >
        <QRCodeSVG value={encoded} size={240} level="M" fgColor="#080810" bgColor="#FFFFFF" marginSize={0} />
      </div>

      <p className="text-sm text-text-secondary text-center">
        Have your friend open Festie → scan this. Works offline — nothing is sent over the internet. They get a snapshot
        copy, not a live link.
      </p>
      <p className="text-xs text-text-muted text-center">
        This shares your current picks{meetingPoint ? ' and the active meeting point' : ''} as a snapshot — your friend
        gets a copy as it stands now, not a live link.
      </p>
    </div>
  );
}

interface Props {
  /** Optional className for the trigger button wrapper. */
  className?: string;
}

/**
 * "Share plan (QR)" trigger + modal. The web counterpart of mobile's
 * PlanQRShare: renders a QR of the encoded plan snapshot so a nearby friend can
 * scan it onto their own phone with NO internet on either device. Reuses the
 * Radix Dialog primitive (same one ConfirmDialog/PromptDialog build on).
 */
export default function PlanQRShare({ className }: Props) {
  const [open, setOpen] = useState(false);
  const currentFestival = useFestivalStore((s) => s.currentFestival);

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <Button variant="secondary" size="sm" type="button" className={className} aria-label="Share plan as QR code">
          <QrCode className="w-4 h-4" aria-hidden="true" />
          Share plan (QR)
        </Button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm data-[state=open]:animate-in data-[state=open]:fade-in" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-50 w-[92vw] max-w-sm -translate-x-1/2 -translate-y-1/2
                     rounded-2xl bg-bg-card border border-border-light shadow-2xl p-5 space-y-4
                     data-[state=open]:animate-in data-[state=open]:zoom-in-95"
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <Dialog.Title className="text-base font-bold text-text-primary">
                {currentFestival?.name ? `Share ${currentFestival.name}` : 'Share plan'}
              </Dialog.Title>
              <Dialog.Description className="mt-1 text-sm text-text-secondary">
                Hand your plan to a friend over the air — no signal needed.
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <IconButton label="Close" icon={<X className="w-5 h-5" />} />
            </Dialog.Close>
          </div>

          <PlanQRBody />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
