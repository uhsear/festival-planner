import React, { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@festie/shared';
import { useToast } from '../../lib/toastContext';
import { cn } from '@/lib/utils';
import Button from '../ui/Button';
import Input from '../ui/Input';
import EmptyState from '../ui/EmptyState';
import Skeleton from '../ui/Skeleton';
import { DollarSign, Plus, Trash2, HandCoins, X } from 'lucide-react';
import IconButton from '../ui/IconButton';

// Server shape (snake_case from routes/expenses.js + expenses store).
interface RawExpense {
  id: string;
  crew_id: string;
  paid_by: string;
  paid_by_name: string;
  description: string;
  amount: string | number; // numeric(10,2) comes back as string in pg
  split_with: string[];
  category: string;
  created_at: string;
}

interface Balance { userId: string; username: string; balance: number }

// Crew member shape from /crews/:id (serializeCrewWithMembers).
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

export default function ExpensesTab({ crewId, members, currentUserId }: Props) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);

  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState<string>('other');
  const [splitWith, setSplitWith] = useState<string[]>(() => members.map((m) => m.userId));

  const { data: expenses = [], isLoading, isError } = useQuery<RawExpense[]>({
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
    mutationFn: (payload: { toUserId: string; amount: number }) =>
      api.post(`/crews/${crewId}/expenses/settle`, payload),
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

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const amt = Number(amount);
    if (!description.trim() || !Number.isFinite(amt) || amt <= 0) return;
    addExpense.mutate({
      description: description.trim(),
      amount: amt,
      splitWith,
      category,
    });
  }

  const memberName = useMemo(() => {
    const m: Record<string, string> = {};
    for (const u of members) m[u.userId] = u.name || u.username || 'User';
    return m;
  }, [members]);

  const myBalance = balances.find((b) => b.userId === currentUserId)?.balance ?? 0;
  const totalSpent = expenses.reduce((sum, e) => sum + Number(e.amount), 0);

  if (isLoading) return <div className="px-4 space-y-2"><Skeleton variant="card" /><Skeleton variant="card" /></div>;
  if (isError) return <div className="px-4"><EmptyState icon={<DollarSign className="w-12 h-12" />} title="Couldn't load expenses" description="Try again later." /></div>;

  return (
    <div className="space-y-3 px-4">
      {/* Summary */}
      {expenses.length > 0 && (
        <div className="grid grid-cols-2 gap-2">
          <div className="p-3 rounded-lg bg-bg-card border border-border">
            <div className="text-xs text-text-muted uppercase tracking-wide">Total spent</div>
            <div className="text-lg font-bold text-text-primary">${totalSpent.toFixed(2)}</div>
          </div>
          <div className="p-3 rounded-lg bg-bg-card border border-border">
            <div className="text-xs text-text-muted uppercase tracking-wide">Your balance</div>
            <div className={cn('text-lg font-bold',
              myBalance > 0.01 ? 'text-accent-aqua' : myBalance < -0.01 ? 'text-accent-coral' : 'text-text-primary')}>
              {myBalance > 0.01 ? `+$${myBalance.toFixed(2)}` : myBalance < -0.01 ? `-$${Math.abs(myBalance).toFixed(2)}` : '$0.00'}
            </div>
          </div>
        </div>
      )}

      {/* Balances w/ settle button */}
      {balances.filter((b) => Math.abs(b.balance) > 0.01).length > 0 && (
        <div className="p-3 rounded-lg bg-bg-card border border-border space-y-2">
          <div className="text-xs text-text-muted uppercase tracking-wide">Who owes what</div>
          {balances.filter((b) => Math.abs(b.balance) > 0.01).map((b) => {
            const owesMe = b.userId !== currentUserId && b.balance < -0.01 && myBalance > 0.01;
            const iOwe = b.userId !== currentUserId && b.balance > 0.01 && myBalance < -0.01;
            return (
              <div key={b.userId} className="flex items-center justify-between gap-2">
                <span className="text-sm text-text-primary">
                  {b.userId === currentUserId ? 'You' : b.username}
                  {' '}
                  <span className={b.balance > 0 ? 'text-accent-aqua' : 'text-accent-coral'}>
                    {b.balance > 0 ? `+$${b.balance.toFixed(2)}` : `-$${Math.abs(b.balance).toFixed(2)}`}
                  </span>
                </span>
                {iOwe && (
                  <Button variant="outline" onClick={() => settle.mutate({ toUserId: b.userId, amount: Math.min(Math.abs(myBalance), b.balance) })}
                    className="!py-1 !px-3 text-xs min-h-11">
                    <HandCoins className="w-3.5 h-3.5" /> Settle up
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
          <Plus className="w-4 h-4" /> Add Expense
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
            <div className="grid grid-cols-3 gap-2">
              {CATEGORIES.map((c) => (
                <button key={c.key} type="button" onClick={() => setCategory(c.key)}
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
            <div className="flex flex-wrap gap-2">
              {members.map((m) => {
                const active = splitWith.includes(m.userId);
                return (
                  <button key={m.userId} type="button" onClick={() => toggleMember(m.userId)}
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
                ${(Number(amount) / splitWith.length).toFixed(2)}/person × {splitWith.length}
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
        <EmptyState icon={<DollarSign className="w-12 h-12" />} title="No expenses yet"
          description="Track shared costs so everyone knows where they stand." />
      ) : (
        <div className="space-y-2">
          {expenses.map((e) => {
            const cat = CATEGORIES.find((c) => c.key === e.category) || CATEGORIES[CATEGORIES.length - 1];
            const paidByMe = e.paid_by === currentUserId;
            return (
              <div key={e.id} className="crew-list-enter p-3 rounded-lg bg-bg-card border border-border flex items-start gap-3">
                <span className="text-xl leading-none" aria-hidden="true">{cat.emoji}</span>
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-text-primary">{e.description}</div>
                  <div className="text-xs text-text-secondary">
                    ${Number(e.amount).toFixed(2)} · {paidByMe ? 'You' : e.paid_by_name} paid
                    {e.split_with.length > 0 && ` · split ${e.split_with.length} ways`}
                  </div>
                </div>
                {paidByMe && (
                  <IconButton
                    label="Remove expense"
                    variant="danger"
                    icon={<Trash2 className="w-4 h-4" />}
                    onClick={() => removeExpense.mutate(e.id)}
                    disabled={removeExpense.isPending}
                  />
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
