import React, { memo, useRef, useState, useEffect, useMemo } from 'react';
import { FestivalSet, Priority } from '@festie/shared/types';
import { usePicks } from '@festie/shared/hooks';
import { formatTime, artistDisplayName, artistSubtitle } from '@festie/shared/utils';
import { useFestivalStore, useCrewStore } from '@festie/shared/stores';
import { api } from '@festie/shared/services/api';
import { useSetStatus } from '@/hooks/useSetStatus';
import { useToast } from '@/lib/toastContext';
import { useHaptics } from '@/hooks/useHaptics';
import { cn } from '@/lib/utils';
import LiveBadge from './LiveBadge';
import Avatar from '../ui/Avatar';
import { ensureWhiteContrast } from '../ui/StageBadge';

interface SpotifyPreviewResponse {
  /** Direct mp3 URL if the backend has one. */
  url?: string;
  /** Fallback embed URL (real /spotify/preview/:setId response shape). */
  embedUrl?: string;
  embedType?: 'track' | 'artist' | null;
}

interface SetCardProps {
  set: FestivalSet;
  onTap: () => void;
  onPreview?: () => void;
  showPicks?: boolean;
  stageName?: string;
  stageColor?: string;
  friendProfiles?: Array<{
    profileId?: string;
    name?: string;
    avatarUrl?: string | null;
    priority: Priority;
    color?: string;
    initials?: string;
  }>;
  conflicts?: FestivalSet[];
  b2bSeparator?: string;
}

const PRI_MAP: Record<string, string> = {
  must: 'must',
  'want-to-see': 'want',
  maybe: 'maybe',
};

// Crew-overlap avatars cluster by priority: must first, then want, then maybe.
// Lower rank sorts earlier. Drives both the visible avatar order and the
// "N of your crew have this as a must" aria-label.
const PRIORITY_RANK: Record<Priority, number> = {
  must: 0,
  'want-to-see': 1,
  maybe: 2,
};

const PRIORITY_NOUN: Record<Priority, string> = {
  must: 'must',
  'want-to-see': 'want',
  maybe: 'maybe',
};

/**
 * Build the human "N of your crew have this as a must" breakdown phrase from a
 * priority-grouped friend list, e.g. "2 must, 1 want". Empty groups are
 * omitted; an all-empty list yields ''.
 */
function buildOverlapBreakdown(friends: readonly { priority: Priority }[]): string {
  const counts: Record<Priority, number> = {
    must: 0,
    'want-to-see': 0,
    maybe: 0,
  };
  for (const f of friends) counts[f.priority] = (counts[f.priority] ?? 0) + 1;
  return (['must', 'want-to-see', 'maybe'] as const)
    .filter((p) => counts[p] > 0)
    .map((p) => `${counts[p]} ${PRIORITY_NOUN[p]}`)
    .join(', ');
}

function SetCard({
  set,
  onTap,
  onPreview,
  showPicks = true,
  stageName = set.stageName || 'Unknown',
  stageColor = 'var(--color-accent-coral)',
  friendProfiles = [],
  conflicts = [],
  b2bSeparator,
}: SetCardProps) {
  const { getMyPick, savePick, getMyNote } = usePicks();
  const currentFestival = useFestivalStore((state) => state.currentFestival);
  // Read-only joins for the crew-overlap cluster: profiles supply the
  // profileId -> userId link, crew members supply the avatar image. Both are
  // already persisted (Foundations F1), so the cluster renders offline.
  const allProfiles = useFestivalStore((state) => state.allProfiles);
  const crewMembers = useCrewStore((state) => state.crewMembers);
  const { toast } = useToast();
  const { tap, select, warning } = useHaptics();
  const [saving, setSaving] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewPlaying, setPreviewPlaying] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioListenersRef = useRef<{ ended: () => void; error: () => void } | null>(null);
  const setStatus = useSetStatus(set);

  // Cleanup audio element and its event listeners on unmount to prevent leaks.
  useEffect(() => {
    return () => {
      const audio = audioRef.current;
      if (audio) {
        audio.pause();
        audio.src = '';
        if (audioListenersRef.current) {
          audio.removeEventListener('ended', audioListenersRef.current.ended);
          audio.removeEventListener('error', audioListenersRef.current.error);
        }
        audioRef.current = null;
        audioListenersRef.current = null;
      }
    };
  }, []);

  const myPick = getMyPick(set.id);
  const myNote = getMyNote(set.id);
  const artistName = artistDisplayName(set, b2bSeparator);
  const subtitle = artistSubtitle(set, b2bSeparator);

  const pri = myPick ? PRI_MAP[myPick] : null;
  const hasConflict = conflicts.length > 0;

  // Enrich + group the crew-overlap cluster:
  //  1. join each friend (profileId -> profile.userId -> crewMember.avatar) to
  //     pull a real avatar image, falling back to the name/initials already on
  //     the friend profile when the member isn't in the persisted crew roster;
  //  2. sort must > want > maybe so the cluster reads priority-first.
  // Pure reads of already-persisted state, so this stays correct offline.
  const groupedFriends = useMemo(() => {
    if (friendProfiles.length === 0) return [];
    const userIdByProfileId = new Map<string, string>();
    for (const p of allProfiles) userIdByProfileId.set(p.id, p.userId);
    const memberByUserId = new Map<string, (typeof crewMembers)[number]>();
    for (const m of crewMembers) memberByUserId.set(m.userId, m);

    return friendProfiles
      .map((f) => {
        const userId = f.profileId ? userIdByProfileId.get(f.profileId) : undefined;
        const member = userId ? memberByUserId.get(userId) : undefined;
        return {
          ...f,
          // Prefer a synced crew avatar; fall back to whatever the caller
          // supplied (which may be undefined → Avatar renders initials).
          avatarUrl: member?.avatar ?? f.avatarUrl ?? null,
          name: f.name ?? member?.name,
        };
      })
      .sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]);
  }, [friendProfiles, allProfiles, crewMembers]);

  const handlePriorityChange = async (priority: string, currentlyActive: boolean) => {
    // Haptic tick fires BEFORE the optimistic store update so the vibration
    // aligns with the finger lift, not the server round-trip. savePick is
    // already optimistic (see festivalStore.savePick) so the star fills
    // instantly either way — haptic just reinforces the state change.
    select();
    setSaving(true);
    try {
      if (currentFestival) {
        await savePick(currentFestival.id, set.id, currentlyActive ? null : (priority as Priority));
      }
    } catch {
      warning();
    } finally {
      setSaving(false);
    }
  };

  const handlePreviewClick = async (e: React.MouseEvent) => {
    // Keep the outer card-click handler from firing (task: don't open detail).
    e.stopPropagation();
    e.preventDefault();

    // Toggle stop if already playing.
    if (previewPlaying && audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      setPreviewPlaying(false);
      return;
    }

    setPreviewError(null);
    setPreviewLoading(true);
    try {
      const data = await api.get<SpotifyPreviewResponse>(`/spotify/preview/${set.id}`);
      // Prefer a direct mp3 URL (task contract). Fall back to the real
      // /spotify/preview response shape which returns embedUrl for non-mp3
      // Spotify embeds — we can't inline-play those via <audio>, so surface
      // a friendly "No preview" and let users open the detail panel.
      const src = data?.url;
      if (!src) {
        if (data?.embedType) {
          // No 30-sec clip but Spotify embed is available — open detail panel
          // with Spotify auto-expanded (via onPreview), or fall back to onTap.
          (onPreview ?? onTap)();
        } else {
          setPreviewError('No preview');
          toast('No preview available', 'info');
        }
        return;
      }
      if (!audioRef.current) {
        audioRef.current = new Audio();
        const onEnded = () => setPreviewPlaying(false);
        const onError = () => {
          setPreviewPlaying(false);
          setPreviewError('Playback failed');
        };
        audioRef.current.addEventListener('ended', onEnded);
        audioRef.current.addEventListener('error', onError);
        audioListenersRef.current = { ended: onEnded, error: onError };
      }
      audioRef.current.src = src;
      await audioRef.current.play();
      setPreviewPlaying(true);
    } catch {
      setPreviewError('No preview');
      toast('No preview available', 'info');
    } finally {
      setPreviewLoading(false);
    }
  };

  return (
    <div
      className={cn(
        // Keep CSS class names for container query selectors (Phase 4 cleanup)
        'set-card',
        // Base styles — mobile glass card with an unconditional stage-colored
        // left border (color set inline below). Softer radius + density.
        'relative bg-bg-card glass-xs border border-border rounded-xl',
        'p-4 cursor-pointer overflow-hidden',
        'border-l-4',
        // Transition + will-change — token-eased, reduce-motion safe.
        'transition-all duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] will-change-transform',
        'motion-reduce:transition-none motion-reduce:transform-none',
        // Hover — gentle lift + surface shift + light glow (no heavy drop shadow).
        'hover:bg-bg-card-hover hover:-translate-y-0.5',
        'hover:shadow-[0_0_0_1px_var(--color-overlay-2)]',
        // ::after subtle aqua sheen on hover only (much lighter than before).
        'after:content-[""] after:absolute after:inset-[-1px] after:rounded-[inherit]',
        'after:opacity-0 after:transition-opacity after:duration-200 after:pointer-events-none',
        'after:bg-[linear-gradient(135deg,var(--color-aqua-a06)_0%,transparent_60%)]',
        'hover:after:opacity-100',
        // Priority variants — lighter, static glow (no infinite pulse for list perf).
        pri === 'must' && ['priority-must', 'shadow-[var(--shadow-glow-coral)]'],
        pri === 'want' && ['priority-want', 'shadow-[var(--shadow-glow-aqua)]'],
        pri === 'maybe' && ['priority-maybe', 'shadow-[var(--shadow-glow-amber)]'],
        // Conflict marker class (for tests + potential styling)
        hasConflict && 'has-conflict',
      )}
      style={{ borderLeftColor: ensureWhiteContrast(stageColor) }}
      data-testid="set-card"
      data-artist={artistName}
    >
      {/* Click/keyboard target — positioned absolute to fill the card so the
          outer div can stay non-interactive (avoids nested-interactive axe
          violation when footer buttons render as children). Footer buttons
          are positioned above via z-index. */}
      <button
        type="button"
        className={cn(
          'set-card-click-target',
          'absolute inset-0 z-[1] cursor-pointer border-0 bg-transparent p-0 m-0',
          'focus-visible:outline-2 focus-visible:outline-accent-aqua focus-visible:outline-offset-[-2px] focus-visible:rounded-[inherit]',
        )}
        aria-label={`${artistName} — ${stageName} ${set.startTime ? formatTime(set.startTime) : 'TBA'}`}
        onClick={() => {
          tap();
          onTap();
        }}
      />

      {/* Spotify preview button — top-right corner, above click target */}
      {set.artists?.some((a) => a.links?.spotify) && (
        <button
          className={cn(
            'card-preview-btn',
            'absolute top-2 right-2 z-[2]',
            'bg-spotify/20 border border-spotify/40 text-spotify',
            'rounded-full w-11 h-11 text-sm cursor-pointer',
            'flex items-center justify-center',
            'transition-[background,transform] duration-150',
            'hover:bg-spotify/30 hover:scale-105',
          )}
          type="button"
          aria-label={previewPlaying ? `Stop preview for ${artistName}` : `Preview ${artistName}`}
          title={previewError || (previewPlaying ? 'Stop preview' : 'Play preview')}
          disabled={previewLoading}
          onClick={handlePreviewClick}
        >
          {previewPlaying ? '◼' : '▶'}
        </button>
      )}

      <span
        className={cn(
          'card-stage',
          'relative z-[2] inline-block px-2 py-1 rounded-xl',
          'type-micro font-bold uppercase tracking-[0.08em] mb-2.5',
          'text-white [text-shadow:0_1px_2px_rgba(0,0,0,0.35)]',
        )}
        style={{ background: ensureWhiteContrast(stageColor) }}
      >
        {stageName}
      </span>

      {/* Artist name */}
      <div
        className={cn(
          'card-artist',
          'relative z-[2] pointer-events-none',
          'type-title font-bold leading-[1.15] mb-1',
          'bg-gradient-to-br from-text-primary to-[rgba(234,234,242,0.85)]',
          'bg-clip-text',
        )}
      >
        {artistName}
      </div>
      {subtitle && (
        <div
          className={cn(
            'card-artist-sub',
            'relative z-[2] pointer-events-none',
            'text-[11px] font-medium leading-[1.35] text-text-muted mt-0.5',
            'overflow-hidden text-ellipsis',
            '[-webkit-line-clamp:2] [-webkit-box-orient:vertical] [display:-webkit-box]',
            'break-words max-h-[2.7em]',
          )}
        >
          {subtitle}
        </div>
      )}

      {/* Time + indicators */}
      <div
        className={cn(
          'card-time',
          'relative z-[2] pointer-events-none',
          'flex items-center gap-2 flex-wrap',
          'type-caption text-text-secondary tabular-nums mb-3',
        )}
      >
        <span>
          {set.startTime && set.endTime ? `${formatTime(set.startTime)} - ${formatTime(set.endTime)}` : 'TBA'}
        </span>
        {myNote && (
          <span className="card-note-indicator text-xs opacity-50" aria-label="Has note">
            📝
          </span>
        )}
        {hasConflict && (
          <span
            className={cn(
              'text-[11px] font-bold py-0.5 px-1.5 rounded-sm leading-tight',
              'bg-[rgba(255,51,102,0.15)] text-accent-coral',
              'border border-[rgba(255,51,102,0.3)]',
              'tracking-[0.5px] uppercase',
            )}
          >
            ⚠ Conflict
          </span>
        )}
      </div>

      {/* Live badge */}
      {['live', 'soon', 'upcoming'].includes(setStatus.status) && (
        <LiveBadge status={setStatus.status} label={setStatus.label} />
      )}

      {/* Footer with priority buttons, crew overlap, and preview */}
      <div className={cn('card-footer', 'relative z-[2]', 'flex items-center justify-between mt-3')}>
        {/* Priority buttons */}
        {showPicks && (
          <div className="card-priority flex gap-3">
            {(
              [
                ['must', '★'],
                ['want-to-see', '◆'],
                ['maybe', '●'],
              ] as const
            ).map(([p, icon]) => {
              const active = myPick === p;
              const priKey = PRI_MAP[p];
              return (
                <button
                  key={p}
                  className={cn(
                    'card-priority-btn',
                    'w-11 h-11 min-w-11 min-h-11 rounded-full',
                    'flex items-center justify-center',
                    'bg-white/[0.06] border border-border-light',
                    'text-sm text-text-muted cursor-pointer',
                    'transition-[transform,box-shadow,background,border-color,color] duration-200 ease-[cubic-bezier(0.16,1,0.3,1)]',
                    'hover:border-text-secondary hover:scale-105',
                    'focus-visible:outline-2 focus-visible:outline-accent-aqua focus-visible:outline-offset-[-2px]',
                    'active:scale-[0.92] motion-reduce:transform-none',
                    // Active priority states — static glow (mobile keeps these
                    // static for list-scroll perf; no infinite pulse animation).
                    active &&
                      priKey === 'must' && [
                        'active-must',
                        'bg-priority-must text-text-on-accent border-priority-must',
                        'shadow-[var(--shadow-glow-coral),0_0_0_1px_rgba(255,51,102,0.3)]',
                      ],
                    active &&
                      priKey === 'want' && [
                        'active-want',
                        'bg-priority-want text-[var(--text-on-light-accent)] border-priority-want',
                        'shadow-[var(--shadow-glow-aqua),0_0_0_1px_var(--color-aqua-a3)]',
                      ],
                    active &&
                      priKey === 'maybe' && [
                        'active-maybe',
                        'bg-priority-maybe text-[var(--text-on-light-accent)] border-priority-maybe',
                        'shadow-[var(--shadow-glow-amber),0_0_0_1px_var(--color-amber-a3)]',
                      ],
                  )}
                  type="button"
                  aria-pressed={active ? 'true' : 'false'}
                  aria-label={
                    (p === 'must' ? 'Must See' : p === 'want-to-see' ? 'Want to See' : 'Maybe') +
                    (active ? ' (selected)' : '')
                  }
                  title={p === 'must' ? 'Must See' : p === 'want-to-see' ? 'Want to See' : 'Maybe'}
                  disabled={saving}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    handlePriorityChange(p, active);
                  }}
                >
                  {icon}
                </button>
              );
            })}
          </div>
        )}

        {/* Crew overlap / who's going */}
        {groupedFriends.length > 0 &&
          (() => {
            // Render compact avatars when crew identity data (name/initials/avatar)
            // is present; otherwise fall back to the bare "N going" count.
            const hasAvatarData = groupedFriends.some((f) => f.name || f.initials || f.avatarUrl);
            const count = groupedFriends.length;
            const countLabel = count === 1 ? '1 going' : `${count} going`;
            // Priority-grouped label, e.g. "2 of your crew going to X — 1 must,
            // 1 maybe". Surfaces the must>want>maybe breakdown to screen readers.
            const breakdown = buildOverlapBreakdown(groupedFriends);
            const ariaLabel =
              `${count} crew ${count === 1 ? 'member' : 'members'} going to ${artistName}` +
              (breakdown ? ` — ${breakdown}` : '');
            const visible = groupedFriends.slice(0, 3);
            const overflow = count - visible.length;

            return (
              <button
                className={cn(
                  'card-overlap',
                  'flex gap-2 items-center cursor-pointer',
                  'bg-transparent border-0 p-0 text-inherit font-inherit appearance-none',
                  'min-h-11 inline-flex',
                  'focus-visible:outline-2 focus-visible:outline-accent-aqua focus-visible:outline-offset-2 focus-visible:rounded-sm',
                )}
                type="button"
                aria-label={ariaLabel}
                onClick={(e) => {
                  e.stopPropagation();
                }}
              >
                {hasAvatarData ? (
                  <span className="flex items-center" aria-hidden="true">
                    {visible.map((f, i) => (
                      <Avatar
                        key={f.profileId ?? `${f.name ?? 'crew'}-${i}`}
                        name={f.name || f.initials || 'Crew'}
                        image={f.avatarUrl ?? undefined}
                        size="xs"
                        className={cn('ring-2 ring-bg-card rounded-full', i > 0 && '-ml-2')}
                      />
                    ))}
                    {overflow > 0 && (
                      <span
                        className={cn(
                          'flex-center -ml-2 w-6 h-6 rounded-full ring-2 ring-bg-card',
                          'type-micro font-bold text-accent-aqua',
                          'bg-[rgba(0,232,208,0.15)]',
                        )}
                      >
                        +{overflow}
                      </span>
                    )}
                  </span>
                ) : (
                  <span
                    className={cn(
                      'type-micro font-bold text-accent-aqua',
                      'bg-[rgba(0,232,208,0.15)] py-0.5 px-[7px] rounded-md',
                      'whitespace-nowrap mr-0.5',
                    )}
                  >
                    {countLabel}
                  </span>
                )}
              </button>
            );
          })()}
      </div>
    </div>
  );
}

/**
 * Shallow-compare the props that actually affect rendered output.
 *
 * Callback props (onTap, onPreview) are intentionally skipped — parent
 * components pass inline arrows whose references change every render, but
 * whose behavior is stable (they close over the same set object captured in
 * the loop). Comparing them would defeat memoization entirely.
 *
 * Array props (friendProfiles, conflicts) are compared by length + element
 * identity so we re-render when the list content changes but not when the
 * parent builds a new array reference with identical items.
 */
function setCardPropsAreEqual(prev: Readonly<SetCardProps>, next: Readonly<SetCardProps>): boolean {
  // Core identity — if the set changed, re-render
  if (prev.set.id !== next.set.id) return false;

  // Set data that affects display (updatedAt covers field mutations)
  if (prev.set.updatedAt !== next.set.updatedAt) return false;
  if (prev.set.startTime !== next.set.startTime) return false;
  if (prev.set.endTime !== next.set.endTime) return false;

  // Visual props
  if (prev.stageColor !== next.stageColor) return false;
  if (prev.stageName !== next.stageName) return false;
  if (prev.showPicks !== next.showPicks) return false;
  if (prev.b2bSeparator !== next.b2bSeparator) return false;

  // friendProfiles — compare length + element identity
  const prevFriends = prev.friendProfiles ?? [];
  const nextFriends = next.friendProfiles ?? [];
  if (prevFriends.length !== nextFriends.length) return false;
  for (let i = 0; i < prevFriends.length; i++) {
    const pf = prevFriends[i]!;
    const nf = nextFriends[i]!;
    if (pf.profileId !== nf.profileId || pf.priority !== nf.priority) return false;
  }

  // conflicts — compare by length + set IDs
  const prevConflicts = prev.conflicts ?? [];
  const nextConflicts = next.conflicts ?? [];
  if (prevConflicts.length !== nextConflicts.length) return false;
  for (let i = 0; i < prevConflicts.length; i++) {
    if (prevConflicts[i]!.id !== nextConflicts[i]!.id) return false;
  }

  return true;
}

export default memo(SetCard, setCardPropsAreEqual);
