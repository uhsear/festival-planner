import React, { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@festie/shared';
import { useCrewStore } from '@festie/shared/stores';
import type { SettleCrewExpenseRequest, CrewSettlementPlan, CrewSettlement } from '@festie/shared/types';
import { venmoLink, cashAppLink, payPalLink } from '@festie/shared/utils';
import { useToast } from '../../lib/toastContext';
import { cn } from '@/lib/utils';
import Button from '../ui/Button';
import Input from '../ui/Input';
import EmptyState from '../ui/EmptyState';
import Skeleton from '../ui/Skeleton';
import ExpenseItem from './ExpenseItem';
import { DollarSign, Plus, HandCoins, X } from 'lucide-react';
import IconButton from '../ui/IconButton';
import { useAnimatedNumber } from '../../hooks/useAnimatedNumber';

interface RawExpense {
  id: string;
  crew_id: string;
  paid_by: string;
  paid_by_name: string;
  description: string;
  amount: string | number;
  split_with: string[];
  category: string;
  planned?: boolean;
  created_at: string;
}

interface Balance {
  userId: string;
  username: string;
  balance: number;
}
interface CrewMemberLite {
  userId: string;
  username?: string;
  name?: string;
}

interface Props {
  crewId: string;
  members: CrewMemberLite[];
  currentUserId: string;
}

const CATEGORIES = [
  { key: 'food', emoji: '🍔', label: 'Food' },
  { key: 'drinks', emoji: '🍺', label: 'Drinks' },
  { key: 'transport', emoji: '🚗', label: 'Ride' },
  { key: 'hotel', emoji: '🏨', label: 'Hotel' },
  { key: 'tickets', emoji: '🎫', label: 'Tickets' },
  { key: 'other', emoji: '💸', label: 'Other' },
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
  const [planned, setPlanned] = useState(false);
  const [splitWith, setSplitWith] = useState<string[]>(() => members.map((m) => m.userId));
  // Reset splitWith when crew changes (members prop identity changes with crewId).
  useEffect(() => {
    setSplitWith(members.map((m) => m.userId));
  }, [crewId]); // eslint-disable-line react-hooks/exhaustive-deps -- reset on crew switch, members follows crewId
  // Planned-vs-actual filter for the list. 'actual' = the real ledger (what
  // feeds settle-up); 'planned' = the budget/forecast view; 'all' = both.
  const [view, setView] = useState<'all' | 'actual' | 'planned'>('actual');
  // Settle-up view. 'simplified' = the netted greedy min-cash-flow plan (fewest
  // transfers, never a stranger-to-pay); 'raw' = every member's gross net balance.
  const [settleView, setSettleView] = useState<'simplified' | 'raw'>('simplified');

  const {
    data: expenses = [],
    isLoading,
    isError,
    refetch,
  } = useQuery<RawExpense[]>({
    queryKey: ['expenses', crewId],
    queryFn: async () => {
      const res = await api.get<RawExpense[]>(`/crews/${crewId}/expenses`);
      return Array.isArray(res) ? res : [];
    },
    enabled: !!crewId,
  });

  // Settlement plan = netted who-pays-whom (greedy min-cash-flow over the
  // integer-cent ledger) + raw balances + payee payment handles. Replaces the
  // old raw-balance + Math.min() settle heuristic.
  const { data: plan } = useQuery<CrewSettlementPlan>({
    queryKey: ['settlement-plan', crewId],
    queryFn: async () => {
      const res = await api.get<CrewSettlementPlan>(`/crews/${crewId}/expenses/settlement-plan`);
      return { balances: res?.balances ?? [], settlements: res?.settlements ?? [] };
    },
    enabled: !!crewId,
  });
  const balances: Balance[] = plan?.balances ?? [];
  const settlements: CrewSettlement[] = plan?.settlements ?? [];

  const addExpense = useMutation({
    mutationFn: (payload: {
      description: string;
      amount: number;
      splitWith: string[];
      category: string;
      planned: boolean;
    }) => api.post(`/crews/${crewId}/expenses`, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['expenses', crewId] });
      qc.invalidateQueries({ queryKey: ['settlement-plan', crewId] });
      toast('Expense added', 'success');
      reset();
    },
    onError: (e) => toast(e instanceof Error ? e.message : "Couldn't add expense. Try again.", 'error'),
  });

  const removeExpense = useMutation({
    mutationFn: (id: string) => api.delete(`/crews/${crewId}/expenses/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['expenses', crewId] });
      qc.invalidateQueries({ queryKey: ['settlement-plan', crewId] });
      toast('Removed', 'success');
    },
    onError: () => toast("Couldn't remove expense. Try again.", 'error'),
  });

  const settle = useMutation({
    mutationFn: (payload: SettleCrewExpenseRequest) => settleExpense(crewId, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['expenses', crewId] });
      qc.invalidateQueries({ queryKey: ['settlement-plan', crewId] });
      toast('Settled up', 'success');
    },
    onError: (e) => toast(e instanceof Error ? e.message : "Couldn't settle up. Try again.", 'error'),
  });

  function reset() {
    setDescription('');
    setAmount('');
    setCategory('other');
    setPlanned(false);
    setSplitWith(members.map((m) => m.userId));
    setShowForm(false);
  }

  function toggleMember(uid: string) {
    setSplitWith((prev) => (prev.includes(uid) ? prev.filter((id) => id !== uid) : [...prev, uid]));
  }

  // Settle the exact netted amount from the plan (NOT a Math.min heuristic).
  function handleSettle(s: CrewSettlement) {
    settle.mutate({ toUserId: s.toUserId, amount: s.amount });
  }

  // My net position from the netted plan, one actionable line per crew member:
  //   myPayments — "You owe {toName} ${amt}" (settle-able by me)
  //   myReceipts — "{fromName} owes you ${amt}" (they settle; read-only here)
  const myPayments = settlements.filter((s) => s.fromUserId === currentUserId);
  const myReceipts = settlements.filter((s) => s.toUserId === currentUserId);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const amt = Number(amount);
    if (!description.trim() || !Number.isFinite(amt) || amt <= 0) return;
    addExpense.mutate({ description: description.trim(), amount: amt, splitWith, category, planned });
  }

  const myBalance = balances.find((b) => b.userId === currentUserId)?.balance ?? 0;
  // Actual spend feeds the ledger; planned is the forecast/budget total. Keep
  // them separate so a budget row never inflates "total spent".
  const actualExpenses = expenses.filter((e) => !e.planned);
  const plannedExpenses = expenses.filter((e) => e.planned);
  const totalSpent = actualExpenses.reduce((sum, e) => sum + Number(e.amount), 0);
  const totalPlanned = plannedExpenses.reduce((sum, e) => sum + Number(e.amount), 0);
  // N1: tween the headline total when the live ledger changes instead of hard-cutting.
  const animatedTotalSpent = useAnimatedNumber(totalSpent, { decimals: 2 });
  const visibleExpenses = view === 'actual' ? actualExpenses : view === 'planned' ? plannedExpenses : expenses;
  const nonZeroBalances = balances.filter((b) => Math.abs(b.balance) > 0.01);

  if (isLoading)
    return (
      <div className="px-4 space-y-2">
        <Skeleton variant="card" />
        <Skeleton variant="card" />
      </div>
    );
  if (isError)
    return (
      <div className="px-4">
        <EmptyState
          icon={<DollarSign className="w-12 h-12" aria-hidden="true" />}
          title="Couldn't load expenses"
          description="Something went wrong loading expenses."
          cta={{ label: 'Retry', onClick: () => refetch() }}
        />
      </div>
    );

  return (
    <div className="space-y-3 px-4">
      {/* Summary */}
      {expenses.length > 0 && (
        <div className="crew-stats-grid grid grid-cols-2 gap-2">
          <div className="p-3 rounded-lg bg-bg-card border border-border">
            <div className="text-xs text-text-muted uppercase tracking-wide">Total spent</div>
            <div className="text-lg font-bold text-text-primary tabular-nums">${animatedTotalSpent}</div>
          </div>
          <div className="p-3 rounded-lg bg-bg-card border border-border">
            <div className="text-xs text-text-muted uppercase tracking-wide">Your balance</div>
            <div className={cn('text-lg font-bold tabular-nums', balanceColor(myBalance))}>
              {formatBalance(myBalance)}
            </div>
          </div>
          {totalPlanned > 0 && (
            <div className="p-3 rounded-lg bg-bg-card border border-border col-span-2">
              <div className="text-xs text-text-muted uppercase tracking-wide">Planned (budget)</div>
              <div className="text-lg font-bold text-accent-aqua tabular-nums">${totalPlanned.toFixed(2)}</div>
            </div>
          )}
        </div>
      )}

      {/* Planned-vs-actual filter. 'Actual' is the real ledger (settle-up); */}
      {/* 'Planned' is the budget/forecast view. */}
      {expenses.length > 0 && (
        <div
          role="tablist"
          aria-label="Filter expenses"
          className="flex gap-1 p-1 rounded-lg bg-bg-card border border-border"
        >
          {(['actual', 'planned', 'all'] as const).map((v) => (
            <button
              key={v}
              type="button"
              role="tab"
              aria-selected={view === v}
              onClick={() => setView(v)}
              className={cn(
                'flex-1 min-h-11 rounded-md text-xs font-medium capitalize',
                view === v ? 'bg-accent-aqua/15 text-accent-aqua' : 'text-text-secondary hover:text-text-primary',
              )}
            >
              {v}
            </button>
          ))}
        </div>
      )}

      {/* Settle up — one card, toggle between the netted Simplified plan
          (fewest transfers, never a stranger-to-pay) and the Raw per-member
          balances. Simplified surfaces one actionable net line per crew member:
          "You owe {name}" (settle-able) / "{name} owes you" (read-only). */}
      {(settlements.length > 0 || nonZeroBalances.length > 0) && (
        <div className="p-3 rounded-lg bg-bg-card border border-border space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div className="text-xs text-text-muted uppercase tracking-wide">Settle up</div>
            <div
              role="tablist"
              aria-label="Settle-up view"
              className="flex gap-1 p-0.5 rounded-md bg-bg-secondary border border-border"
            >
              {(['simplified', 'raw'] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  role="tab"
                  aria-selected={settleView === v}
                  onClick={() => setSettleView(v)}
                  className={cn(
                    'px-2.5 py-1 rounded text-[11px] font-medium capitalize',
                    settleView === v
                      ? 'bg-accent-aqua/15 text-accent-aqua'
                      : 'text-text-secondary hover:text-text-primary',
                  )}
                >
                  {v}
                </button>
              ))}
            </div>
          </div>

          {settleView === 'simplified' ? (
            myPayments.length === 0 && myReceipts.length === 0 ? (
              <div className="text-sm text-text-secondary">You're all settled up.</div>
            ) : (
              <div className="space-y-3">
                {/* You owe {name} — settle-able net transfers. */}
                {myPayments.map((s) => {
                  const venmo = venmoLink({
                    handle: s.payeeHandles.venmo,
                    amountCents: s.amountCents,
                    note: 'Festie settle-up',
                  });
                  const cashapp = cashAppLink({ handle: s.payeeHandles.cashapp, amountCents: s.amountCents });
                  const paypal = payPalLink({ handle: s.payeeHandles.paypal, amountCents: s.amountCents });
                  return (
                    <div key={`pay-${s.toUserId}`} className="space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm text-text-primary">
                          You owe <span className="font-medium">{s.toName}</span>{' '}
                          <span className="text-accent-coral font-semibold tabular-nums">${s.amount.toFixed(2)}</span>
                        </span>
                        <Button
                          variant="outline"
                          onClick={() => handleSettle(s)}
                          disabled={settle.isPending}
                          className="!py-1 !px-3 text-xs min-h-11"
                        >
                          <HandCoins className="w-3.5 h-3.5" aria-hidden="true" /> Settle up
                        </Button>
                      </div>
                      {(venmo || cashapp || paypal) && (
                        <div className="flex flex-wrap gap-2">
                          {venmo && (
                            <a
                              href={venmo.web}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="min-h-11 px-3 py-1 rounded-full border border-border text-xs text-text-secondary hover:border-border-light inline-flex items-center"
                            >
                              Pay with Venmo
                            </a>
                          )}
                          {cashapp && (
                            <a
                              href={cashapp.web}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="min-h-11 px-3 py-1 rounded-full border border-border text-xs text-text-secondary hover:border-border-light inline-flex items-center"
                            >
                              Pay with Cash App
                            </a>
                          )}
                          {paypal && (
                            <a
                              href={paypal.web}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="min-h-11 px-3 py-1 rounded-full border border-border text-xs text-text-secondary hover:border-border-light inline-flex items-center"
                            >
                              Pay with PayPal
                            </a>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
                {/* {name} owes you — read-only; the other person settles. */}
                {myReceipts.map((s) => (
                  <div key={`get-${s.fromUserId}`} className="flex items-center justify-between gap-2">
                    <span className="text-sm text-text-primary">
                      <span className="font-medium">{s.fromName}</span> owes you{' '}
                      <span className="text-accent-aqua font-semibold tabular-nums">${s.amount.toFixed(2)}</span>
                    </span>
                  </div>
                ))}
              </div>
            )
          ) : nonZeroBalances.length > 0 ? (
            <div className="space-y-2">
              {nonZeroBalances.map((b) => (
                <div key={b.userId} className="flex items-center justify-between gap-2">
                  <span className="text-sm text-text-primary">
                    {b.userId === currentUserId ? 'You' : b.username}{' '}
                    <span className={cn('tabular-nums', b.balance > 0 ? 'text-accent-aqua' : 'text-accent-coral')}>
                      {formatBalance(b.balance)}
                    </span>
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-sm text-text-secondary">Everyone's balance is zero.</div>
          )}
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
          <Input
            label="Description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Dinner at the food truck"
            required
            maxLength={200}
          />
          <Input
            label="Amount"
            type="number"
            inputMode="decimal"
            step="0.01"
            min="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.00"
            required
          />
          <div>
            <label className="block text-sm font-medium text-text-primary mb-2">Category</label>
            <div className="crew-category-grid grid grid-cols-3 gap-2">
              {CATEGORIES.map((c) => (
                <button
                  key={c.key}
                  type="button"
                  onClick={() => setCategory(c.key)}
                  aria-pressed={category === c.key}
                  className={cn(
                    'min-h-11 px-2 py-2 rounded-lg border text-xs flex flex-col items-center gap-1',
                    category === c.key
                      ? 'bg-accent-aqua/15 border-accent-aqua text-accent-aqua'
                      : 'bg-bg-card border-border text-text-secondary hover:border-border-light',
                  )}
                >
                  <span aria-hidden="true">{c.emoji}</span>
                  {c.label}
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
                  <button
                    key={m.userId}
                    type="button"
                    onClick={() => toggleMember(m.userId)}
                    aria-pressed={active}
                    className={cn(
                      'min-h-11 px-3 rounded-full border text-sm',
                      active
                        ? 'bg-accent-aqua/15 border-accent-aqua text-accent-aqua'
                        : 'bg-bg-card border-border text-text-secondary',
                    )}
                  >
                    {m.name || m.username}
                  </button>
                );
              })}
            </div>
            {splitWith.length > 0 && amount && (
              <div className="text-xs text-text-muted mt-1 tabular-nums">
                ${(Number(amount) / splitWith.length).toFixed(2)}/person {'×'} {splitWith.length}
              </div>
            )}
          </div>
          {/* Planned = budget/forecast row. Excluded from balances + settle-up. */}
          <label className="flex items-start gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={planned}
              onChange={(e) => setPlanned(e.target.checked)}
              className="mt-0.5 h-4 w-4 accent-accent-aqua"
            />
            <span className="text-sm text-text-primary">
              Planned expense <span className="text-text-muted">(budget only — won't affect who owes what)</span>
            </span>
          </label>
          <Button
            type="submit"
            variant="primary"
            isLoading={addExpense.isPending}
            className="w-full min-h-11"
            disabled={!description.trim() || !amount || Number(amount) <= 0}
          >
            Add
          </Button>
        </form>
      )}

      {/* Expense list (filtered by the planned-vs-actual view) */}
      {expenses.length === 0 ? (
        <EmptyState
          icon={<DollarSign className="w-12 h-12" aria-hidden="true" />}
          title="No expenses yet"
          description="Track shared costs so everyone knows where they stand."
        />
      ) : visibleExpenses.length === 0 ? (
        <EmptyState
          icon={<DollarSign className="w-12 h-12" aria-hidden="true" />}
          title={view === 'planned' ? 'No planned expenses' : 'No actual expenses'}
          description={
            view === 'planned'
              ? 'Add a planned expense to start a budget for this trip.'
              : 'Nothing has been spent yet.'
          }
        />
      ) : (
        <div className="space-y-2">
          {visibleExpenses.map((e, i) => {
            const cat = CATEGORIES.find((c) => c.key === e.category) ?? CATEGORIES[CATEGORIES.length - 1]!;
            return (
              <ExpenseItem
                key={e.id}
                index={i}
                id={e.id}
                description={e.description}
                amount={e.amount}
                paidByName={e.paid_by_name}
                paidByMe={e.paid_by === currentUserId}
                splitCount={e.split_with.length}
                category={cat}
                planned={e.planned}
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
