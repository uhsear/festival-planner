import type { CrewExpense, CrewExpenseBalance, CrewSettlement } from '@festie/shared/types';
import {
  sanitizeAmountInput,
  canAddExpense,
  isAmountInvalid,
  actualExpenses,
  plannedExpenses,
  sumExpenseAmounts,
  visibleExpenses,
  nonZeroBalances,
  myBalance,
  myPayments,
  myReceipts,
} from './expenseView';

// Minimal CrewExpense factory — only the fields the view logic reads matter.
function expense(over: Partial<CrewExpense>): CrewExpense {
  return {
    id: 'e1',
    crew_id: 'c1',
    paid_by: 'u1',
    paid_by_name: 'Alice',
    description: 'thing',
    amount: 10,
    split_with: ['u1', 'u2'],
    category: 'other',
    created_at: '2026-01-01T00:00:00Z',
    ...over,
  };
}

function balance(userId: string, bal: number, username = userId): CrewExpenseBalance {
  return { userId, username, balance: bal };
}

function settlement(over: Partial<CrewSettlement>): CrewSettlement {
  return {
    fromUserId: 'u1',
    fromName: 'Alice',
    toUserId: 'u2',
    toName: 'Bob',
    amountCents: 1000,
    amount: 10,
    payeeHandles: { venmo: null, cashapp: null, paypal: null },
    ...over,
  };
}

describe('sanitizeAmountInput', () => {
  it("strips a leading minus so '-5' becomes empty", () => {
    expect(sanitizeAmountInput('-5')).toBe('5');
  });
  it("yields '' when nothing but a minus is typed", () => {
    expect(sanitizeAmountInput('-')).toBe('');
  });
  it("caps '12.999' to two decimals → '12.99'", () => {
    expect(sanitizeAmountInput('12.999')).toBe('12.99');
  });
  it("drops non-numeric: 'abc' → ''", () => {
    expect(sanitizeAmountInput('abc')).toBe('');
  });
  it('keeps a clean integer and a clean 2dp value', () => {
    expect(sanitizeAmountInput('15')).toBe('15');
    expect(sanitizeAmountInput('15.40')).toBe('15.40');
  });
  it('allows an empty string so the field can be cleared', () => {
    expect(sanitizeAmountInput('')).toBe('');
  });
  it('strips embedded letters, keeping the leading digits', () => {
    expect(sanitizeAmountInput('12a3')).toBe('123');
  });
  it('keeps only the first decimal point group', () => {
    // Second '.' is not allowed by the ^\d*(\.\d{0,2})? anchor.
    expect(sanitizeAmountInput('1.2.3')).toBe('1.2');
  });
});

describe('canAddExpense', () => {
  it('true with description, positive amount, and a split target', () => {
    expect(canAddExpense('dinner', 12, 2)).toBe(true);
  });
  it('false on a blank/whitespace description', () => {
    expect(canAddExpense('   ', 12, 2)).toBe(false);
  });
  it('false on zero or negative amount', () => {
    expect(canAddExpense('dinner', 0, 2)).toBe(false);
    expect(canAddExpense('dinner', -5, 2)).toBe(false);
  });
  it('false on NaN amount', () => {
    expect(canAddExpense('dinner', NaN, 2)).toBe(false);
  });
  it('false when no one is in the split', () => {
    expect(canAddExpense('dinner', 12, 0)).toBe(false);
  });
});

describe('isAmountInvalid', () => {
  it('false when nothing typed yet', () => {
    expect(isAmountInvalid('', NaN)).toBe(false);
  });
  it('true when text is present but not a positive number', () => {
    expect(isAmountInvalid('.', NaN)).toBe(true);
    expect(isAmountInvalid('0', 0)).toBe(true);
  });
  it('false when text resolves to a positive number', () => {
    expect(isAmountInvalid('12.50', 12.5)).toBe(false);
  });
});

describe('actual / planned partition', () => {
  const list = [
    expense({ id: 'a', planned: false }),
    expense({ id: 'b', planned: true }),
    expense({ id: 'c' }), // legacy row: no planned flag → actual
  ];
  it('actualExpenses excludes planned rows (legacy/undefined counts as actual)', () => {
    expect(actualExpenses(list).map((e) => e.id)).toEqual(['a', 'c']);
  });
  it('plannedExpenses returns only planned rows', () => {
    expect(plannedExpenses(list).map((e) => e.id)).toEqual(['b']);
  });
});

describe('sumExpenseAmounts', () => {
  it('sums numeric amounts', () => {
    expect(sumExpenseAmounts([expense({ amount: 10 }), expense({ amount: 5.5 })])).toBe(15.5);
  });
  it('coerces string amounts (API can send strings)', () => {
    expect(sumExpenseAmounts([expense({ amount: '12.99' }), expense({ amount: '7.01' })])).toBe(20);
  });
  it('is 0 for an empty list', () => {
    expect(sumExpenseAmounts([])).toBe(0);
  });
});

describe('visibleExpenses', () => {
  const list = [expense({ id: 'a', planned: false }), expense({ id: 'b', planned: true })];
  it("'actual' → actual rows only", () => {
    expect(visibleExpenses(list, 'actual').map((e) => e.id)).toEqual(['a']);
  });
  it("'planned' → planned rows only", () => {
    expect(visibleExpenses(list, 'planned').map((e) => e.id)).toEqual(['b']);
  });
  it("'all' → the original list", () => {
    expect(visibleExpenses(list, 'all')).toBe(list);
  });
});

describe('nonZeroBalances (0.01 epsilon)', () => {
  it('keeps balances whose magnitude exceeds the cent epsilon', () => {
    const bals = [balance('u1', 5), balance('u2', -3.5)];
    expect(nonZeroBalances(bals).map((b) => b.userId)).toEqual(['u1', 'u2']);
  });
  it('drops a balance exactly at the epsilon (0.01 is not > 0.01)', () => {
    expect(nonZeroBalances([balance('u1', 0.01), balance('u2', -0.01)])).toEqual([]);
  });
  it('drops sub-cent rounding crumbs', () => {
    expect(nonZeroBalances([balance('u1', 0.004), balance('u2', 0)])).toEqual([]);
  });
  it('keeps a balance just past the epsilon', () => {
    expect(nonZeroBalances([balance('u1', 0.02)]).map((b) => b.userId)).toEqual(['u1']);
  });
});

describe('myBalance', () => {
  it("returns the current user's balance", () => {
    expect(myBalance([balance('u1', 5), balance('u2', -5)], 'u2')).toBe(-5);
  });
  it('returns 0 when the user has no balance row', () => {
    expect(myBalance([balance('u1', 5)], 'u-absent')).toBe(0);
  });
});

describe('myPayments / myReceipts partition by currentUserId', () => {
  const settlements = [
    settlement({ fromUserId: 'me', toUserId: 'a' }), // I pay a
    settlement({ fromUserId: 'b', toUserId: 'me' }), // b pays me
    settlement({ fromUserId: 'c', toUserId: 'd' }), // unrelated
  ];
  it('myPayments = settlements where I am the payer', () => {
    expect(myPayments(settlements, 'me').map((s) => s.toUserId)).toEqual(['a']);
  });
  it('myReceipts = settlements where I am the payee', () => {
    expect(myReceipts(settlements, 'me').map((s) => s.fromUserId)).toEqual(['b']);
  });
  it('a user not in any settlement gets empty partitions', () => {
    expect(myPayments(settlements, 'zzz')).toEqual([]);
    expect(myReceipts(settlements, 'zzz')).toEqual([]);
  });
});
