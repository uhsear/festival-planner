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
  detectConflicts,
} from '@festie/shared/utils';
import { api } from '@festie/shared/services/api';
import { Drawer } from 'vaul';
import RatingButtons from './RatingButtons';
import DetailSpotifySection from './DetailSpotifySection';
import DetailConflictWarning from './DetailConflictWarning';
import DetailCrewSection from './DetailCrewSection';
import DetailNotesSection from './DetailNotesSection';
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
  const [priorityAnnounce, setPriorityAnnounce] = useState('');

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
    return [...new Set((set.artists || []).flatMap((a: any) => a.genres || []))].slice(0, 6);
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

  // Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleClose]);

  // Focus close button on mount
  useEffect(() => {
    if (closeBtnRef.current) {
      closeBtnRef.current.focus();
    }
  }, []);

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
          className="fixed bottom-0 inset-x-0 z-50 max-h-[92vh] flex flex-col
                     rounded-t-2xl bg-bg-primary border-t border-border-light
                     shadow-2xl outline-none
                     lg:bottom-auto lg:inset-x-auto lg:top-1/2 lg:left-1/2
                     lg:-translate-x-1/2 lg:-translate-y-1/2
                     lg:w-[min(640px,calc(100vw-2rem))] lg:max-h-[85vh]
                     lg:rounded-2xl lg:border lg:border-border-light lg:border-t-0"
        >
          {/* Drag handle — mobile only (desktop has no drag affordance). */}
          <div className="mx-auto mt-2 mb-1 h-1.5 w-12 rounded-full bg-text-muted/30 flex-shrink-0 lg:hidden" />
          {/* Accessible title — the artist name is the semantic title; keep it
              sr-only here because the visible "detail-artist" heading inside
              duplicates it with stage-color styling. */}
          <Drawer.Title className="sr-only">{artistDisplayName(set, currentFestival?.b2bSeparator)}</Drawer.Title>
          <div className="detail-panel detail-panel--drawer" ref={panelRef}>
        {/* Close button */}
        <button
          className="detail-close"
          type="button"
          aria-label="Close details"
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
        {primaryArtist && (primaryArtist as any).photo && (
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
              src={(primaryArtist as any).photo}
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

        {spotifyPreview && (
          <DetailSpotifySection
            preview={spotifyPreview}
            visible={spotifyVisible}
            onToggle={handleSpotifyToggle}
          />
        )}

        <DetailConflictWarning
          conflicts={conflicts}
          currentSetId={set.id}
          myPick={myPick ?? null}
          b2bSeparator={b2bSeparator}
          getStageName={getStageName}
          getOtherPicks={getOtherPicks}
          onSwitch={(fromId, toSet, priority) => {
            if (!currentFestival) return;
            savePick(currentFestival.id, fromId, null);
            savePick(currentFestival.id, toSet.id, priority);
          }}
        />

        {/* Priority picker (logged in + joined) */}
        {currentProfile ? (
          <>
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
                        setPriorityAnnounce(p ? `Saved as ${label}` : 'Priority cleared');
                      } catch {
                        setPriorityAnnounce('Failed to save priority');
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
            <div aria-live="polite" className="sr-only">{priorityAnnounce}</div>
          </>
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
        {currentProfile && set && currentFestival && hasSetStarted(set as any, currentFestival as any, festivalDays) && (
          <div className="detail-rating" style={{ margin: '14px 0 10px', textAlign: 'center' }}>
            <div style={{ fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase',
                          color: 'var(--color-text-muted)', marginBottom: 8 }}>
              Rate this set
            </div>
            <RatingButtons setId={set.id} festivalId={currentFestival.id} />
          </div>
        )}

        <DetailCrewSection title={whoTitle} others={others} crewNotes={crewNotes} />

        {currentProfile && (
          <DetailNotesSection
            personalNote={personalNote}
            crewNote={crewNote}
            onPersonalChange={handlePersonalNoteChange}
            onCrewChange={handleCrewNoteChange}
          />
        )}
      </div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
