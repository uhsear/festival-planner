import React from 'react';
import { artistDisplayName } from '@festie/shared/utils';
import { PICK_COLOR, toMin, fmtShort } from './gridUtils';
import type { GridBounds, HourMark } from './gridUtils';
import type { FestivalSet, Priority } from '@festie/shared/types';
import { cn } from '../../lib/utils';

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
  /**
   * How many OTHER crew members picked a set (M1 crew-overlap). Optional so the
   * column degrades gracefully when overlap data isn't wired (e.g. exports).
   */
  getOverlapCount?: (setId: string) => number;
  onSetClick: (set: FestivalSet | null) => void;
}

function GridStageColumn({
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
  getOverlapCount,
  onSetClick,
}: GridStageColumnProps) {
  return (
    <div
      className="fk-grid__col relative flex-1 min-w-[110px] max-w-[160px] border-l border-border"
      role="row"
      aria-label={stageName}
      style={{ height: totalH, '--stage-c': stageColor } as React.CSSProperties}
      data-grid-col
    >
      {hours.map(({ m, px }) => (
        <div key={m} className="absolute left-0 right-0 h-px bg-border-light pointer-events-none" style={{ top: px }} />
      ))}
      {hours.slice(0, -1).map(({ m, px }) => (
        <div
          key={`h-${m}`}
          className="absolute left-0 right-0 h-px bg-border pointer-events-none"
          style={{ top: px + 30 * pxPerMin }}
        />
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
        const overlap = getOverlapCount?.(set.id) ?? 0;
        const overlapLabel = overlap > 0 ? `, ${overlap} crew ${overlap === 1 ? 'member' : 'members'} going` : '';

        return (
          <button
            key={set.id}
            role="gridcell"
            className={cn(
              'fk-grid__set absolute left-1 right-1 rounded-md py-[5px] px-[7px] pb-1',
              'cursor-pointer overflow-hidden flex flex-col gap-0.5 text-left',
              'transition-[filter,transform] duration-[120ms] ease-[ease]',
              'backdrop-blur-[2px]',
              'hover:[@media(hover:hover)]:brightness-[1.3] hover:[@media(hover:hover)]:scale-x-[1.02] hover:[@media(hover:hover)]:z-[4]',
              'focus-visible:outline-2 focus-visible:outline-accent-aqua focus-visible:outline-offset-1 focus-visible:z-5',
              pick && 'shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--set-c)_40%,transparent)]',
            )}
            style={
              {
                top,
                height,
                '--set-c': pc,
                background: pick ? `color-mix(in srgb, ${pc} 28%, #0d0d1a)` : pc + '15',
              } as React.CSSProperties
            }
            onClick={() => onSetClick(set)}
            aria-label={`${dn} at ${stageName || stageId}, ${fmtShort(set.startTime!)} to ${fmtShort(set.endTime!)}${pick ? ', ' + pick : ''}${overlapLabel}`}
            data-grid-set
          >
            {pick && (
              <span
                className="absolute top-[3px] right-[5px] text-[0.7rem] leading-none pointer-events-none drop-shadow-[0_0_2px_rgba(0,0,0,0.45)]"
                style={{ color: pc }}
                aria-hidden="true"
              >
                &#9829;
              </span>
            )}
            <span className="text-[0.7rem] font-semibold text-text-primary leading-[1.25] overflow-hidden break-words [overflow-wrap:anywhere] [-webkit-line-clamp:2] [-webkit-box-orient:vertical] [display:-webkit-box]">
              {dn}
            </span>
            {height >= 48 && (
              <span className="text-[length:var(--font-size-10)] text-text-secondary whitespace-nowrap overflow-hidden text-ellipsis shrink-0 leading-[var(--line-height-tight)] tabular-nums">
                {fmtShort(set.startTime!)}–{fmtShort(set.endTime!)}
              </span>
            )}
            {overlap > 0 && (
              // Compact crew-overlap indicator: a people glyph + count pinned to
              // the cell's bottom-right. aria-hidden — the count is already in
              // the gridcell's aria-label above.
              <span
                className="fk-grid__overlap absolute bottom-[3px] right-[5px] flex items-center gap-[2px] rounded-full bg-[rgba(0,232,208,0.18)] px-1 py-px text-[length:var(--font-size-10)] font-bold leading-none text-accent-aqua pointer-events-none tabular-nums"
                aria-hidden="true"
                data-grid-overlap
              >
                &#128101;{overlap}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

export default React.memo(GridStageColumn);
