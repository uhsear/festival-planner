import { Priority } from '@festie/shared/types';
import { cn } from '../../lib/utils';

interface Props {
  myPick: Priority | null;
  priorityBusy: Priority | null | 'clear';
  onPriorityClick: (priority: Priority | null) => Promise<void>;
}

const priorityOptions: Array<[Priority | null, string, string]> = [
  ['must', '★', 'Must See'],
  ['want-to-see', '◆', 'Want to See'],
  ['maybe', '●', 'Maybe'],
  [null, '✕', 'Clear'],
];

const activeStyles: Record<string, string> = {
  must: 'border-priority-must bg-accent-coral/[0.08]',
  'want-to-see': 'border-priority-want bg-[var(--color-aqua-a08)]',
  maybe: 'border-priority-maybe bg-[var(--color-amber-a08)]',
  clear: 'border-text-muted bg-[var(--color-overlay-1)]',
};

const baseButtonClass =
  'flex-1 py-3 rounded-sm text-center bg-bg-card border-2 border-border cursor-pointer transition-all duration-200 ease-[var(--ease-standard)] text-text-primary touch-manipulation appearance-none hover:border-text-muted hover:bg-bg-card-hover active:scale-[0.97] focus-visible:outline-2 focus-visible:outline-accent-aqua focus-visible:outline-offset-2';

export default function DetailPriorityPicker({ myPick, priorityBusy, onPriorityClick }: Props) {
  return (
    <div className="flex gap-4 mb-6">
      {priorityOptions.map(([p, icon, label]) => {
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
            <div className="text-xl">{icon}</div>
            <div className="text-[11px] font-bold mt-1 uppercase tracking-[0.5px]">{label}</div>
          </button>
        );
      })}
    </div>
  );
}
