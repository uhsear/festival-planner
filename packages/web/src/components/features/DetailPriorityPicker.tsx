import type { LucideIcon } from 'lucide-react';
import { Star, Diamond, Circle, X } from 'lucide-react';
import { Priority } from '@festie/shared/types';
import { cn } from '../../lib/utils';

interface Props {
  myPick: Priority | null;
  priorityBusy: Priority | null | 'clear';
  onPriorityClick: (priority: Priority | null) => Promise<void>;
}

// Lucide vocabulary, matching SetCard's priority buttons (Star/Diamond/Circle)
// so the same concept renders identically across the Cards grid and the detail
// panel. `X` replaces the former Unicode ✕ for the Clear affordance.
const priorityOptions: Array<{ value: Priority | null; Icon: LucideIcon; label: string }> = [
  { value: 'must', Icon: Star, label: 'Must See' },
  { value: 'want-to-see', Icon: Diamond, label: 'Want to See' },
  { value: 'maybe', Icon: Circle, label: 'Maybe' },
  { value: null, Icon: X, label: 'Clear' },
];

// Selected fill mirrors SetCard's active priority buttons (solid fill + glow,
// not a border/tint) so the same concept reads identically in both places.
const activeStyles: Record<string, string> = {
  must: 'border-priority-must bg-accent-coral-strong text-text-on-accent shadow-[var(--shadow-glow-coral),0_0_0_1px_var(--color-coral-a3)]',
  'want-to-see':
    'border-priority-want bg-priority-want text-[var(--text-on-light-accent)] shadow-[var(--shadow-glow-aqua),0_0_0_1px_var(--color-aqua-a3)]',
  maybe:
    'border-priority-maybe bg-priority-maybe text-[var(--text-on-light-accent)] shadow-[var(--shadow-glow-amber),0_0_0_1px_var(--color-amber-a3)]',
  clear: 'border-text-muted bg-[var(--color-overlay-1)]',
};

const baseButtonClass =
  'flex-1 py-3 min-h-[44px] rounded-DEFAULT text-center bg-bg-card border-2 border-border cursor-pointer transition-[background-color,border-color,transform,box-shadow,color] duration-200 ease-[var(--ease-standard)] text-text-primary touch-manipulation appearance-none overflow-hidden hover:border-text-muted hover:bg-bg-card-hover active:scale-[0.97] focus-visible:outline-2 focus-visible:outline-accent-aqua focus-visible:outline-offset-2';

export default function DetailPriorityPicker({ myPick, priorityBusy, onPriorityClick }: Props) {
  return (
    <div className="flex gap-4 mb-6">
      {priorityOptions.map(({ value: p, Icon, label }) => {
        const active = myPick === p;
        const key: Priority | 'clear' = p ?? 'clear';
        const isThisBusy = priorityBusy === key;
        const anyBusy = priorityBusy !== null;
        return (
          <button
            key={label}
            className={cn(baseButtonClass, active && activeStyles[key])}
            type="button"
            aria-pressed={active ? 'true' : 'false'}
            aria-label={label + (active ? ' (selected)' : '')}
            aria-busy={isThisBusy ? 'true' : 'false'}
            disabled={anyBusy}
            onClick={async (e) => {
              e.preventDefault();
              e.stopPropagation();
              if (priorityBusy !== null) return;
              await onPriorityClick(p);
            }}
          >
            {/* Fill the glyph when active (Clear's X stays an outline — it has no
                meaningful fill area). Mirrors SetCard's fill-on-active treatment. */}
            <Icon
              className="w-5 h-5 mx-auto"
              fill={active && p !== null ? 'currentColor' : 'none'}
              aria-hidden="true"
            />
            <div className="text-[11px] font-bold mt-1 uppercase tracking-[0.5px]">{label}</div>
          </button>
        );
      })}
    </div>
  );
}
