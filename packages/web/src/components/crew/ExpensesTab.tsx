import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@festie/shared';
import { useCrewStore } from '@festie/shared/stores';
import type { SettleCrewExpenseRequest } from '@festie/shared/types';
import { useToast } from '../../lib/toastContext';
import { cn } from '@/lib/utils';
import Button from '../ui/Button';
import Input from '../ui/Input';
import EmptyState from '../ui/EmptyState';
import Skeleton from '../ui/Skeleton';
import ExpenseItem from './ExpenseItem';
import { DollarSign, Plus, HandCoins, X } from 'lucide-react';
import IconButton from '../ui/IconButton';

interface RawExpense {
  id: string;
  crew_id: string;
  paid_by: string;
  paid_by_name: string;
  description: string;
  amount: string | number;
  split_with: string[];
  category: string;
  created_at: string;
}

interface Balance { userId: string; username: string; balance: number }
interface CrewMemberLite { userId: string; username?: string; name?: string }

interface Props {
  crewId: string;
  members: CrewMemberLite[];
  currentUserId: string;
}

const CATEGORIES = [
  { key: 'food',     emoji: '🍔', label: 'Food'   },
  { key: 'drinks',   emoji: '🍺', label: 'Drinks' },
  { key: 'transport',emoji: '🚗', label: 'Ride'   },
  { key: 'hotel',    emoji: '🏨', label: 'Hotel'  },
  { key: 'tickets',  emoji: '🎫', label: 'Tickets'},
  { key: 'other',    emoji: '💸', label: 'Other'  },
] as const;

function formatBalance(value: number): string {
  if (value > 0.01) return `+$${value.toFixed(2)}`;
  if (value < -0.01) return `-$${Math.abs(value).toFixed(2)}`;
  return '$0.00';
}

function balanceColor(value: number): string {
  if (value > 0.01) return 'text-accent-aqua';
  if (value < -0.01) return 'text-accent-coral';
  return 'text-text-primary';
}

export default function ExpensesTab({ crewId, members, currentUserId }: Props) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const settleExpense = useCrewStore((s) => s.settleExpense);
  const [showForm, setShowForm] = useState(false);

  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState<string>('other');
  const [splitWith, setSplitWith] = useState<string[]>(() => members.map((m) => m.userId));

  const { data: expenses = [], isLoading, isError, refetch } = useQuery<RawExpense[]>({
    queryKey: ['expenses', crewId],
    queryFn: async () => {
      const res = await api.get<RawExpense[]>(`/crews/${crewId}/expenses`);
      return Array.isArray(res) ? res : [];
    },
    enabled: !!crewId,
  });

  const { data: balances = [] } = useQuery<Balance[]>({
    queryKey: ['expense-balances', crewId],
    queryFn: async () => {
      const res = await api.get<Balance[] | { balances: Balance[] }>(
        `/crews/${crewId}/expenses/balances`,
      );
      return Array.isArray(res) ? res : (res?.balances || []);
    },
    enabled: !!crewId,
  });

  const addExpense = useMutation({
    mutationFn: (payload: { description: string; amount: number; splitWith: string[]; category: string }) =>
      api.post(`/crews/${crewId}/expenses`, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['expenses', crewId] });
      qc.invalidateQueries({ queryKey: ['expense-balances', crewId] });
      toast('Expense added', 'success');
      reset();
    },
    onError: (e) => toast(e instanceof Error ? e.message : 'Failed to add', 'error'),
  });

  const removeExpense = useMutation({
    mutationFn: (id: string) => api.delete(`/crews/${crewId}/expenses/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['expenses', crewId] });
      qc.invalidateQueries({ queryKey: ['expense-balances', crewId] });
      toast('Removed', 'success');
    },
    onError: () => toast('Failed to remove', 'error'),
  });

  const settle = useMutation({
    mutationFn: (payload: SettleCrewExpenseRequest) => settleExpense(crewId, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['expenses', crewId] });
      qc.invalidateQueries({ queryKey: ['expense-balances', crewId] });
      toast('Settled up', 'success');
    },
    onError: (e) => toast(e instanceof Error ? e.message : 'Failed to settle', 'error'),
  });

  function reset() {
    setDescription('');
    setAmount('');
    setCategory('other');
    setSplitWith(members.map((m) => m.userId));
    setShowForm(false);
  }

  function toggleMember(uid: string) {
    setSplitWith((prev) => (prev.includes(uid) ? prev.filter((id) => id !== uid) : [...prev, uid]));
  }

  function handleSettle(toUserId: string, theirBalance: number) {
    settle.mutate({ toUserId, amount: Math.min(Math.abs(myBalance), theirBalance) });
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const amt = Number(amount);
    if (!description.trim() || !Number.isFinite(amt) || amt <= 0) return;
    addExpense.mutate({ description: description.trim(), amount: amt, splitWith, category });
  }

  const myBalance = balances.find((b) => b.userId === currentUserId)?.balance ?? 0;
  const totalSpent = expenses.reduce((sum, e) => sum + Number(e.amount), 0);
  const nonZeroBalances = balances.filter((b) => Math.abs(b.balance) > 0.01);

  if (isLoading) return <div className="px-4 space-y-2"><Skeleton variant="card" /><Skeleton variant="card" /></div>;
  if (isError) return <div className="px-4"><EmptyState icon={<DollarSign className="w-12 h-12" aria-hidden="true" />} title="Couldn't load expenses" description="Something went wrong loading expenses." cta={{ label: 'Retry', onClick: () => refetch() }} /></div>;

  return (
    <div className="space-y-3 px-4">
      {/* Summary */}
      {expenses.length > 0 && (
        <div className="crew-stats-grid grid grid-cols-2 gap-2">
          <div className="p-3 rounded-lg bg-bg-card border border-border">
            <div className="text-xs text-text-muted uppercase tracking-wide">Total spent</div>
            <div className="text-lg font-bold text-text-primary">${totalSpent.toFixed(2)}</div>
          </div>
          <div className="p-3 rounded-lg bg-bg-card border border-border">
            <div className="text-xs text-text-muted uppercase tracking-wide">Your balance</div>
            <div className={cn('text-lg font-bold', balanceColor(myBalance))}>
              {formatBalance(myBalance)}
            </div>
          </div>
        </div>
      )}

      {/* Balances w/ settle button */}
      {nonZeroBalances.length > 0 && (
        <div className="p-3 rounded-lg bg-bg-card border border-border space-y-2">
          <div className="text-xs text-text-muted uppercase tracking-wide">Who owes what</div>
          {nonZeroBalances.map((b) => {
            const iOwe = b.userId !== currentUserId && b.balance > 0.01 && myBalance < -0.01;
            return (
              <div key={b.userId} className="flex items-center justify-between gap-2">
                <span className="text-sm text-text-primary">
                  {b.userId === currentUserId ? 'You' : b.username}
                  {' '}
                  <span className={b.balance > 0 ? 'text-accent-aqua' : 'text-accent-coral'}>
                    {formatBalance(b.balance)}
                  </span>
                </span>
                {iOwe && (
                  <Button variant="outline" onClick={() => handleSettle(b.userId, b.balance)}
                    className="!py-1 !px-3 text-xs min-h-11">
                    <HandCoins className="w-3.5 h-3.5" aria-hidden="true" /> Settle up
                  </Button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Add form / toggle */}
      {!showForm ? (
        <Button variant="primary" onClick={() => setShowForm(true)} className="w-full min-h-11">
          <Plus className="w-4 h-4" aria-hidden="true" /> Add Expense
        </Button>
      ) : (
        <form onSubmit={submit} className="p-3 rounded-lg bg-bg-card border border-border space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-text-primary">New Expense</h3>
            <IconButton label="Cancel" icon={<X className="w-5 h-5" />} onClick={reset} />
          </div>
          <Input label="Description" value={description} onChange={(e) => setDescription(e.target.value)}
            placeholder="Dinner at the food truck" required maxLength={200} />
          <Input label="Amount" type="number" inputMode="decimal" step="0.01" min="0.01"
            value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" required />
          <div>
            <label className="block text-sm font-medium text-text-primary mb-2">Category</label>
            <div className="crew-category-grid grid grid-cols-3 gap-2">
              {CATEGORIES.map((c) => (
                <button key={c.key} type="button" onClick={() => setCategory(c.key)}
                  aria-pressed={category === c.key}
                  className={cn('min-h-11 px-2 py-2 rounded-lg border text-xs flex flex-col items-center gap-1',
                    category === c.key
                      ? 'bg-accent-aqua/15 border-accent-aqua text-accent-aqua'
                      : 'bg-bg-card border-border text-text-secondary hover:border-border-light')}>
                  <span aria-hidden="true">{c.emoji}</span>{c.label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-text-primary mb-2">Split between</label>
            <div className="flex flex-wrap gap-2 max-h-32 overflow-y-auto">
              {members.map((m) => {
                const active = splitWith.includes(m.userId);
                return (
                  <button key={m.userId} type="button" onClick={() => toggleMember(m.userId)}
                    aria-pressed={active}
                    className={cn('min-h-11 px-3 rounded-full border text-sm',
                      active
                        ? 'bg-accent-aqua/15 border-accent-aqua text-accent-aqua'
                        : 'bg-bg-card border-border text-text-secondary')}>
                    {m.name || m.username}
                  </button>
                );
              })}
            </div>
            {splitWith.length > 0 && amount && (
              <div className="text-xs text-text-muted mt-1">
                ${(Number(amount) / splitWith.length).toFixed(2)}/person {'×'} {splitWith.length}
              </div>
            )}
          </div>
          <Button type="submit" variant="primary" isLoading={addExpense.isPending}
            className="w-full min-h-11"
            disabled={!description.trim() || !amount || Number(amount) <= 0}>
            Add
          </Button>
        </form>
      )}

      {/* Expense list */}
      {expenses.length === 0 ? (
        <EmptyState icon={<DollarSign className="w-12 h-12" aria-hidden="true" />} title="No expenses yet"
          description="Track shared costs so everyone knows where they stand." />
      ) : (
        <div className="space-y-2">
          {expenses.map((e) => {
            const cat = CATEGORIES.find((c) => c.key === e.category) ?? CATEGORIES[CATEGORIES.length - 1]!;
            return (
              <ExpenseItem
                key={e.id}
                id={e.id}
                description={e.description}
                amount={e.amount}
                paidByName={e.paid_by_name}
                paidByMe={e.paid_by === currentUserId}
                splitCount={e.split_with.length}
                category={cat}
                onRemove={(id) => removeExpense.mutate(id)}
                isRemoving={removeExpense.isPending}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
