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
  description: string;
  amount: string | number;
  paidByName: string;
  paidByMe: boolean;
  splitCount: number;
  category: CategoryDef;
  onRemove: (id: string) => void;
  isRemoving: boolean;
}

export default function ExpenseItem({
  id,
  description,
  amount,
  paidByName,
  paidByMe,
  splitCount,
  category,
  onRemove,
  isRemoving,
}: ExpenseItemProps) {
  return (
    <div className="crew-list-enter p-3 rounded-lg bg-bg-card border border-border flex items-start gap-3">
      <span className="text-xl leading-none" aria-hidden="true">{category.emoji}</span>
      <div className="flex-1 min-w-0">
        <div className="font-semibold text-text-primary">{description}</div>
        <div className="text-xs text-text-secondary">
          ${Number(amount).toFixed(2)} {'·'} {paidByMe ? 'You' : paidByName} paid
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
