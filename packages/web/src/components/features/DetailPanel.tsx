import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { FestivalSet, Priority } from '@festie/shared/types';
import { usePicks, useFestival, useCrew } from '@festie/shared/hooks';
import { useFestivalStore } from '@festie/shared/stores/festivalStore';
import { useCrewStore } from '@festie/shared/stores/crewStore';
import {
  formatTime,
  artistDisplayName,
  artistSubtitle,
  getSetLinks,
  getAvatarColor,
  getInitials,
  detectConflicts,
} from '@festie/shared/utils';
import { api } from '@festie/shared/services/api';
import { Drawer } from 'vaul';
import RatingButtons from './RatingButtons';
import { hasSetStarted } from '../../utils/festivalTime';
import { useHaptics } from '../../hooks/useHaptics';

const PLATFORM_LABELS: Record<string, string> = {
  spotify: 'Spotify',
  soundcloud: 'SoundCloud',
  instagram: 'Instagram',
  twitter: 'X',
  tiktok: 'TikTok',
  website: 'Website',
};

interface DetailPanelProps {
  set: FestivalSet;
  onClose: () => void;
  autoOpenSpotify?: boolean;
}

export default function DetailPanel({ set, onClose, autoOpenSpotify = false }: DetailPanelProps) {
  const currentFestival = useFestivalStore((s) => s.currentFestival);
  const festivalDays = useFestivalStore((s) => s.days);
  const currentProfile = useFestivalStore((s) => s.currentProfile);
  const allProfiles = useFestivalStore((s) => s.allProfiles);
  const sets = useFestivalStore((s) => s.sets);
  const activeCrew = useCrewStore((s) => s.activeCrew);

  const { getMyPick, getMyNote, savePick, saveNote, getOtherPicks } = usePicks();
  const { getStageColor, getStageName } = useFestival();
  const { getCrewScopedOtherPicks } = useCrew();
  const { select: selectHaptic, success: successHaptic, warning: warningHaptic } = useHaptics();

  const [personalNote, setPersonalNote] = useState(getMyNote(set.id) || '');
  const [crewNote, setCrewNote] = useState(
    currentProfile?.notes?.['crew:' + set.id] || '',
  );
  const [spotifyPreview, setSpotifyPreview] = useState<{
    embedUrl: string;
    label: string;
    embedType: string;
  } | null>(null);
  const [spotifyVisible, setSpotifyVisible] = useState(false);
  const [joinBusy, setJoinBusy] = useState(false);
  const [priorityBusy, setPriorityBusy] = useState<Priority | null | 'clear'>(
    null,
  );

  const personalNoteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const crewNoteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const closeBtnRef = useRef<HTMLButtonElement>(null);

  const b2bSeparator = currentFestival?.b2bSeparator;
  const stageColor = getStageColor(set.stageId);
  const stageName = getStageName(set.stageId) || 'Unknown';
  const myPick = getMyPick(set.id);
  const artistName = artistDisplayName(set, b2bSeparator);
  const sub = artistSubtitle(set, b2bSeparator);
  const artistLinks = getSetLinks(set);
  const isB2B = (set.artists?.length || 0) > 1;
  const primaryArtist = set.artists?.[0];

  // Genre chips from artist data
  const allGenres = useMemo(() => {
    return [...new Set((set.artists || []).flatMap((a) => a.genres || []))].slice(0, 6);
  }, [set.artists]);

  // Conflicts: find sets that overlap with this one in the user's picks
  const conflicts = useMemo(() => {
    if (!currentProfile) return [];
    const detected = detectConflicts(sets, (setId: string) => {
      const val = currentProfile.picks[setId];
      return (val as Priority) || null;
    });
    return detected
      .filter((c) => c.setA.id === set.id || c.setB.id === set.id)
      .map((c) => (c.setA.id === set.id ? c.setB : c.setA));
  }, [sets, currentProfile, set.id]);

  // Crew overlap (other picks for this set)
  const others = useMemo(() => {
    if (!currentProfile) return [];
    const raw = activeCrew
      ? getCrewScopedOtherPicks(set.id)
      : getOtherPicks(set.id);
    // Resolve profile names
    return raw.map((o) => {
      const profile = allProfiles.find((p) => p.id === o.profileId);
      const avatarUrl = (profile as { avatarUrl?: string | null } | undefined)
        ?.avatarUrl;
      return {
        ...o,
        name: profile?.name || 'Unknown',
        avatar: (avatarUrl ?? undefined) as string | undefined,
      };
    });
  }, [currentProfile, activeCrew, set.id, getCrewScopedOtherPicks, getOtherPicks, allProfiles]);

  // Crew notes from other profiles
  const crewNotes = useMemo(() => {
    return allProfiles
      .filter(
        (p) =>
          p.id !== currentProfile?.id && p.notes?.['crew:' + set.id],
      )
      .map((p) => ({ name: p.name || 'Unknown', note: p.notes['crew:' + set.id] }));
  }, [allProfiles, currentProfile?.id, set.id]);

  const whoTitle = useMemo(() => {
    if (activeCrew) {
      return others.length > 0
        ? `${activeCrew.name} (${others.length} going)`
        : `No one in ${activeCrew.name} going yet`;
    }
    return others.length > 0
      ? `Who's Going (${others.length})`
      : 'Nobody else going yet';
  }, [activeCrew, others.length]);

  // Close directly — let vaul own the dismiss animation. The legacy
  // .panel-exiting slideDown (225–400 ms) was stacking on top of vaul's own
  // drawer-close transition, producing the multi-second perceived delay on
  // mobile. Removing the manual animation chain (and the uncleared 400 ms
  // fallback that double-invoked onClose) restores an instant close.
  const handleClose = useCallback(() => {
    onClose();
  }, [onClose]);

  // Focus close button on mount — intentionally removed manual Escape handler
  // (Radix Dialog/vaul handles Escape natively via onOpenChange).

  // Fetch Spotify preview on mount
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const preview = await api.get<{ embedUrl: string; label: string; embedType: string }>(
          `/spotify/preview/${set.id}`,
        );
        if (!cancelled && preview?.embedType) {
          setSpotifyPreview(preview);
          if (autoOpenSpotify) setSpotifyVisible(true);
        }
      } catch {
        // No Spotify preview available
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [set.id, autoOpenSpotify]);

  // Debounced personal note save — fire success haptic + warning on failure
  // AFTER the debounce completes so rapid typing doesn't vibrate per-keystroke.
  const handlePersonalNoteChange = useCallback(
    (value: string) => {
      setPersonalNote(value);
      if (personalNoteTimer.current) clearTimeout(personalNoteTimer.current);
      personalNoteTimer.current = setTimeout(async () => {
        if (!currentFestival) return;
        try {
          await saveNote(currentFestival.id, set.id, value);
          successHaptic();
        } catch {
          warningHaptic();
        }
      }, 500);
    },
    [currentFestival, set.id, saveNote, successHaptic, warningHaptic],
  );

  // Debounced crew note save
  const handleCrewNoteChange = useCallback(
    (value: string) => {
      setCrewNote(value);
      if (crewNoteTimer.current) clearTimeout(crewNoteTimer.current);
      crewNoteTimer.current = setTimeout(async () => {
        if (!currentFestival) return;
        try {
          await saveNote(currentFestival.id, 'crew:' + set.id, value);
          successHaptic();
        } catch {
          warningHaptic();
        }
      }, 500);
    },
    [currentFestival, set.id, saveNote, successHaptic, warningHaptic],
  );

  // Cleanup timers
  useEffect(() => {
    return () => {
      if (personalNoteTimer.current) clearTimeout(personalNoteTimer.current);
      if (crewNoteTimer.current) clearTimeout(crewNoteTimer.current);
    };
  }, []);

  // Priority picker handler
  const handlePriorityClick = useCallback(
    async (priority: Priority | null) => {
      if (!currentFestival) return;
      selectHaptic();
      await savePick(currentFestival.id, set.id, priority);
    },
    [currentFestival, set.id, savePick, selectHaptic],
  );

  // Spotify toggle
  const handleSpotifyToggle = useCallback(() => {
    setSpotifyVisible((prev) => !prev);
  }, []);

  // Join festival handler
  const handleJoinFestival = useCallback(async () => {
    if (!currentFestival) return;
    setJoinBusy(true);
    try {
      await api.post(`/profiles`, { festivalId: currentFestival.id });
      // Re-load profiles to set the new currentProfile before closing
      await useFestivalStore.getState().loadProfiles(currentFestival.id);
      onClose();
    } catch {
      // Join failed
    } finally {
      setJoinBusy(false);
    }
  }, [currentFestival, onClose]);

  // Priority options: [priority, icon, label, activeClass]
  const priorityOptions: Array<[Priority | null, string, string, string]> = [
    ['must', '\u2605', 'Must See', 'active-must'],
    ['want-to-see', '\u25C6', 'Want to See', 'active-want'],
    ['maybe', '\u25CF', 'Maybe', 'active-maybe'],
    [null, '\u2715', 'Clear', 'active-none'],
  ];

  return (
    <Drawer.Root
      open
      onOpenChange={(o: boolean) => { if (!o) handleClose(); }}
      dismissible
      handleOnly
    >
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm" />
        {/* Responsive positioning: mobile = bottom sheet (vaul default).
            Desktop (>=1024px) = centered modal with a sensible max width so
            content doesn't pin to the left of a 1400 px viewport. The `lg:`
            classes cancel vaul's `fixed bottom-0 inset-x-0` and recenter. */}
        <Drawer.Content
          aria-label="Set detail panel"
          className="fixed bottom-0 inset-x-0 z-50 max-h-[92vh] flex flex-col
                     rounded-t-2xl bg-bg-primary border-t border-border-light
                     shadow-2xl outline-none
                     lg:bottom-auto lg:inset-x-auto lg:top-1/2 lg:left-1/2
                     lg:-translate-x-1/2 lg:-translate-y-1/2
                     lg:w-[min(640px,calc(100vw-2rem))] lg:max-h-[85vh]
                     lg:rounded-2xl lg:border lg:border-border-light lg:border-t-0"
          onOpenAutoFocus={(e: Event) => {
            e.preventDefault();
            closeBtnRef.current?.focus();
          }}
        >
          {/* Drag handle — mobile only (desktop has no drag affordance). */}
          <div className="mx-auto mt-2 mb-1 h-1.5 w-12 rounded-full bg-text-muted/30 flex-shrink-0 lg:hidden" />
          {/* Accessible title — the artist name is the semantic title; keep it
              sr-only here because the visible "detail-artist" heading inside
              duplicates it with stage-color styling. */}
          <Drawer.Title className="sr-only">{artistDisplayName(set, currentFestival?.b2bSeparator)}</Drawer.Title>
          <Drawer.Description className="sr-only">Set details, schedule, and crew info for {artistDisplayName(set, currentFestival?.b2bSeparator)}</Drawer.Description>
          <div className="detail-panel detail-panel--drawer" ref={panelRef}>
        {/* Close button */}
        <button
          className="detail-close"
          type="button"
          aria-label="Close detail panel"
          onClick={handleClose}
          ref={closeBtnRef}
        >
          {'\u00D7'}
        </button>

        {/* Stage badge */}
        <div
          className="detail-stage-badge"
          style={{ background: stageColor + '25', color: stageColor }}
        >
          {stageName}
        </div>

        {/* Artist photo — reserved aspect ratio prevents CLS when the lazy-
            loaded hero image swaps in; artist press photos are ~square, so
            1/1 matches the common case while object-cover handles drift. */}
        {primaryArtist && primaryArtist.photo && (
          <div
            className="detail-artist-photo-wrap"
            style={{
              aspectRatio: '1 / 1',
              // Placeholder tint while the image decodes — picks up the stage
              // color so the empty frame feels intentional rather than broken.
              background: stageColor + '18',
            }}
          >
            <img
              src={primaryArtist.photo}
              alt={primaryArtist.name || set.artist || ''}
              className="detail-artist-photo"
              loading="lazy"
              decoding="async"
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              onError={(e) => {
                // Broken-image fallback: drop the whole wrapper so the layout
                // reflows without a broken-glyph placeholder lingering.
                const wrap = (e.target as HTMLElement).parentElement;
                if (wrap) wrap.remove();
              }}
            />
          </div>
        )}

        {/* Artist name */}
        <div className="detail-artist" id="detail-panel-title">
          {artistName}
        </div>

        {/* Subtitle (B2B) */}
        {sub && <div className="detail-artist-sub">{sub}</div>}

        {/* Genre chips */}
        {allGenres.length > 0 && (
          <div className="detail-genre-chips">
            {allGenres.map((g) => (
              <span key={g} className="detail-genre-chip">
                {g}
              </span>
            ))}
          </div>
        )}

        {/* Artist links */}
        {artistLinks.length > 0 && (
          <div className="detail-links">
            {artistLinks.map((a, i) => (
              <React.Fragment key={a.name + i}>
                {isB2B && (
                  <div
                    style={{
                      fontSize: '12px',
                      fontWeight: 600,
                      color: 'var(--text-secondary)',
                      marginTop: '6px',
                    }}
                  >
                    {a.name}
                  </div>
                )}
                <div
                  className="detail-link"
                  style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}
                >
                  {Object.entries(a.links || {}).map(([platform, url]) => (
                    <a
                      key={platform}
                      href={url}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{
                        color: 'var(--accent-aqua)',
                        fontSize: '13px',
                        textDecoration: 'none',
                      }}
                    >
                      {(PLATFORM_LABELS[platform] || platform) + ' \u2197'}
                    </a>
                  ))}
                </div>
              </React.Fragment>
            ))}
          </div>
        )}

        {/* Time */}
        <div className="detail-time">
          {set.startTime && set.endTime
            ? formatTime(set.startTime) + ' - ' + formatTime(set.endTime)
            : 'TBA'}
        </div>

        {/* Spotify embed section */}
        {spotifyPreview && (
          <div className="detail-spotify-section" style={{ margin: '10px 0' }}>
            <button
              className="btn btn-ghost btn-sm"
              type="button"
              style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
              onClick={handleSpotifyToggle}
            >
              {spotifyVisible ? '\u25B2 Hide Player' : '\u25B6 Listen on Spotify'}
            </button>
            {spotifyVisible && (
              <div
                className="detail-spotify-embed"
                style={{ marginTop: 8, borderRadius: 12, overflow: 'hidden' }}
              >
                <iframe
                  src={spotifyPreview.embedUrl}
                  width="100%"
                  height="152"
                  frameBorder="0"
                  allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
                  loading="lazy"
                  title={'Spotify: ' + spotifyPreview.label}
                  style={{ display: 'block', borderRadius: 12 }}
                />
              </div>
            )}
          </div>
        )}

        {/* Conflict warning */}
        {conflicts.length > 0 && (
          <div className="detail-conflict-warning">
            <div>
              {'\u26A0 Time conflict with: ' +
                conflicts
                  .map((c) => artistDisplayName(c, b2bSeparator))
                  .join(', ')}
            </div>
            <div className="detail-conflict-compare">
              {conflicts.map((c) => {
                const cOthers = getOtherPicks(c.id);
                return (
                  <div key={c.id} className="conflict-compare-card">
                    <div className="conflict-compare-artist">
                      {artistDisplayName(c, b2bSeparator)}
                    </div>
                    <div className="conflict-compare-meta">
                      {formatTime(c.startTime) +
                        ' - ' +
                        formatTime(c.endTime) +
                        ' \u00B7 ' +
                        (getStageName(c.stageId) || 'Unknown')}
                    </div>
                    <div className="conflict-compare-crew">
                      {cOthers.length
                        ? cOthers.length + ' crew going'
                        : 'No crew'}
                    </div>
                    <button
                      className="btn btn-ghost btn-sm"
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (!currentFestival) return;
                        savePick(currentFestival.id, set.id, null);
                        savePick(
                          currentFestival.id,
                          c.id,
                          myPick || 'want-to-see',
                        );
                      }}
                    >
                      Switch to this
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Priority picker (logged in + joined) */}
        {currentProfile ? (
          <div className="detail-priority-group">
            {priorityOptions.map(([p, icon, label, cls]) => {
              const active = myPick === p;
              const key: Priority | 'clear' = p ?? 'clear';
              const isThisBusy = priorityBusy === key;
              const anyBusy = priorityBusy !== null;
              return (
                <button
                  key={label}
                  className={
                    'detail-priority-option' + (active ? ' ' + cls : '')
                  }
                  type="button"
                  aria-pressed={active ? 'true' : 'false'}
                  aria-label={label + (active ? ' (selected)' : '')}
                  aria-busy={isThisBusy ? 'true' : 'false'}
                  disabled={anyBusy}
                  onClick={async (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (priorityBusy !== null) return;
                    setPriorityBusy(key);
                    try {
                      await handlePriorityClick(p);
                    } catch {
                      // Save failed — store already surfaces error; just clear busy.
                    } finally {
                      setPriorityBusy(null);
                    }
                  }}
                >
                  <div style={{ fontSize: '20px' }}>{icon}</div>
                  <div className="priority-label">{label}</div>
                </button>
              );
            })}
          </div>
        ) : (
          /* Join CTA (guest) */
          <div className="detail-join-cta">
            <p>
              Join this festival to save picks, keep private notes, and compare
              crew overlap.
            </p>
            <button
              className="btn btn-primary"
              type="button"
              disabled={joinBusy}
              aria-busy={joinBusy ? 'true' : 'false'}
              onClick={handleJoinFestival}
            >
              {joinBusy ? 'Joining...' : 'Join Festival'}
            </button>
          </div>
        )}

        {/* Rate the set — shown only after the set has started so users rate
            what they actually saw. Auth-gated via currentProfile (guests see
            nothing here; they see the Join CTA above instead). */}
        {currentProfile && set && currentFestival && hasSetStarted(set, currentFestival, festivalDays) && (
          <div className="detail-rating" style={{ margin: '14px 0 10px', textAlign: 'center' }}>
            <div style={{ fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase',
                          color: 'var(--color-text-muted)', marginBottom: 8 }}>
              Rate this set
            </div>
            <RatingButtons setId={set.id} festivalId={currentFestival.id} />
          </div>
        )}

        {/* Crew overlap / friends section */}
        <div className="detail-friends">
          <div className="detail-friends-title">{whoTitle}</div>
          {others.map((o) => {
            const priLabels: Record<string, string> = {
              must: 'Must See',
              'want-to-see': 'Want to See',
              maybe: 'Maybe',
            };
            const priColors: Record<string, string> = {
              must: 'var(--priority-must)',
              'want-to-see': 'var(--priority-want)',
              maybe: 'var(--priority-maybe)',
            };
            const avatarColor = getAvatarColor(o.name);
            const initials = getInitials(o.name);
            return (
              <div key={o.profileId} className="detail-friend-item">
                {o.avatar ? (
                  <img
                    src={o.avatar}
                    alt={o.name}
                    width={28}
                    height={28}
                    loading="lazy"
                    decoding="async"
                    style={{
                      width: 28,
                      height: 28,
                      borderRadius: '50%',
                      objectFit: 'cover',
                      flexShrink: 0,
                    }}
                    title={o.name + ' (' + o.priority + ')'}
                  />
                ) : (
                  <div
                    style={{
                      width: 28,
                      height: 28,
                      borderRadius: '50%',
                      background: avatarColor,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 11,
                      fontWeight: 700,
                      color: '#fff',
                      flexShrink: 0,
                    }}
                    title={o.name + ' (' + o.priority + ')'}
                  >
                    {initials}
                  </div>
                )}
                <span>{o.name}</span>
                <span
                  className="friend-priority"
                  style={{ color: priColors[o.priority] }}
                >
                  {priLabels[o.priority]}
                </span>
              </div>
            );
          })}

          {/* Crew notes from others */}
          {crewNotes.length > 0 && (
            <div
              style={{
                padding: '8px 0',
                borderTop: '1px solid var(--border)',
              }}
            >
              <div
                style={{
                  fontSize: '12px',
                  fontWeight: 600,
                  color: 'var(--accent-aqua)',
                  marginBottom: '6px',
                }}
              >
                Crew Notes
              </div>
              {crewNotes.map((cn, i) => (
                <div key={i} style={{ fontSize: '13px', padding: '4px 0' }}>
                  <strong style={{ color: 'var(--text-secondary)' }}>
                    {cn.name + ': '}
                  </strong>
                  {cn.note}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Notes (logged in only) */}
        {currentProfile && (
          <div className="detail-notes">
            <div className="detail-notes-title" id="notes-label">
              Personal Notes
            </div>
            <textarea
              placeholder='Add notes (e.g., "meet at the rail")...'
              aria-labelledby="notes-label"
              value={personalNote}
              onChange={(e) => handlePersonalNoteChange(e.target.value)}
            />

            {/* Crew note */}
            <div className="detail-notes" style={{ marginTop: '8px' }}>
              <div
                className="detail-notes-title"
                style={{ color: 'var(--accent-aqua)' }}
                id="crew-notes-label"
              >
                Crew Note (visible to your crew)
              </div>
              <textarea
                placeholder="Share a note with your crew..."
                aria-labelledby="crew-notes-label"
                style={{
                  borderColor: 'var(--accent-aqua)',
                  borderWidth: '1px',
                }}
                value={crewNote}
                onChange={(e) => handleCrewNoteChange(e.target.value)}
              />
            </div>
          </div>
        )}
      </div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
