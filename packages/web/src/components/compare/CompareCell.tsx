import React, { memo } from 'react';
import type { Priority } from '@festie/shared/types';

const PRIORITY_STYLE: Record<Priority, { label: string; bg: string; fg: string }> = {
  'must':         { label: 'Must',  bg: 'var(--color-priority-must)',  fg: 'var(--color-text-primary)' },
  'want-to-see':  { label: 'Want',  bg: 'var(--color-priority-want)',  fg: 'var(--color-bg-primary)' },
  'maybe':        { label: 'Maybe', bg: 'var(--color-priority-maybe)', fg: 'var(--color-bg-primary)' },
};

interface CompareCellProps {
  priority: Priority | undefined;
}

export default memo(function CompareCell({ priority }: CompareCellProps) {
  return (
    <td className="py-3 px-2 text-center align-middle">
      {priority ? (
        <span
          className="inline-block text-[11px] font-semibold px-2 py-1 rounded"
          style={{ background: PRIORITY_STYLE[priority].bg, color: PRIORITY_STYLE[priority].fg }}
        >
          {PRIORITY_STYLE[priority].label}
        </span>
      ) : (
        <span className="text-text-muted text-xs">{'—'}</span>
      )}
    </td>
  );
});
