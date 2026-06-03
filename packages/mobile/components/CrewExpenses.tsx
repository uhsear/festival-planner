import { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, Alert, Linking } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useCrewStore } from '@festie/shared/stores';
import type { CrewExpense, CrewMember, CrewSettlement } from '@festie/shared/types';
import { venmoLink, cashAppLink, payPalLink } from '@festie/shared/utils';
import { makeStyles, typeStyle, useTokens } from '../hooks/useTokens';

interface CrewExpensesProps {
  crewId: string;
  members: CrewMember[];
  currentUserId: string;
}

// Mirrors the web ExpensesTab categories (lib server enum + emoji labels).
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

function categoryFor(key: string): (typeof CATEGORIES)[number] {
  return CATEGORIES.find((c) => c.key === key) ?? CATEGORIES[CATEGORIES.length - 1]!;
}

/**
 * Crew expenses — track shared costs, view per-person balances, settle debts.
 * Mirrors the web ExpensesTab against the same endpoints, via the shared
 * crewStore actions (addExpense / removeExpense / settleExpense). The screen
 * owns the initial load.
 */
export default function CrewExpenses({ crewId, members, currentUserId }: CrewExpensesProps) {
  const t = useTokens();
  const styles = useStyles();

  const expenses = useCrewStore((s) => s.expenses);
  const balances = useCrewStore((s) => s.expenseBalances);
  const settlements = useCrewStore((s) => s.settlements);
  const addExpense = useCrewStore((s) => s.addExpense);
  const removeExpense = useCrewStore((s) => s.removeExpense);
  const settleExpense = useCrewStore((s) => s.settleExpense);

  const [showForm, setShowForm] = useState(false);
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState<string>('other');
  const [planned, setPlanned] = useState(false);
  const [splitWith, setSplitWith] = useState<string[]>(() => members.map((m) => m.userId));
  const [busy, setBusy] = useState(false);
  // Planned-vs-actual filter. 'actual' = the real ledger (feeds settle-up);
  // 'planned' = the budget/forecast view; 'all' = both.
  const [view, setView] = useState<'all' | 'actual' | 'planned'>('actual');

  const reset = () => {
    setDescription('');
    setAmount('');
    setCategory('other');
    setPlanned(false);
    setSplitWith(members.map((m) => m.userId));
    setShowForm(false);
  };

  const toggleMember = (uid: string) => {
    setSplitWith((prev) => (prev.includes(uid) ? prev.filter((id) => id !== uid) : [...prev, uid]));
  };

  const myBalance = balances.find((b) => b.userId === currentUserId)?.balance ?? 0;
  // Actual spend feeds the ledger; planned is the forecast/budget total. Keep
  // them separate so a budget row never inflates "total spent".
  const actualExpenses = expenses.filter((e) => !e.planned);
  const plannedExpenses = expenses.filter((e) => e.planned);
  const totalSpent = actualExpenses.reduce((sum, e) => sum + Number(e.amount), 0);
  const totalPlanned = plannedExpenses.reduce((sum, e) => sum + Number(e.amount), 0);
  const visibleExpenses = view === 'actual' ? actualExpenses : view === 'planned' ? plannedExpenses : expenses;
  const nonZeroBalances = balances.filter((b) => Math.abs(b.balance) > 0.01);
  // My outgoing transfers from the netted settlement plan.
  const myPayments = settlements.filter((s) => s.fromUserId === currentUserId);

  const amt = Number(amount);
  const canAdd = !!description.trim() && Number.isFinite(amt) && amt > 0 && splitWith.length > 0;

  const handleAdd = async () => {
    if (!canAdd || busy) return;
    setBusy(true);
    try {
      await addExpense(crewId, {
        description: description.trim(),
        amount: amt,
        splitWith,
        category,
        planned,
      });
      reset();
    } catch {
      // Error surfaced via the crew store.
    } finally {
      setBusy(false);
    }
  };

  const handleRemove = (expense: CrewExpense) => {
    Alert.alert('Remove expense', `Remove "${expense.description}"?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () => {
          removeExpense(crewId, expense.id).catch(() => {});
        },
      },
    ]);
  };

  // Settle the exact netted amount from the plan (NOT a Math.min heuristic).
  const handleSettle = (s: CrewSettlement) => {
    if (s.amount <= 0) return;
    Alert.alert('Settle up', `Record paying ${s.toName} $${s.amount.toFixed(2)}?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Settle',
        onPress: () => {
          settleExpense(crewId, { toUserId: s.toUserId, amount: s.amount }).catch(() => {});
        },
      },
    ]);
  };

  // Open a payment app deep link (falls back to the https URL if the app isn't
  // installed / the scheme can't be opened).
  const openPayLink = async (links: { app: string; web: string } | null) => {
    if (!links) return;
    try {
      const supported = await Linking.canOpenURL(links.app);
      await Linking.openURL(supported ? links.app : links.web);
    } catch {
      Linking.openURL(links.web).catch(() => {});
    }
  };

  return (
    <View style={styles.container}>
      {expenses.length > 0 ? (
        <View style={styles.statsGrid}>
          <View style={styles.statBox}>
            <Text style={styles.statLabel}>Total spent</Text>
            <Text style={styles.statValue}>${totalSpent.toFixed(2)}</Text>
          </View>
          <View style={styles.statBox}>
            <Text style={styles.statLabel}>Your balance</Text>
            <Text
              style={[
                styles.statValue,
                myBalance > 0.01 && styles.balancePositive,
                myBalance < -0.01 && styles.balanceNegative,
              ]}
            >
              {formatBalance(myBalance)}
            </Text>
          </View>
        </View>
      ) : null}

      {totalPlanned > 0 ? (
        <View style={styles.statBox}>
          <Text style={styles.statLabel}>Planned (budget)</Text>
          <Text style={[styles.statValue, styles.balancePositive]}>${totalPlanned.toFixed(2)}</Text>
        </View>
      ) : null}

      {expenses.length > 0 ? (
        <View style={styles.filterRow}>
          {(['actual', 'planned', 'all'] as const).map((v) => {
            const active = view === v;
            return (
              <TouchableOpacity
                key={v}
                style={[styles.filterTab, active && styles.filterTabActive]}
                onPress={() => setView(v)}
                activeOpacity={0.8}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                accessibilityLabel={`Show ${v} expenses`}
              >
                <Text style={[styles.filterTabText, active && styles.filterTabTextActive]}>
                  {v.charAt(0).toUpperCase() + v.slice(1)}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      ) : null}

      {myPayments.length > 0 ? (
        <View style={styles.ledger}>
          <Text style={styles.ledgerLabel}>Settle up</Text>
          {myPayments.map((s) => {
            const venmo = venmoLink({
              handle: s.payeeHandles.venmo,
              amountCents: s.amountCents,
              note: 'Festie settle-up',
            });
            const cashapp = cashAppLink({ handle: s.payeeHandles.cashapp, amountCents: s.amountCents });
            const paypal = payPalLink({ handle: s.payeeHandles.paypal, amountCents: s.amountCents });
            const hasLinks = !!(venmo || cashapp || paypal);
            return (
              <View key={s.toUserId} style={styles.settleGroup}>
                <View style={styles.ledgerRow}>
                  <Text style={styles.ledgerName}>
                    You pay {s.toName} <Text style={styles.balanceNegative}>${s.amount.toFixed(2)}</Text>
                  </Text>
                  <TouchableOpacity
                    style={styles.settleButton}
                    onPress={() => handleSettle(s)}
                    activeOpacity={0.8}
                    accessibilityRole="button"
                    accessibilityLabel={`Record settling up with ${s.toName}`}
                  >
                    <Ionicons name="cash-outline" size={14} color={t.colors.accent.aqua} />
                    <Text style={styles.settleButtonText}>Settle up</Text>
                  </TouchableOpacity>
                </View>
                {hasLinks ? (
                  <View style={styles.payLinkRow}>
                    {venmo ? (
                      <TouchableOpacity
                        style={styles.payLink}
                        onPress={() => void openPayLink(venmo)}
                        activeOpacity={0.8}
                        accessibilityRole="button"
                        accessibilityLabel={`Pay ${s.toName} with Venmo`}
                      >
                        <Text style={styles.payLinkText}>Venmo</Text>
                      </TouchableOpacity>
                    ) : null}
                    {cashapp ? (
                      <TouchableOpacity
                        style={styles.payLink}
                        onPress={() => void openPayLink(cashapp)}
                        activeOpacity={0.8}
                        accessibilityRole="button"
                        accessibilityLabel={`Pay ${s.toName} with Cash App`}
                      >
                        <Text style={styles.payLinkText}>Cash App</Text>
                      </TouchableOpacity>
                    ) : null}
                    {paypal ? (
                      <TouchableOpacity
                        style={styles.payLink}
                        onPress={() => void openPayLink(paypal)}
                        activeOpacity={0.8}
                        accessibilityRole="button"
                        accessibilityLabel={`Pay ${s.toName} with PayPal`}
                      >
                        <Text style={styles.payLinkText}>PayPal</Text>
                      </TouchableOpacity>
                    ) : null}
                  </View>
                ) : null}
              </View>
            );
          })}
        </View>
      ) : null}

      {nonZeroBalances.length > 0 ? (
        <View style={styles.ledger}>
          <Text style={styles.ledgerLabel}>Who owes what</Text>
          {nonZeroBalances.map((b) => (
            <View key={b.userId} style={styles.ledgerRow}>
              <Text style={styles.ledgerName}>
                {b.userId === currentUserId ? 'You' : b.username}{' '}
                <Text style={b.balance > 0 ? styles.balancePositive : styles.balanceNegative}>
                  {formatBalance(b.balance)}
                </Text>
              </Text>
            </View>
          ))}
        </View>
      ) : null}

      {showForm ? (
        <View style={styles.formBox}>
          <View style={styles.formHeader}>
            <Text style={styles.formTitle}>New expense</Text>
            <TouchableOpacity
              onPress={reset}
              style={styles.iconButton}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel="Cancel new expense"
            >
              <Ionicons name="close" size={18} color={t.colors.text.secondary} />
            </TouchableOpacity>
          </View>
          <TextInput
            style={styles.input}
            placeholder="Dinner at the food truck"
            placeholderTextColor={t.colors.text.placeholder}
            value={description}
            onChangeText={setDescription}
            maxLength={200}
            accessibilityLabel="Expense description"
          />
          <TextInput
            style={styles.input}
            placeholder="Amount (0.00)"
            placeholderTextColor={t.colors.text.placeholder}
            value={amount}
            onChangeText={setAmount}
            keyboardType="decimal-pad"
            accessibilityLabel="Expense amount"
          />
          <View style={styles.chipGrid}>
            {CATEGORIES.map((c) => {
              const active = category === c.key;
              return (
                <TouchableOpacity
                  key={c.key}
                  style={[styles.chip, active && styles.chipActive]}
                  onPress={() => setCategory(c.key)}
                  activeOpacity={0.8}
                  accessibilityRole="button"
                  accessibilityLabel={`Category ${c.label}`}
                >
                  <Text style={[styles.chipText, active && styles.chipTextActive]}>
                    {c.emoji} {c.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
          <Text style={styles.splitLabel}>Split between</Text>
          <View style={styles.chipGrid}>
            {members.map((m) => {
              const active = splitWith.includes(m.userId);
              return (
                <TouchableOpacity
                  key={m.userId}
                  style={[styles.chip, active && styles.chipActive]}
                  onPress={() => toggleMember(m.userId)}
                  activeOpacity={0.8}
                  accessibilityRole="button"
                  accessibilityLabel={`Split with ${m.name || 'member'}`}
                >
                  <Text style={[styles.chipText, active && styles.chipTextActive]}>{m.name || 'Member'}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
          {splitWith.length > 0 && amt > 0 ? (
            <Text style={styles.splitHint}>
              ${(amt / splitWith.length).toFixed(2)}/person × {splitWith.length}
            </Text>
          ) : null}
          {/* Planned = budget/forecast row. Excluded from balances + settle-up. */}
          <TouchableOpacity
            style={styles.plannedToggle}
            onPress={() => setPlanned((p) => !p)}
            activeOpacity={0.8}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: planned }}
            accessibilityLabel="Mark as a planned (budget) expense"
          >
            <Ionicons
              name={planned ? 'checkbox' : 'square-outline'}
              size={20}
              color={planned ? t.colors.accent.aqua : t.colors.text.secondary}
            />
            <Text style={styles.plannedToggleText}>
              Planned expense <Text style={styles.splitHint}>(budget only — won't affect balances)</Text>
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.primaryButton, (busy || !canAdd) && styles.buttonDisabled]}
            onPress={handleAdd}
            disabled={busy || !canAdd}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel="Add expense"
          >
            <Text style={styles.primaryButtonText}>{busy ? 'Adding…' : 'Add'}</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <TouchableOpacity
          style={styles.toggle}
          onPress={() => setShowForm(true)}
          activeOpacity={0.8}
          accessibilityRole="button"
          accessibilityLabel="Add an expense"
        >
          <Ionicons name="cash-outline" size={16} color={t.colors.accent.aqua} />
          <Text style={styles.toggleText}>Add expense</Text>
          <Ionicons name="add" size={16} color={t.colors.accent.aqua} />
        </TouchableOpacity>
      )}

      {expenses.length === 0 ? (
        <Text style={styles.empty}>No expenses yet — track shared costs so everyone knows where they stand.</Text>
      ) : visibleExpenses.length === 0 ? (
        <Text style={styles.empty}>
          {view === 'planned'
            ? 'No planned expenses — add one to start a budget for this trip.'
            : 'No actual expenses yet.'}
        </Text>
      ) : (
        visibleExpenses.map((e) => {
          const cat = categoryFor(e.category);
          const canRemove = e.paid_by === currentUserId;
          return (
            <View key={e.id} style={styles.expenseRow}>
              <Text style={styles.expenseEmoji}>{cat.emoji}</Text>
              <View style={styles.expenseInfo}>
                <View style={styles.expenseTitleRow}>
                  <Text style={styles.expenseDesc} numberOfLines={1}>
                    {e.description}
                  </Text>
                  {e.planned ? (
                    <View style={styles.plannedBadge}>
                      <Text style={styles.plannedBadgeText}>Planned</Text>
                    </View>
                  ) : null}
                </View>
                <Text style={styles.expenseMeta} numberOfLines={1}>
                  {e.planned ? 'planned' : `${e.paid_by === currentUserId ? 'You' : e.paid_by_name} paid`} · split{' '}
                  {e.split_with.length}
                </Text>
              </View>
              <Text style={styles.expenseAmount}>${Number(e.amount).toFixed(2)}</Text>
              {canRemove ? (
                <TouchableOpacity
                  onPress={() => handleRemove(e)}
                  style={styles.iconButton}
                  activeOpacity={0.7}
                  accessibilityRole="button"
                  accessibilityLabel={`Remove expense ${e.description}`}
                >
                  <Ionicons name="trash-outline" size={18} color={t.colors.text.danger} />
                </TouchableOpacity>
              ) : null}
            </View>
          );
        })
      )}
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  container: {
    gap: t.spacing[3],
  },
  statsGrid: {
    flexDirection: 'row',
    gap: t.spacing[2],
  },
  statBox: {
    flex: 1,
    padding: t.spacing[3],
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.border.default,
    backgroundColor: t.colors.bg.secondary,
    gap: t.spacing[1],
  },
  statLabel: {
    ...typeStyle('micro'),
    color: t.colors.text.muted,
    textTransform: 'uppercase',
  },
  statValue: {
    ...typeStyle('label'),
    color: t.colors.text.primary,
  },
  balancePositive: {
    color: t.colors.accent.aqua,
  },
  balanceNegative: {
    color: t.colors.accent.coral,
  },
  filterRow: {
    flexDirection: 'row',
    gap: t.spacing[1],
    padding: t.spacing[1],
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.border.default,
    backgroundColor: t.colors.bg.secondary,
  },
  filterTab: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: t.spacing[2],
    borderRadius: t.radii.default,
  },
  filterTabActive: {
    backgroundColor: t.colors.ring.aqua,
  },
  filterTabText: {
    ...typeStyle('caption'),
    color: t.colors.text.secondary,
  },
  filterTabTextActive: {
    color: t.colors.accent.aqua,
  },
  plannedToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[2],
    paddingVertical: t.spacing[1],
  },
  plannedToggleText: {
    ...typeStyle('caption'),
    color: t.colors.text.primary,
    flexShrink: 1,
  },
  expenseTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[2],
  },
  plannedBadge: {
    paddingHorizontal: t.spacing[2],
    paddingVertical: 1,
    borderRadius: t.radii.pill,
    borderWidth: 1,
    borderColor: t.colors.accent.aqua,
    backgroundColor: t.colors.ring.aqua,
  },
  plannedBadgeText: {
    ...typeStyle('micro'),
    color: t.colors.accent.aqua,
    textTransform: 'uppercase',
  },
  ledger: {
    gap: t.spacing[2],
    padding: t.spacing[3],
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.border.default,
    backgroundColor: t.colors.bg.secondary,
  },
  ledgerLabel: {
    ...typeStyle('micro'),
    color: t.colors.text.muted,
    textTransform: 'uppercase',
  },
  ledgerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: t.spacing[2],
  },
  ledgerName: {
    ...typeStyle('caption'),
    color: t.colors.text.primary,
    flexShrink: 1,
  },
  settleButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[1],
    paddingHorizontal: t.spacing[3],
    paddingVertical: t.spacing[2],
    borderRadius: t.radii.pill,
    borderWidth: 1,
    borderColor: t.colors.accent.aqua,
  },
  settleButtonText: {
    ...typeStyle('caption'),
    color: t.colors.accent.aqua,
  },
  settleGroup: {
    gap: t.spacing[2],
  },
  payLinkRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: t.spacing[2],
  },
  payLink: {
    paddingHorizontal: t.spacing[3],
    paddingVertical: t.spacing[2],
    borderRadius: t.radii.pill,
    borderWidth: 1,
    borderColor: t.colors.border.default,
    backgroundColor: t.colors.bg.input,
  },
  payLinkText: {
    ...typeStyle('caption'),
    color: t.colors.text.secondary,
  },
  toggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[2],
    paddingHorizontal: t.spacing[3],
    paddingVertical: t.spacing[3],
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.border.default,
    backgroundColor: t.colors.bg.secondary,
  },
  toggleText: {
    ...typeStyle('label'),
    color: t.colors.text.primary,
    flex: 1,
  },
  formBox: {
    gap: t.spacing[2],
    padding: t.spacing[3],
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.border.default,
    backgroundColor: t.colors.bg.secondary,
  },
  formHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  formTitle: {
    ...typeStyle('label'),
    color: t.colors.text.primary,
    flex: 1,
  },
  input: {
    backgroundColor: t.colors.bg.input,
    borderWidth: 1,
    borderColor: t.colors.border.default,
    borderRadius: t.radii.default,
    paddingHorizontal: t.spacing[4],
    paddingVertical: t.spacing[3],
    ...typeStyle('body'),
    color: t.colors.text.primary,
  },
  chipGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: t.spacing[2],
  },
  chip: {
    paddingHorizontal: t.spacing[3],
    paddingVertical: t.spacing[2],
    borderRadius: t.radii.pill,
    borderWidth: 1,
    borderColor: t.colors.border.default,
    backgroundColor: t.colors.bg.input,
  },
  chipActive: {
    borderColor: t.colors.accent.aqua,
    backgroundColor: t.colors.ring.aqua,
  },
  chipText: {
    ...typeStyle('caption'),
    color: t.colors.text.secondary,
  },
  chipTextActive: {
    color: t.colors.accent.aqua,
  },
  splitLabel: {
    ...typeStyle('caption'),
    color: t.colors.text.primary,
  },
  splitHint: {
    ...typeStyle('micro'),
    color: t.colors.text.muted,
  },
  primaryButton: {
    backgroundColor: t.colors.accent.coral,
    borderRadius: t.radii.default,
    paddingVertical: t.spacing[3],
    alignItems: 'center',
  },
  primaryButtonText: {
    ...typeStyle('label'),
    color: t.colors.text.onAccent,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  iconButton: {
    padding: t.spacing[1],
  },
  empty: {
    ...typeStyle('caption'),
    color: t.colors.text.muted,
    paddingHorizontal: t.spacing[2],
  },
  expenseRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[3],
    paddingHorizontal: t.spacing[3],
    paddingVertical: t.spacing[3],
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.border.light,
    backgroundColor: t.colors.bg.secondary,
  },
  expenseEmoji: {
    ...typeStyle('body'),
  },
  expenseInfo: {
    flex: 1,
    gap: t.spacing[1],
  },
  expenseDesc: {
    ...typeStyle('label'),
    color: t.colors.text.primary,
  },
  expenseMeta: {
    ...typeStyle('caption'),
    color: t.colors.text.secondary,
  },
  expenseAmount: {
    ...typeStyle('label'),
    color: t.colors.text.primary,
  },
}));
