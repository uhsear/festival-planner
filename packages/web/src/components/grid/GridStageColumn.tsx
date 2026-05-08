import React from 'react';
import { artistDisplayName } from '@festie/shared/utils';
import { PICK_COLOR, toMin, fmtShort } from './gridUtils';
import type { GridBounds, HourMark } from './gridUtils';
import type { FestivalSet, Priority } from '@festie/shared/types';

interface GridStageColumnProps {
  stageId: string;
  stageSets: FestivalSet[];
  stageColor: string | undefined;
  stageName: string | undefined;
  hours: HourMark[];
  bounds: GridBounds;
  totalH: number;
  pxPerMin: number;
  b2bSeparator?: string;
  getMyPick: (setId: string) => Priority | null | undefined;
  onSetClick: (set: FestivalSet | null) => void;
}

export default function GridStageColumn({
  stageId,
  stageSets,
  stageColor,
  stageName,
  hours,
  bounds,
  totalH,
  pxPerMin,
  b2bSeparator,
  getMyPick,
  onSetClick,
}: GridStageColumnProps) {
  return (
    <div
      className="fk-grid__col"
      role="row"
      aria-label={stageName}
      style={{ height: totalH, '--stage-c': stageColor } as React.CSSProperties}
    >
      {hours.map(({ m, px }) => (
        <div key={m} className="fk-grid__line--hour" style={{ top: px }} />
      ))}
      {hours.slice(0, -1).map(({ m, px }) => (
        <div key={`h-${m}`} className="fk-grid__line--half" style={{ top: px + 30 * pxPerMin }} />
      ))}

      {stageSets.map((set) => {
        const a = toMin(set.startTime!);
        let b = toMin(set.endTime!);
        if (b <= a) b += 1440;
        const top = (a - bounds.lo) * pxPerMin;
        // WCAG 2.5.5 -- tap targets should be >= 44px. A 15-min set at
        // PX_PER_MIN=1.6 is only 24px, so bump to 44.
        const height = Math.max((b - a) * pxPerMin, 44);
        const pick = getMyPick(set.id);
        const pc = pick ? PICK_COLOR[pick] : stageColor;
        const dn = artistDisplayName(set, b2bSeparator);

        return (
          <button
            key={set.id}
            role="gridcell"
            className={`fk-grid__set${pick ? ' fk-grid__set--picked' : ''}`}
            style={
              {
                top,
                height,
                '--set-c': pc,
                borderLeftColor: pc,
                background: pick
                  ? `color-mix(in srgb, ${pc} 28%, #0d0d1a)`
                  : pc + '15',
              } as React.CSSProperties
            }
            onClick={() => onSetClick(set)}
            aria-label={`${dn} at ${stageName || stageId}, ${fmtShort(set.startTime!)} to ${fmtShort(set.endTime!)}${pick ? ', ' + pick : ''}`}
          >
            {pick && (
              <span className="fk-grid__pick-heart" style={{ color: pc }} aria-hidden="true">
                &#9829;
              </span>
            )}
            <span className="fk-grid__set-name">{dn}</span>
            {height >= 48 && (
              <span className="fk-grid__set-time">
                {fmtShort(set.startTime!)}–{fmtShort(set.endTime!)}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
