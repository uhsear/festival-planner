import React, { useState } from 'react';
import { FestivalSet, Priority } from '@festie/shared/types';
import { PRIORITY_MAP } from '@festie/shared/constants';
import { usePicks } from '@festie/shared/hooks';
import { formatTime, artistDisplayName, artistSubtitle } from '@festie/shared/utils';
import { useFestivalStore } from '@festie/shared/stores';
import { useSetStatus } from '@/hooks/useSetStatus';
import FriendAvatars from './FriendAvatars';
import LiveBadge from './LiveBadge';

interface SetCardProps {
  set: FestivalSet;
  onTap: () => void;
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
  showPicks = true,
  stageName = set.stageName || 'Unknown',
  stageColor = '#ff3366',
  friendProfiles = [],
  conflicts = [],
  b2bSeparator,
}: SetCardProps) {
  const { getMyPick, savePick, getMyNote } = usePicks();
  const currentFestival = useFestivalStore((state) => state.currentFestival);
  const [saving, setSaving] = useState(false);
  const setStatus = useSetStatus(set);

  const myPick = getMyPick(set.id);
  const myNote = getMyNote(set.id);
  const artistName = artistDisplayName(set, b2bSeparator);
  const subtitle = artistSubtitle(set, b2bSeparator);

  const priClass = myPick ? ' priority-' + (PRI_MAP[myPick] || '') : '';
  const conflictClass = conflicts.length > 0 ? ' has-conflict' : '';

  const handlePriorityChange = async (priority: string, currentlyActive: boolean) => {
    setSaving(true);
    try {
      if (currentFestival) {
        await savePick(currentFestival.id, set.id, currentlyActive ? null : (priority as Priority));
      }
    } finally {
      setSaving(false);
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
        onClick={onTap}
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

      {/* Note indicator */}
      {myNote && <div className="card-note-indicator" style={{ position: 'relative', zIndex: 2 }}>📝</div>}

      {/* Conflict badge */}
      {conflicts.length > 0 && <div className="conflict-badge" style={{ position: 'relative', zIndex: 2 }}>⚠ Conflict</div>}

      {/* Stage label */}
      <span className="card-stage" style={{ background: stageColor + '25', color: stageColor, position: 'relative', zIndex: 2 }}>
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

        {/* Spotify preview button */}
        {set.artists?.some((a) => a.links?.spotify) && (
          <button
            className="card-preview-btn"
            type="button"
            aria-label={`Preview ${artistName}`}
            onClick={(e) => {
              e.stopPropagation();
              e.preventDefault();
            }}
          >
            ▶
          </button>
        )}
      </div>
    </div>
  );
}
