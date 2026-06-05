import { cn } from '../../lib/utils';

/**
 * Collapsible legend explaining timeline colour-coding and symbols.
 */
export default function TimelineLegend() {
  return (
    <details
      className={cn(
        'text-xs text-[var(--color-text-secondary,#94a3b8)]',
        'mx-3 my-[2px_12px_4px] mt-0.5 mb-1',
        'timeline-legend',
      )}
      aria-label="Timeline legend"
    >
      <summary
        className={cn(
          'cursor-pointer inline-flex items-center gap-1',
          'px-1.5 py-[3px] rounded-lg',
          'bg-[var(--color-bg-glass,rgba(20,20,40,0.4))]',
          'font-semibold tracking-[0.04em] uppercase text-[10px]',
          'select-none',
          'transition-colors duration-[120ms] ease-out',
          'hover:bg-[var(--color-bg-glass-strong,rgba(20,20,40,0.6))]',
        )}
      >
        Legend
      </summary>
      <ul
        className={cn(
          'timeline-legend-list',
          'list-none p-[8px_10px] mt-1.5 mb-0',
          'grid gap-1.5',
          'bg-[var(--color-bg-glass,rgba(20,20,40,0.4))]',
          'border border-[var(--color-border,rgba(255,255,255,0.08))]',
          'rounded-[10px]',
        )}
      >
        <li className="flex items-center gap-2 text-xs leading-tight">
          <span className="w-2.5 h-2.5 rounded-sm shrink-0 bg-[var(--color-accent-coral)]" aria-hidden="true" />
          Must See (your pick)
        </li>
        <li className="flex items-center gap-2 text-xs leading-tight">
          <span className="w-2.5 h-2.5 rounded-sm shrink-0 bg-[var(--color-accent-aqua)]" aria-hidden="true" />
          Want to See (your pick)
        </li>
        <li className="flex items-center gap-2 text-xs leading-tight">
          <span className="w-2.5 h-2.5 rounded-sm shrink-0 bg-[var(--color-accent-amber)]" aria-hidden="true" />
          Maybe (your pick)
        </li>
        <li className="flex items-center gap-2 text-xs leading-tight">
          <span
            className="w-3 h-3 rounded-full shrink-0 bg-[var(--color-accent-aqua)] border-[1.5px] border-[var(--color-bg-primary)]"
            aria-hidden="true"
          />
          Crew pick — a friend in your crew also picked this set
        </li>
        <li className="flex items-center gap-2 text-xs leading-tight">
          <span aria-hidden="true">⚠</span>
          Schedule conflict with another of your picks
        </li>
        <li className="flex items-center gap-2 text-xs leading-tight">
          <span className="w-[18px] h-0.5 shrink-0 bg-[var(--color-accent-coral)]" aria-hidden="true" />
          Current time
        </li>
      </ul>
    </details>
  );
}
