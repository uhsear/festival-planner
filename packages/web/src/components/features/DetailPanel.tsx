import React, { useState, useEffect, useCallback, useRef } from 'react';
import { FestivalSet, Priority } from '@festie/shared/types';
import { formatTime, artistDisplayName, hasSetStarted } from '@festie/shared/utils';
import { api } from '@festie/shared/services/api';
import { useFestivalStore } from '@festie/shared/stores/festivalStore';
import { Drawer } from 'vaul';
import RatingButtons from './RatingButtons';
import DetailArtistHeader from './DetailArtistHeader';
import DetailSpotifySection from './DetailSpotifySection';
import DetailConflictWarning from './DetailConflictWarning';
import DetailPriorityPicker from './DetailPriorityPicker';
import DetailReminderPicker from './DetailReminderPicker';
import DetailCrewSection from './DetailCrewSection';
import DetailNotesSection from './DetailNotesSection';
import { useDetailPanelData } from './useDetailPanelData';
import { useHaptics } from '../../hooks/useHaptics';
import { Share2 } from 'lucide-react';
import Button from '../ui/Button';

interface DetailPanelProps {
  set: FestivalSet;
  onClose: () => void;
  autoOpenSpotify?: boolean;
}

export default function DetailPanel({ set, onClose, autoOpenSpotify = false }: DetailPanelProps) {
  const {
    currentFestival,
    festivalDays,
    currentProfile,
    b2bSeparator,
    stageColor,
    stageName,
    myPick,
    myReminder,
    artistName,
    sub,
    artistLinks,
    isB2B,
    primaryArtist,
    allGenres,
    conflicts,
    others,
    crewNotes,
    whoTitle,
    savePick,
    saveReminder,
    saveNote,
    getOtherPicks,
    getStageName,
  } = useDetailPanelData(set);

  const { select: selectHaptic, success: successHaptic, warning: warningHaptic } = useHaptics();

  const [personalNote, setPersonalNote] = useState(currentProfile?.notes?.[set.id] || '');
  const [crewNote, setCrewNote] = useState(currentProfile?.notes?.['crew:' + set.id] || '');
  const [spotifyPreview, setSpotifyPreview] = useState<{
    embedUrl: string;
    label: string;
    embedType: string;
  } | null>(null);
  const [spotifyVisible, setSpotifyVisible] = useState(false);
  const [joinBusy, setJoinBusy] = useState(false);
  const [priorityBusy, setPriorityBusy] = useState<Priority | null | 'clear'>(null);
  const [reminderBusy, setReminderBusy] = useState<number | null | 'clear'>(null);

  const personalNoteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const crewNoteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const closeBtnRef = useRef<HTMLButtonElement>(null);

  const handleClose = useCallback(() => {
    onClose();
  }, [onClose]);

  // Share this set with friends via the native share sheet (mobile web).
  // No per-set web route exists, so the link points at festie.us and the
  // artist/time live in the share text. Gated on navigator.share so it only
  // appears where the OS sheet is available.
  const canNativeShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';
  const handleShare = useCallback(async () => {
    const time = set.startTime ? ` at ${formatTime(set.startTime)}` : '';
    const fest = currentFestival?.name ? ` — ${currentFestival.name}` : '';
    const text = `Catch ${artistName}${fest}${time} 🎶`;
    const nav = navigator as Navigator & { share?: (data: ShareData) => Promise<void> };
    try {
      await nav.share?.({ title: artistName, text, url: 'https://festie.us' });
    } catch {
      /* user dismissed or share failed */
    }
  }, [set.startTime, currentFestival?.name, artistName]);

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
        /* No Spotify preview available */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [set.id, autoOpenSpotify]);

  // Debounced personal note save
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
      setPriorityBusy(priority ?? 'clear');
      try {
        await savePick(currentFestival.id, set.id, priority);
      } catch {
        /* store surfaces error */
      } finally {
        setPriorityBusy(null);
      }
    },
    [currentFestival, set.id, savePick, selectHaptic],
  );

  const handleReminderClick = useCallback(
    async (minutes: number | null) => {
      if (!currentFestival) return;
      selectHaptic();
      setReminderBusy(minutes ?? 'clear');
      try {
        await saveReminder(currentFestival.id, set.id, minutes);
      } catch {
        /* store surfaces error */
      } finally {
        setReminderBusy(null);
      }
    },
    [currentFestival, set.id, saveReminder, selectHaptic],
  );

  // Conflict switch handler
  const handleConflictSwitch = useCallback(
    (fromSetId: string, toSet: FestivalSet, priority: Priority) => {
      if (!currentFestival) return;
      savePick(currentFestival.id, fromSetId, null);
      savePick(currentFestival.id, toSet.id, priority);
    },
    [currentFestival, savePick],
  );

  // Join festival handler
  const handleJoinFestival = useCallback(async () => {
    if (!currentFestival) return;
    setJoinBusy(true);
    try {
      await api.post(`/profiles`, { festivalId: currentFestival.id });
      await useFestivalStore.getState().loadProfiles(currentFestival.id);
      onClose();
    } catch {
      /* Join failed */
    } finally {
      setJoinBusy(false);
    }
  }, [currentFestival, onClose]);

  return (
    <Drawer.Root
      open
      onOpenChange={(o: boolean) => {
        if (!o) handleClose();
      }}
      dismissible
      handleOnly
    >
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 z-[999] bg-black/50" />
        <Drawer.Content
          aria-label="Set detail panel"
          className="fixed bottom-0 inset-x-0 z-[1000] max-h-[min(90dvh,calc(100dvh-32px))] flex flex-col
                     rounded-t-DEFAULT bg-bg-card glass border border-border
                     shadow-lg outline-none
                     lg:bottom-auto lg:inset-x-auto lg:top-1/2 lg:left-1/2
                     lg:-translate-x-1/2 lg:-translate-y-1/2
                     lg:w-[clamp(420px,40vw,540px)] lg:max-w-[calc(100vw-2rem)] lg:max-h-[85dvh]
                     lg:rounded-DEFAULT"
          onOpenAutoFocus={(e: Event) => {
            e.preventDefault();
            closeBtnRef.current?.focus();
          }}
        >
          <div className="mx-auto mt-2 mb-1 h-1.5 w-12 rounded-full bg-border-light flex-shrink-0 lg:hidden" />
          <Drawer.Title className="sr-only">{artistDisplayName(set, b2bSeparator)}</Drawer.Title>
          <Drawer.Description className="sr-only">
            Set details, schedule, and crew info for {artistDisplayName(set, b2bSeparator)}
          </Drawer.Description>
          {canNativeShare && (
            <button
              className="absolute top-4 right-[68px] w-11 h-11 min-w-11 min-h-11 rounded-full bg-bg-card border border-border-light flex items-center justify-center text-text-secondary cursor-pointer transition-all duration-200 ease-[var(--ease-standard)] hover:bg-accent-aqua hover:text-text-on-accent hover:border-accent-aqua focus-visible:outline-2 focus-visible:outline-accent-aqua focus-visible:outline-offset-2 focus-visible:border-accent-aqua z-10"
              type="button"
              aria-label="Share this set"
              onClick={handleShare}
            >
              <Share2 className="w-5 h-5" aria-hidden="true" />
            </button>
          )}
          <button
            className="absolute top-4 right-4 w-11 h-11 min-w-11 min-h-11 rounded-full bg-bg-card border border-border-light flex items-center justify-center text-text-secondary text-lg cursor-pointer transition-all duration-200 ease-[var(--ease-standard)] hover:bg-accent-coral hover:text-text-on-accent hover:border-accent-coral focus-visible:outline-2 focus-visible:outline-accent-aqua focus-visible:outline-offset-2 focus-visible:border-accent-aqua z-10"
            type="button"
            aria-label="Close detail panel"
            onClick={handleClose}
            ref={closeBtnRef}
          >
            {'×'}
          </button>
          <div
            className="min-h-0 flex flex-col gap-[var(--space-4)] overflow-y-auto overscroll-contain p-7 pb-[max(12px,env(safe-area-inset-bottom))]"
            ref={panelRef}
          >
            <div>
              <div
                className="inline-block self-start px-3 py-1 rounded-DEFAULT type-micro mb-3"
                style={{ background: stageColor + '25', color: stageColor }}
              >
                {stageName}
              </div>

              <DetailArtistHeader
                artistName={artistName}
                subtitle={sub}
                primaryArtist={primaryArtist}
                stageColor={stageColor}
                artistLinks={artistLinks}
                isB2B={isB2B}
                genres={allGenres}
                setArtist={set.artist}
              />

              <div className="text-[15px] text-text-secondary tabular-nums">
                {set.startTime && set.endTime ? formatTime(set.startTime) + ' - ' + formatTime(set.endTime) : 'TBA'}
              </div>
            </div>

            {spotifyPreview && (
              <DetailSpotifySection
                preview={spotifyPreview}
                visible={spotifyVisible}
                onToggle={() => setSpotifyVisible((v) => !v)}
              />
            )}

            <DetailConflictWarning
              conflicts={conflicts}
              currentSetId={set.id}
              myPick={myPick || null}
              b2bSeparator={b2bSeparator}
              getStageName={getStageName}
              getOtherPicks={getOtherPicks}
              onSwitch={handleConflictSwitch}
            />

            {currentProfile ? (
              <>
                <DetailPriorityPicker
                  myPick={myPick || null}
                  priorityBusy={priorityBusy}
                  onPriorityClick={handlePriorityClick}
                />
                <DetailReminderPicker
                  myReminder={myReminder}
                  reminderBusy={reminderBusy}
                  onReminderClick={handleReminderClick}
                />
              </>
            ) : (
              <div className="p-4 rounded-DEFAULT bg-[var(--color-overlay-2)] border border-border">
                <p className="text-[13px] text-text-secondary leading-normal mb-3">
                  Join this festival to save picks, keep private notes, and compare crew overlap.
                </p>
                <Button
                  variant="primary"
                  type="button"
                  disabled={joinBusy}
                  isLoading={joinBusy}
                  onClick={handleJoinFestival}
                >
                  {joinBusy ? 'Joining...' : 'Join Festival'}
                </Button>
              </div>
            )}

            {currentProfile && set && currentFestival && hasSetStarted(set, currentFestival, festivalDays) && (
              <div className="mx-0 text-center">
                <div className="mb-2 text-[11px] uppercase tracking-wide text-text-muted">Rate this set</div>
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
