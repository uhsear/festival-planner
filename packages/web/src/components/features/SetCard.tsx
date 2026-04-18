import React, { useRef, useState } from 'react';
import { FestivalSet, Priority } from '@festie/shared/types';
import { PRIORITY_MAP } from '@festie/shared/constants';
import { usePicks } from '@festie/shared/hooks';
import { formatTime, artistDisplayName, artistSubtitle } from '@festie/shared/utils';
import { useFestivalStore } from '@festie/shared/stores';
import { api } from '@festie/shared/services/api';
import { useSetStatus } from '@/hooks/useSetStatus';
import { useToast } from '@/lib/toastContext';
import { useHaptics } from '@/hooks/useHaptics';
import FriendAvatars from './FriendAvatars';
import LiveBadge from './LiveBadge';

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

export default function SetCard({
  set,
  onTap,
  onPreview,
  showPicks = true,
  stageName = set.stageName || 'Unknown',
  stageColor = '#ff3366',
  friendProfiles = [],
  conflicts = [],
  b2bSeparator,
}: SetCardProps) {
  const { getMyPick, savePick, getMyNote } = usePicks();
  const currentFestival = useFestivalStore((state) => state.currentFestival);
  const { toast } = useToast();
  const { tap, select, warning } = useHaptics();
  const [saving, setSaving] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewPlaying, setPreviewPlaying] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const setStatus = useSetStatus(set);

  const myPick = getMyPick(set.id);
  const myNote = getMyNote(set.id);
  const artistName = artistDisplayName(set, b2bSeparator);
  const subtitle = artistSubtitle(set, b2bSeparator);

  const priClass = myPick ? ' priority-' + (PRI_MAP[myPick] || '') : '';
  const conflictClass = conflicts.length > 0 ? ' has-conflict' : '';

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
        audioRef.current.addEventListener('ended', () => setPreviewPlaying(false));
        audioRef.current.addEventListener('error', () => {
          setPreviewPlaying(false);
          setPreviewError('Playback failed');
        });
      }
      audioRef.current.src = src;
      await audioRef.current.play();
      setPreviewPlaying(true);
    } catch (err) {
      // 404 / no-preview / network error — show tooltip, don't break UI.
      setPreviewError('No preview');
      toast('No preview available', 'info');
    } finally {
      setPreviewLoading(false);
    }
  };

  return (
    <div
      className={'set-card' + priClass + conflictClass}
      data-testid="set-card"
      data-artist={artistName}
    >
      {/* Click/keyboard target — positioned absolute to fill the card so the
          outer div can stay non-interactive (avoids nested-interactive axe
          violation when footer buttons render as children). Footer buttons
          are positioned above via z-index. */}
      <button
        type="button"
        className="set-card-click-target"
        aria-label={`${artistName} — ${stageName} ${set.startTime ? formatTime(set.startTime) : 'TBA'}`}
        onClick={() => { tap(); onTap(); }}
        style={{
          position: 'absolute',
          inset: 0,
          background: 'transparent',
          border: 0,
          padding: 0,
          margin: 0,
          cursor: 'pointer',
          zIndex: 1,
        }}
      />

      {/* Spotify preview button — top-right corner, above click target */}
      {set.artists?.some((a) => a.links?.spotify) && (
        <button
          className="card-preview-btn"
          type="button"
          aria-label={
            previewPlaying
              ? `Stop preview for ${artistName}`
              : `Preview ${artistName}`
          }
          title={previewError || (previewPlaying ? 'Stop preview' : 'Play preview')}
          disabled={previewLoading}
          onClick={handlePreviewClick}
          style={{ position: 'absolute', top: 8, right: 8, zIndex: 2 }}
        >
          {previewPlaying ? '◼' : '▶'}
        </button>
      )}

      {/* Note indicator */}
      {myNote && <div className="card-note-indicator" style={{ position: 'relative', zIndex: 2 }}>📝</div>}

      {/* Conflict badge */}
      {conflicts.length > 0 && <div className="conflict-badge" style={{ position: 'relative', zIndex: 2 }}>⚠ Conflict</div>}

      {/* Stage label — solid bg + white text passes AA for all palette colors,
          including dark purples where the old faded-tint style failed contrast. */}
      <span
        className="card-stage"
        style={{
          background: stageColor,
          color: '#fff',
          fontWeight: 700,
          textShadow: '0 1px 2px rgba(0, 0, 0, 0.35)',
          position: 'relative',
          zIndex: 2,
        }}
      >
        {stageName}
      </span>

      {/* Artist name */}
      <div className="card-artist">{artistName}</div>
      {subtitle && <div className="card-artist-sub">{subtitle}</div>}

      {/* Time */}
      <span className="card-time">
        {set.startTime && set.endTime
          ? `${formatTime(set.startTime)} - ${formatTime(set.endTime)}`
          : 'TBA'}
      </span>

      {/* Live badge */}
      {['live', 'soon', 'upcoming'].includes(setStatus.status) && (
        <LiveBadge status={setStatus.status} label={setStatus.label} />
      )}

      {/* Footer with priority buttons, crew overlap, and preview */}
      <div className="card-footer">
        {/* Priority buttons */}
        {showPicks && (
          <div className="card-priority">
            {([['must', '★'], ['want-to-see', '◆'], ['maybe', '●']] as const).map(
              ([p, icon]) => {
                const active = myPick === p;
                const cls =
                  'card-priority-btn' + (active ? ` active-${PRI_MAP[p]}` : '');
                return (
                  <button
                    key={p}
                    className={cls}
                    type="button"
                    aria-pressed={active ? 'true' : 'false'}
                    aria-label={
                      (p === 'must'
                        ? 'Must See'
                        : p === 'want-to-see'
                          ? 'Want to See'
                          : 'Maybe') + (active ? ' (selected)' : '')
                    }
                    title={
                      p === 'must'
                        ? 'Must See'
                        : p === 'want-to-see'
                          ? 'Want to See'
                          : 'Maybe'
                    }
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
              },
            )}
          </div>
        )}

        {/* Crew overlap / who's going */}
        {friendProfiles.length > 0 && (
          <button
            className="card-overlap"
            type="button"
            aria-label={`${friendProfiles.length} crew members going to ${artistName}`}
            onClick={(e) => {
              e.stopPropagation();
            }}
          >
            <span className="crew-count-badge">
              {friendProfiles.length === 1 ? '1 going' : `${friendProfiles.length} going`}
            </span>
          </button>
        )}

      </div>
    </div>
  );
}
