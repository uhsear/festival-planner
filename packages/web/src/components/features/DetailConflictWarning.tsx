import { FestivalSet, Priority } from '@festie/shared/types';
import { formatTime, artistDisplayName } from '@festie/shared/utils';
import Button from '../ui/Button';

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
  conflicts,
  currentSetId,
  myPick,
  b2bSeparator,
  getStageName,
  getOtherPicks,
  onSwitch,
}: Props) {
  if (conflicts.length === 0) return null;

  return (
    <div className="py-2.5 px-3.5 rounded-sm bg-accent-coral/[0.08] border border-accent-coral/25 mb-4 text-xs text-[var(--color-text-danger)] font-semibold">
      <div>{'\u26A0 Time conflict with: ' + conflicts.map((c) => artistDisplayName(c, b2bSeparator)).join(', ')}</div>
      <div className="flex flex-col gap-4 mt-2.5">
        {conflicts.map((c) => {
          const cOthers = getOtherPicks(c.id);
          return (
            <div
              key={c.id}
              className="bg-bg-card border border-border rounded-sm p-4 flex flex-wrap items-center gap-4"
            >
              <div className="font-bold text-sm flex-1 min-w-[120px]">{artistDisplayName(c, b2bSeparator)}</div>
              <div className="text-xs text-text-secondary w-full">
                {formatTime(c.startTime) +
                  ' - ' +
                  formatTime(c.endTime) +
                  ' \u00B7 ' +
                  (getStageName(c.stageId) || 'Unknown')}
              </div>
              <div className="text-[11px] text-text-muted italic">
                {cOthers.length ? cOthers.length + ' crew going' : 'No crew'}
              </div>
              <Button
                variant="secondary"
                size="sm"
                type="button"
                aria-label={`Switch to ${artistDisplayName(c, b2bSeparator)}`}
                onClick={(e) => {
                  e.stopPropagation();
                  onSwitch(currentSetId, c, myPick || 'want-to-see');
                }}
              >
                Switch to this
              </Button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
