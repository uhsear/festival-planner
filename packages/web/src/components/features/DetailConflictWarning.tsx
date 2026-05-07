import { FestivalSet, Priority } from '@festie/shared/types';
import { formatTime, artistDisplayName } from '@festie/shared/utils';

interface Props {
  conflicts: FestivalSet[];
  currentSetId: string;
  myPick: Priority | null;
  b2bSeparator?: string;
  getStageName: (stageId: string) => string | null | undefined;
  getOtherPicks: (setId: string) => Array<{ profileId: string; priority: string }>;
  onSwitch: (fromSetId: string, toSet: FestivalSet, priority: Priority) => void;
}

export default function DetailConflictWarning({
  conflicts, currentSetId, myPick, b2bSeparator, getStageName, getOtherPicks, onSwitch,
}: Props) {
  if (conflicts.length === 0) return null;

  return (
    <div className="detail-conflict-warning">
      <div>
        {'\u26A0 Time conflict with: ' +
          conflicts.map((c) => artistDisplayName(c, b2bSeparator)).join(', ')}
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
                {cOthers.length ? cOthers.length + ' crew going' : 'No crew'}
              </div>
              <button
                className="btn btn-ghost btn-sm"
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onSwitch(currentSetId, c, myPick || 'want-to-see');
                }}
              >
                Switch to this
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
