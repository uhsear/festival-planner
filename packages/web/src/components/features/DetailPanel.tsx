import React, { useState, useEffect, useCallback, useRef } from 'react';
import { FestivalSet, Priority } from '@festie/shared/types';
import { formatTime, artistDisplayName } from '@festie/shared/utils';
import { api } from '@festie/shared/services/api';
import { useFestivalStore } from '@festie/shared/stores/festivalStore';
import { Drawer } from 'vaul';
import RatingButtons from './RatingButtons';
import DetailArtistHeader from './DetailArtistHeader';
import DetailSpotifySection from './DetailSpotifySection';
import DetailConflictWarning from './DetailConflictWarning';
import DetailPriorityPicker from './DetailPriorityPicker';
import DetailCrewSection from './DetailCrewSection';
import DetailNotesSection from './DetailNotesSection';
import { useDetailPanelData } from './useDetailPanelData';
import { hasSetStarted } from '../../utils/festivalTime';
import { useHaptics } from '../../hooks/useHaptics';

interface DetailPanelProps {
  set: FestivalSet;
  onClose: () => void;
  autoOpenSpotify?: boolean;
}

export default function DetailPanel({ set, onClose, autoOpenSpotify = false }: DetailPanelProps) {
  const {
    currentFestival, festivalDays, currentProfile,
    b2bSeparator, stageColor, stageName,
    myPick, artistName, sub, artistLinks, isB2B, primaryArtist,
    allGenres, conflicts, others, crewNotes, whoTitle,
    savePick, saveNote, getOtherPicks, getStageName,
  } = useDetailPanelData(set);

  const { select: selectHaptic, success: successHaptic, warning: warningHaptic } = useHaptics();

  const [personalNote, setPersonalNote] = useState(
    currentProfile?.notes?.[set.id] || '',
  );
  const [crewNote, setCrewNote] = useState(
    currentProfile?.notes?.['crew:' + set.id] || '',
  );
  const [spotifyPreview, setSpotifyPreview] = useState<{
    embedUrl: string; label: string; embedType: string;
  } | null>(null);
  const [spotifyVisible, setSpotifyVisible] = useState(false);
  const [joinBusy, setJoinBusy] = useState(false);
  const [priorityBusy, setPriorityBusy] = useState<Priority | null | 'clear'>(null);

  const personalNoteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const crewNoteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const closeBtnRef = useRef<HTMLButtonElement>(null);

  const handleClose = useCallback(() => { onClose(); }, [onClose]);

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
      } catch { /* No Spotify preview available */ }
    })();
    return () => { cancelled = true; };
  }, [set.id, autoOpenSpotify]);

  // Debounced personal note save
  const handlePersonalNoteChange = useCallback(
    (value: string) => {
      setPersonalNote(value);
      if (personalNoteTimer.current) clearTimeout(personalNoteTimer.current);
      personalNoteTimer.current = setTimeout(async () => {
        if (!currentFestival) return;
        try { await saveNote(currentFestival.id, set.id, value); successHaptic(); }
        catch { warningHaptic(); }
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
        try { await saveNote(currentFestival.id, 'crew:' + set.id, value); successHaptic(); }
        catch { warningHaptic(); }
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
      try { await savePick(currentFestival.id, set.id, priority); }
      catch { /* store surfaces error */ }
      finally { setPriorityBusy(null); }
    },
    [currentFestival, set.id, savePick, selectHaptic],
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
    } catch { /* Join failed */ }
    finally { setJoinBusy(false); }
  }, [currentFestival, onClose]);

  return (
    <Drawer.Root
      open
      onOpenChange={(o: boolean) => { if (!o) handleClose(); }}
      dismissible
      handleOnly
    >
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm" />
        <Drawer.Content
          aria-label="Set detail panel"
          className="fixed bottom-0 inset-x-0 z-50 max-h-[min(90dvh,calc(100dvh-32px))] flex flex-col
                     rounded-t-2xl bg-bg-primary border-t border-border-light
                     shadow-2xl outline-none
                     lg:bottom-auto lg:inset-x-auto lg:top-1/2 lg:left-1/2
                     lg:-translate-x-1/2 lg:-translate-y-1/2
                     lg:w-[min(640px,calc(100vw-2rem))] lg:max-h-[85dvh]
                     lg:rounded-2xl lg:border lg:border-border-light lg:border-t-0"
          onOpenAutoFocus={(e: Event) => { e.preventDefault(); closeBtnRef.current?.focus(); }}
        >
          <div className="mx-auto mt-2 mb-1 h-1.5 w-12 rounded-full bg-text-muted/30 flex-shrink-0 lg:hidden" />
          <Drawer.Title className="sr-only">{artistDisplayName(set, b2bSeparator)}</Drawer.Title>
          <Drawer.Description className="sr-only">Set details, schedule, and crew info for {artistDisplayName(set, b2bSeparator)}</Drawer.Description>
          <div className="detail-panel detail-panel--drawer flex-1 min-h-0 overflow-y-auto" ref={panelRef}>
            <button className="detail-close" type="button" aria-label="Close detail panel" onClick={handleClose} ref={closeBtnRef}>
              {'×'}
            </button>

            <div className="detail-stage-badge" style={{ background: stageColor + '25', color: stageColor }}>
              {stageName}
            </div>

            <DetailArtistHeader
              artistName={artistName} subtitle={sub} primaryArtist={primaryArtist}
              stageColor={stageColor} artistLinks={artistLinks} isB2B={isB2B}
              genres={allGenres} setArtist={set.artist}
            />

            <div className="detail-time">
              {set.startTime && set.endTime ? formatTime(set.startTime) + ' - ' + formatTime(set.endTime) : 'TBA'}
            </div>

            {spotifyPreview && (
              <DetailSpotifySection preview={spotifyPreview} visible={spotifyVisible} onToggle={() => setSpotifyVisible((v) => !v)} />
            )}

            <DetailConflictWarning
              conflicts={conflicts} currentSetId={set.id} myPick={myPick || null}
              b2bSeparator={b2bSeparator} getStageName={getStageName}
              getOtherPicks={getOtherPicks} onSwitch={handleConflictSwitch}
            />

            {currentProfile ? (
              <DetailPriorityPicker myPick={myPick || null} priorityBusy={priorityBusy} onPriorityClick={handlePriorityClick} />
            ) : (
              <div className="detail-join-cta">
                <p>Join this festival to save picks, keep private notes, and compare crew overlap.</p>
                <button className="btn btn-primary" type="button" disabled={joinBusy} aria-busy={joinBusy ? 'true' : 'false'} onClick={handleJoinFestival}>
                  {joinBusy ? 'Joining...' : 'Join Festival'}
                </button>
              </div>
            )}

            {currentProfile && set && currentFestival && hasSetStarted(set, currentFestival, festivalDays) && (
              <div className="detail-rating" style={{ margin: '14px 0 10px', textAlign: 'center' }}>
                <div style={{ fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--color-text-muted)', marginBottom: 8 }}>
                  Rate this set
                </div>
                <RatingButtons setId={set.id} festivalId={currentFestival.id} />
              </div>
            )}

            <DetailCrewSection title={whoTitle} others={others} crewNotes={crewNotes} />

            {currentProfile && (
              <DetailNotesSection personalNote={personalNote} crewNote={crewNote} onPersonalChange={handlePersonalNoteChange} onCrewChange={handleCrewNoteChange} />
            )}
          </div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
