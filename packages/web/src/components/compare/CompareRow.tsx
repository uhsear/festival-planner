import React, { memo } from 'react';
import { formatTime } from '@festie/shared/utils';
import type { FestivalSet, Priority } from '@festie/shared/types';
import CompareCell from './CompareCell';

interface ColumnProfile {
  id: string;
  isMe: boolean;
}

export interface CompareRowProps {
  set: FestivalSet;
  mine: Priority | undefined;
  others: Array<{ profileId: string; priority: Priority }>;
  columns: ColumnProfile[];
  stageColor: string;
  stageName: string;
  isConsensus: boolean;
}

function pickFor(
  profileId: string,
  isMe: boolean,
  mine?: Priority,
  others?: Array<{ profileId: string; priority: Priority }>,
): Priority | undefined {
  if (isMe) return mine;
  return others?.find((o) => o.profileId === profileId)?.priority;
}

export default memo(function CompareRow({
  set,
  mine,
  others,
  columns,
  stageColor,
  stageName,
  isConsensus,
}: CompareRowProps) {
  return (
    <tr className="border-t border-border">
      <th
        scope="row"
        className="sticky left-0 bg-bg-primary z-10 py-3 pr-3 align-top text-left pl-2.5"
        style={{ borderLeft: `3px solid ${stageColor}` }}
      >
        <div className="font-semibold text-text-primary truncate max-w-[180px]">{set.artist}</div>
        <div className="text-xs text-text-secondary">
          {formatTime(set.startTime)}{'–'}{formatTime(set.endTime)}
        </div>
        <div className="text-xs" style={{ color: stageColor }}>{stageName}</div>
        {isConsensus && (
          <div className="mt-1 inline-block text-[10px] px-1.5 py-0.5 rounded bg-accent-amber/20 text-accent-amber font-semibold">
            All going
          </div>
        )}
      </th>
      {columns.map((c) => (
        <CompareCell key={c.id} priority={pickFor(c.id, c.isMe, mine, others)} />
      ))}
    </tr>
  );
});
