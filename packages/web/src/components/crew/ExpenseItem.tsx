import React from 'react';
import { Trash2 } from 'lucide-react';
import IconButton from '../ui/IconButton';

interface CategoryDef {
  key: string;
  emoji: string;
  label: string;
}

export interface ExpenseItemProps {
  id: string;
  index: number;
  description: string;
  amount: string | number;
  paidByName: string;
  paidByMe: boolean;
  splitCount: number;
  category: CategoryDef;
  /** Planned/budget row — forecast only, excluded from settle-up. */
  planned?: boolean;
  onRemove: (id: string) => void;
  isRemoving: boolean;
}

export default function ExpenseItem({
  id,
  index,
  description,
  amount,
  paidByName,
  paidByMe,
  splitCount,
  category,
  planned,
  onRemove,
  isRemoving,
}: ExpenseItemProps) {
  return (
    <div
      className="stagger-item p-3 rounded-lg bg-bg-card border border-glass-border flex items-start gap-3 motion-reduce:!animate-none"
      style={{ '--i': Math.min(index, 6) } as React.CSSProperties}
    >
      <span className="text-xl leading-none" aria-hidden="true">
        {category.emoji}
      </span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <div className="font-semibold text-text-primary truncate">{description}</div>
          {planned && (
            <span className="shrink-0 px-1.5 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wide bg-accent-aqua/15 text-accent-aqua border border-accent-aqua/40">
              Planned
            </span>
          )}
        </div>
        <div className="text-xs text-text-secondary">
          <span className="tabular-nums">${Number(amount).toFixed(2)}</span> {'·'}{' '}
          {planned ? 'planned' : `${paidByMe ? 'You' : paidByName} paid`}
          {splitCount > 0 && ` · split ${splitCount} ways`}
        </div>
      </div>
      {paidByMe && (
        <IconButton
          label="Remove expense"
          variant="danger"
          icon={<Trash2 className="w-4 h-4" />}
          onClick={() => onRemove(id)}
          disabled={isRemoving}
        />
      )}
    </div>
  );
}
