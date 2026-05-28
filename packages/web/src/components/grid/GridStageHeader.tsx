import React from 'react';
import { Share2 } from 'lucide-react';
import { cn } from '../../lib/utils';

interface GridStageHeaderProps {
  visibleStages: Array<{ id: string }>;
  gutterW: number;
  minColWidth: string;
  exporting: boolean;
  onExport: () => void;
  getStageColor: (id: string) => string | undefined;
  getStageName: (id: string) => string | undefined;
}

export default function GridStageHeader({
  visibleStages,
  gutterW,
  minColWidth,
  exporting,
  onExport,
  getStageColor,
  getStageName,
}: GridStageHeaderProps) {
  return (
    <div
      className="fk-grid__head grid shrink-0 bg-bg-primary border-b border-border-light sticky top-0 z-10"
      role="row"
      style={{
        gridTemplateColumns: `${gutterW}px repeat(${visibleStages.length}, minmax(${minColWidth}, 160px))`,
      }}
      data-grid-head
    >
      <div role="columnheader" aria-label="Time" className="flex items-center justify-center">
        <button
          className={cn(
            'fk-grid__share-btn inline-flex items-center justify-center w-11 h-11 rounded-md cursor-pointer',
            'text-accent-aqua',
            'transition-[background-color,transform]',
            'hover:bg-[color-mix(in_srgb,var(--color-accent-aqua)_24%,transparent)]',
            'active:scale-[0.93]',
            'focus-visible:outline-2 focus-visible:outline-accent-aqua focus-visible:outline-offset-2',
            'aria-busy:opacity-70 aria-busy:cursor-progress',
          )}
          style={{
            background: 'color-mix(in srgb, var(--color-accent-aqua) 12%, transparent)',
            border: '1px solid color-mix(in srgb, var(--color-accent-aqua) 35%, transparent)',
          }}
          onClick={onExport}
          title="Share grid"
          aria-label="Share grid as image"
          aria-busy={exporting ? 'true' : 'false'}
          disabled={exporting}
          type="button"
        >
          <Share2 size={14} aria-hidden="true" />
        </button>
      </div>
      {visibleStages.map((st) => {
        const c = getStageColor(st.id);
        return (
          <div
            key={st.id}
            className={cn(
              'fk-grid__col-head py-2 px-1.5 mx-[3px] my-1',
              'text-[0.65rem] font-bold uppercase tracking-[0.06em] text-center',
              'text-text-primary rounded-full leading-[1.25]',
              'overflow-hidden text-ellipsis whitespace-nowrap',
            )}
            role="columnheader"
            style={{
              '--stage-c': c,
              background: `color-mix(in srgb, ${c || 'var(--color-border-light)'} 18%, transparent)`,
              border: `1px solid color-mix(in srgb, ${c || 'var(--color-border-light)'} 40%, transparent)`,
              borderBottom: `3px solid ${c || 'var(--color-border-light)'}`,
            } as React.CSSProperties}
          >
            {getStageName(st.id)}
          </div>
        );
      })}
    </div>
  );
}
