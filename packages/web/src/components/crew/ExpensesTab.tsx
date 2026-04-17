import React, { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@festie/shared';
import { Expense, CrewMember } from '@festie/shared/types';
import { useToast } from '../../lib/toastContext';
import { cn } from '@/lib/utils';
import Button from '../ui/Button';
import Input from '../ui/Input';
import Avatar from '../ui/Avatar';
import EmptyState from '../ui/EmptyState';
import Skeleton from '../ui/Skeleton';
import {
  DollarSign,
  Plus,
  Trash2,
  HandCoins,
  ChevronDown,
  ChevronUp,
  X,
  Users,
} from 'lucide-react';

interface ExpensesTabProps {
  crewId: string;
  members: CrewMember[];
  currentUserId: string;
}

type SplitMode = 'equal' | 'custom';

interface BalanceEntry {
  memberId: string;
  name: string;
  balance: number;
}

function computeBalances(expenses: Expense[], members: CrewMember[]): BalanceEntry[] {
  const balanceMap: Record<string, number> = {};
  const nameMap: Record<string, string> = {};

  for (const m of members) {
    balanceMap[m.userId] = 0;
    nameMap[m.userId] = m.name || 'User';
  }

  for (const exp of expenses) {
    const splitCount = exp.sharedWith.length || 1;
    const perPerson = exp.amount / splitCount;

    // Payer is owed money
    if (balanceMap[exp.paidBy] !== undefined) {
      balanceMap[exp.paidBy] += exp.amount - perPerson;
    }

    // Each person who shares owes their portion
    for (const uid of exp.sharedWith) {
      if (uid !== exp.paidBy && balanceMap[uid] !== undefined) {
        balanceMap[uid] -= perPerson;
      }
    }
  }

  return Object.entries(balanceMap).map(([memberId, balance]) => ({
    memberId,
    name: nameMap[memberId] || 'User',
    balance,
  }));
}

export default function ExpensesTab({ crewId, members, currentUserId }: ExpensesTabProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Form state
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [paidBy, setPaidBy] = useState(currentUserId);
  const [splitMode, setSplitMode] = useState<SplitMode>('equal');
  const [selectedMembers, setSelectedMembers] = useState<string[]>(() =>
    members.map((m) => m.userId),
  );

  const {
    data: expenses = [],
    isLoading,
    isError,
  } = useQuery<Expense[]>({
    queryKey: ['expenses', crewId],
    queryFn: () => api.get<Expense[]>(`/api/v1/expenses/${crewId}`),
    enabled: !!crewId,
  });

  const addExpense = useMutation({
    mutationFn: (newExpense: {
      description: string;
      amount: number;
      paidBy: string;
      sharedWith: string[];
    }) => api.post(`/api/v1/expenses/${crewId}`, newExpense),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['expenses', crewId] });
      toast('Expense added', 'success');
      resetForm();
    },
    onError: () => {
      toast("Couldn't add expense. Try again.", 'error');
    },
  });

  const deleteExpense = useMutation({
    mutationFn: (expenseId: string) =>
      api.delete(`/api/v1/expenses/${crewId}/${expenseId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['expenses', crewId] });
      toast('Expense removed', 'success');
    },
    onError: () => {
      toast("Couldn't delete expense. Try again.", 'error');
    },
  });

  const settleUp = useMutation({
    mutationFn: () => api.post(`/api/v1/expenses/${crewId}/settle`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['expenses', crewId] });
      toast('All settled up!', 'success');
    },
    onError: () => {
      toast("Couldn't settle up. Try again.", 'error');
    },
  });

  const balances = useMemo(() => computeBalances(expenses, members), [expenses, members]);
  const totalSpent = useMemo(
    () => expenses.reduce((sum, e) => sum + e.amount, 0),
    [expenses],
  );

  function resetForm() {
    setDescription('');
    setAmount('');
    setPaidBy(currentUserId);
    setSplitMode('equal');
    setSelectedMembers(members.map((m) => m.userId));
    setShowForm(false);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const parsedAmount = parseFloat(amount);
    if (!description.trim() || isNaN(parsedAmount) || parsedAmount <= 0) return;
    if (selectedMembers.length === 0) return;

    addExpense.mutate({
      description: description.trim(),
      amount: parsedAmount,
      paidBy,
      sharedWith: splitMode === 'equal' ? members.map((m) => m.userId) : selectedMembers,
    });
  }

  function toggleMemberSelection(userId: string) {
    setSelectedMembers((prev) =>
      prev.includes(userId) ? prev.filter((id) => id !== userId) : [...prev, userId],
    );
  }

  function getMemberName(userId: string): string {
    return members.find((m) => m.userId === userId)?.name || 'User';
  }

  if (isLoading) {
    return (
      <div className="space-y-3 px-4">
        <Skeleton variant="card" />
        <Skeleton variant="card" />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="px-4">
        <EmptyState
          icon={<DollarSign className="w-12 h-12" />}
          title="Couldn't load expenses"
          description="Try again later."
        />
      </div>
    );
  }

  return (
    <div className="space-y-4 px-4">
      {/* Balance summary */}
      {expenses.length > 0 && (
        <div className="p-4 rounded-lg bg-bg-card border border-border">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-text-primary flex items-center gap-2">
              <Users className="w-4 h-4" />
              Balances
            </h3>
            <span className="text-sm text-text-secondary">
              Total: ${totalSpent.toFixed(2)}
            </span>
          </div>

          <div className="space-y-2">
            {balances.map((entry) => (
              <div
                key={entry.memberId}
                className="flex items-center justify-between py-1"
              >
                <div className="flex items-center gap-2">
                  <Avatar name={entry.name} size="xs" />
                  <span className="text-sm text-text-primary">{entry.name}</span>
                </div>
                <span
                  className={cn(
                    'text-sm font-medium',
                    entry.balance > 0.01
                      ? 'text-accent-green'
                      : entry.balance < -0.01
                        ? 'text-accent-coral'
                        : 'text-text-muted',
                  )}
                >
                  {entry.balance > 0.01
                    ? `+$${entry.balance.toFixed(2)}`
                    : entry.balance < -0.01
                      ? `-$${Math.abs(entry.balance).toFixed(2)}`
                      : '$0.00'}
                </span>
              </div>
            ))}
          </div>

          <Button
            variant="outline"
            size="sm"
            onClick={() => settleUp.mutate()}
            isLoading={settleUp.isPending}
            className="w-full mt-3 min-h-11"
          >
            <HandCoins className="w-4 h-4" />
            Settle Up
          </Button>
        </div>
      )}

      {/* Add expense button / form */}
      {!showForm ? (
        <Button
          variant="primary"
          onClick={() => setShowForm(true)}
          className="w-full min-h-11"
        >
          <Plus className="w-4 h-4" />
          Add Expense
        </Button>
      ) : (
        <form
          onSubmit={handleSubmit}
          className="p-4 rounded-lg bg-bg-card border border-border space-y-3"
        >
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-text-primary">New Expense</h3>
            <button
              type="button"
              onClick={resetForm}
              className="min-h-11 min-w-11 flex items-center justify-center text-text-muted hover:text-text-primary transition-colors"
              aria-label="Cancel"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <Input
            label="Description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What was this for?"
            required
          />

          <Input
            label="Amount"
            type="number"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.00"
            min="0.01"
            step="0.01"
            required
          />

          {/* Paid by */}
          <div>
            <label className="block text-sm font-medium text-text-primary mb-2">
              Paid by
            </label>
            <select
              value={paidBy}
              onChange={(e) => setPaidBy(e.target.value)}
              className="input-base w-full min-h-11"
            >
              {members.map((m) => (
                <option key={m.userId} value={m.userId}>
                  {m.name || 'User'}
                </option>
              ))}
            </select>
          </div>

          {/* Split mode */}
          <div>
            <label className="block text-sm font-medium text-text-primary mb-2">
              Split
            </label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => {
                  setSplitMode('equal');
                  setSelectedMembers(members.map((m) => m.userId));
                }}
                className={cn(
                  'flex-1 min-h-11 rounded-lg text-sm font-medium transition-colors border',
                  splitMode === 'equal'
                    ? 'bg-accent-aqua text-bg-primary border-accent-aqua'
                    : 'bg-transparent text-text-secondary border-border hover:border-border-light',
                )}
              >
                Equal
              </button>
              <button
                type="button"
                onClick={() => setSplitMode('custom')}
                className={cn(
                  'flex-1 min-h-11 rounded-lg text-sm font-medium transition-colors border',
                  splitMode === 'custom'
                    ? 'bg-accent-aqua text-bg-primary border-accent-aqua'
                    : 'bg-transparent text-text-secondary border-border hover:border-border-light',
                )}
              >
                Custom
              </button>
            </div>
          </div>

          {/* Custom member picker */}
          {splitMode === 'custom' && (
            <div className="space-y-1">
              <label className="block text-sm font-medium text-text-primary mb-1">
                Split between
              </label>
              {members.map((m) => (
                <button
                  key={m.userId}
                  type="button"
                  onClick={() => toggleMemberSelection(m.userId)}
                  className={cn(
                    'w-full min-h-11 flex items-center gap-3 px-3 rounded-lg transition-colors border',
                    selectedMembers.includes(m.userId)
                      ? 'bg-accent-aqua bg-opacity-10 border-accent-aqua border-opacity-40'
                      : 'bg-transparent border-border hover:border-border-light',
                  )}
                >
                  <Avatar name={m.name || 'User'} size="xs" />
                  <span className="text-sm text-text-primary">{m.name || 'User'}</span>
                </button>
              ))}
            </div>
          )}

          <Button
            type="submit"
            variant="primary"
            isLoading={addExpense.isPending}
            className="w-full min-h-11"
            disabled={!description.trim() || !amount || selectedMembers.length === 0}
          >
            Add Expense
          </Button>
        </form>
      )}

      {/* Expense list */}
      {expenses.length === 0 ? (
        <EmptyState
          icon={<DollarSign className="w-12 h-12" />}
          title="No expenses yet"
          description="Add an expense to start tracking who owes what"
        />
      ) : (
        <div className="space-y-2">
          {expenses.map((expense) => {
            const isExpanded = expandedId === expense.id;
            const perPerson =
              expense.sharedWith.length > 0
                ? expense.amount / expense.sharedWith.length
                : expense.amount;

            return (
              <div
                key={expense.id}
                className="rounded-lg bg-bg-card border border-border overflow-hidden"
              >
                <button
                  onClick={() => setExpandedId(isExpanded ? null : expense.id)}
                  className="w-full min-h-11 p-3 flex items-center justify-between text-left"
                >
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-text-primary truncate">
                      {expense.description}
                    </div>
                    <div className="text-xs text-text-secondary mt-0.5">
                      {getMemberName(expense.paidBy)} paid
                    </div>
                  </div>

                  <div className="flex items-center gap-2 flex-shrink-0 ml-3">
                    <span className="font-semibold text-text-primary">
                      ${expense.amount.toFixed(2)}
                    </span>
                    {isExpanded ? (
                      <ChevronUp className="w-4 h-4 text-text-muted" />
                    ) : (
                      <ChevronDown className="w-4 h-4 text-text-muted" />
                    )}
                  </div>
                </button>

                {isExpanded && (
                  <div className="px-3 pb-3 border-t border-border pt-3 space-y-2">
                    <div className="text-xs text-text-muted">
                      ${perPerson.toFixed(2)} per person
                    </div>

                    <div className="flex flex-wrap gap-1">
                      {expense.sharedWith.map((uid) => (
                        <span
                          key={uid}
                          className="text-xs px-2 py-0.5 rounded-full bg-bg-primary border border-border text-text-secondary"
                        >
                          {getMemberName(uid)}
                        </span>
                      ))}
                    </div>

                    <div className="text-xs text-text-muted">
                      {new Date(expense.createdAt).toLocaleDateString()}
                    </div>

                    <button
                      onClick={() => deleteExpense.mutate(expense.id)}
                      disabled={deleteExpense.isPending}
                      className="min-h-11 min-w-11 flex items-center gap-2 text-sm text-accent-coral hover:opacity-80 transition-opacity"
                      aria-label="Delete expense"
                    >
                      <Trash2 className="w-4 h-4" />
                      Delete
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
