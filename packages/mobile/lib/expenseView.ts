import type { CrewExpense, CrewExpenseBalance, CrewSettlement } from '@festie/shared/types';

/**
 * Mobile-local view logic for CrewExpenses — the small pure transforms the
 * component derives from store state on every render. Money formatting lives in
 * `@festie/shared/utils` (formatAmount/formatBalance) and is NOT duplicated
 * here; this module only owns the mobile screen's input-sanitisation, the
 * add-form gate, the planned/actual totals, the per-user settlement partition,
 * and the non-zero-balance filter. Kept pure + side-effect free so it can be
 * unit-tested without rendering the screen.
 */

/**
 * Sanitise a raw text-input value into a money string. Rejects negatives /
 * non-numeric and caps to a single decimal point with at most 2 places. Mirrors
 * the web form's `<input type="number" min="0.01">` guard so a minus sign
 * (present on some Android decimal-pads) or pasted text can't enter a
 * credit-flow amount. An empty string stays allowed so the field can be cleared.
 *
 *   '-5'      → ''      (leading '-' stripped, then no digit before it survives)
 *   '12.999'  → '12.99' (capped to 2 decimal places)
 *   'abc'     → ''      (non-numeric stripped)
 */
export function sanitizeAmountInput(next: string): string {
  const cleaned = next.replace(/[^0-9.]/g, '');
  const match = cleaned.match(/^\d*(\.\d{0,2})?/);
  return match ? match[0] : '';
}

/**
 * Whether the add-expense form can be submitted: a non-blank description, a
 * finite positive amount, and at least one split target.
 */
export function canAddExpense(description: string, amount: number, splitWithCount: number): boolean {
  return !!description.trim() && Number.isFinite(amount) && amount > 0 && splitWithCount > 0;
}

/**
 * Inline-validation flag: an amount was typed but it isn't a usable positive
 * number. (decimal-pad can still surface '-', '..', or trailing dots on some
 * devices, so this stays separate from the sanitiser.)
 */
export function isAmountInvalid(rawAmount: string, parsedAmount: number): boolean {
  return rawAmount.trim().length > 0 && !(Number.isFinite(parsedAmount) && parsedAmount > 0);
}

/** Actual spend feeds the ledger; planned is the forecast/budget total. */
export function actualExpenses(expenses: CrewExpense[]): CrewExpense[] {
  return expenses.filter((e) => !e.planned);
}

export function plannedExpenses(expenses: CrewExpense[]): CrewExpense[] {
  return expenses.filter((e) => e.planned);
}

/** Sum of a list of expenses' amounts (amount may arrive as a string). */
export function sumExpenseAmounts(expenses: CrewExpense[]): number {
  return expenses.reduce((sum, e) => sum + Number(e.amount), 0);
}

/**
 * The list shown under the active filter tab:
 *   'actual'  → real ledger rows
 *   'planned' → budget/forecast rows
 *   'all'     → everything
 */
export function visibleExpenses(expenses: CrewExpense[], view: 'all' | 'actual' | 'planned'): CrewExpense[] {
  if (view === 'actual') return actualExpenses(expenses);
  if (view === 'planned') return plannedExpenses(expenses);
  return expenses;
}

/**
 * Balances that aren't effectively zero. Uses a 0.01 epsilon so a rounding
 * crumb (a fraction of a cent) never surfaces a phantom "owes" line.
 */
export function nonZeroBalances(balances: CrewExpenseBalance[]): CrewExpenseBalance[] {
  return balances.filter((b) => Math.abs(b.balance) > 0.01);
}

/** The current user's net balance, or 0 when they have no balance row. */
export function myBalance(balances: CrewExpenseBalance[], currentUserId: string): number {
  return balances.find((b) => b.userId === currentUserId)?.balance ?? 0;
}

/**
 * Settlements where the current user is the payer — "You owe {toName} ${amt}"
 * (settle-able by me).
 */
export function myPayments(settlements: CrewSettlement[], currentUserId: string): CrewSettlement[] {
  return settlements.filter((s) => s.fromUserId === currentUserId);
}

/**
 * Settlements where the current user is the payee — "{fromName} owes you ${amt}"
 * (the other person settles; read-only here).
 */
export function myReceipts(settlements: CrewSettlement[], currentUserId: string): CrewSettlement[] {
  return settlements.filter((s) => s.toUserId === currentUserId);
}
