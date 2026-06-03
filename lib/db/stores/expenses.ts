import { randomUUID } from 'crypto';
import type { Pool } from 'pg';

/**
 * A single member's net position in a crew ledger, in integer cents.
 *   balanceCents > 0  → the crew owes them (creditor)
 *   balanceCents < 0  → they owe the crew (debtor)
 */
export interface BalanceCents {
  userId: string;
  username: string;
  balanceCents: number;
}

/**
 * A directed transfer that settles part of the ledger: `from` pays `to`.
 * Amount is always positive integer cents.
 */
export interface Settlement {
  fromUserId: string;
  fromName: string;
  toUserId: string;
  toName: string;
  amountCents: number;
}

/**
 * Greedy min-cash-flow debt simplification, entirely in INTEGER CENTS.
 *
 * Splits members into creditors (owed money) and debtors (owe money), then
 * repeatedly matches the largest creditor against the largest debtor, emitting
 * a transfer for the smaller of the two magnitudes. This yields at most N-1
 * transfers for N non-zero members and never invents a stray penny: every
 * transfer reduces both sides by the same amount, so the ledger stays zero-sum.
 *
 * Pure function — no DB, no floats. `balances` is expected to be (near) zero-sum
 * (getBalances guarantees this); any residual ≤ ±1 cent is ignored.
 */
export function simplifyDebts(balances: BalanceCents[]): Settlement[] {
  // Sort largest-magnitude first so we knock out the biggest imbalances early.
  const creditors = balances
    .filter((b) => b.balanceCents > 0)
    .map((b) => ({ ...b, remaining: b.balanceCents }))
    .sort((a, b) => b.remaining - a.remaining);
  const debtors = balances
    .filter((b) => b.balanceCents < 0)
    .map((b) => ({ ...b, remaining: -b.balanceCents }))
    .sort((a, b) => b.remaining - a.remaining);

  const settlements: Settlement[] = [];
  let ci = 0;
  let di = 0;
  while (ci < creditors.length && di < debtors.length) {
    const creditor = creditors[ci]!;
    const debtor = debtors[di]!;
    const amountCents = Math.min(creditor.remaining, debtor.remaining);

    // Only emit a transfer worth more than a rounding penny. A sub-2-cent
    // residual is a zero-sum rounding artifact, not a real debt.
    if (amountCents > 1) {
      settlements.push({
        fromUserId: debtor.userId,
        fromName: debtor.username,
        toUserId: creditor.userId,
        toName: creditor.username,
        amountCents,
      });
    }

    creditor.remaining -= amountCents;
    debtor.remaining -= amountCents;
    if (creditor.remaining <= 1) ci++;
    if (debtor.remaining <= 1) di++;
  }

  return settlements;
}

export function createExpensesStore(pool: Pool) {
  return {
    async create({ crewId, paidBy, description, amount, splitWith, category = 'other' }: any) {
      const id = randomUUID();
      const splitJson = JSON.stringify(splitWith || []);
      const { rows } = await pool.query(
        `INSERT INTO crew_expenses (id, crew_id, paid_by, description, amount, split_with, category, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
         RETURNING id, crew_id, paid_by, description, amount, split_with, category, created_at`,
        [id, crewId, paidBy, description, amount, splitJson, category],
      );
      return rows[0];
    },

    async getByCrew(crewId: string) {
      const { rows } = await pool.query(
        `
  SELECT
    e.id,
    e.crew_id,
    e.paid_by,
    e.description,
    e.amount,
    e.split_with,
    e.category,
    e.created_at,
    u.username as paid_by_name
  FROM
    crew_expenses e
    JOIN users u ON u.id = e.paid_by
    AND u.deleted_at IS NULL
  WHERE
    e.crew_id = $1
  ORDER BY
    e.created_at DESC
`,
        [crewId],
      );
      return rows.map((r: any) => {
        let splitWith = r.split_with || [];
        if (typeof r.split_with === 'string') {
          try {
            splitWith = JSON.parse(r.split_with);
          } catch {
            splitWith = [];
          }
        }
        return { ...r, split_with: splitWith };
      });
    },

    async getById(expenseId: string) {
      const { rows } = await pool.query(
        `
  SELECT
    id,
    crew_id,
    paid_by,
    description,
    amount,
    split_with,
    category,
    created_at
  FROM
    crew_expenses
  WHERE
    id = $1
`,
        [expenseId],
      );
      return rows[0] || null;
    },

    async delete(expenseId: string) {
      await pool.query('DELETE FROM crew_expenses WHERE id = $1', [expenseId]);
    },

    // Compute each member's net position in INTEGER CENTS. This is the
    // single source of truth for the ledger; getBalances (dollars) and
    // getBalancesCents (raw cents, for simplifyDebts) both derive from it.
    async computeBalanceCents(crewId: string): Promise<BalanceCents[]> {
      // Get all expenses for the crew
      const { rows: expenses } = await pool.query(
        `
  SELECT
    id,
    crew_id,
    paid_by,
    description,
    amount,
    split_with,
    category,
    created_at
  FROM
    crew_expenses
  WHERE
    crew_id = $1
`,
        [crewId],
      );
      // Get all crew members
      const { rows: members } = await pool.query(
        `
  SELECT
    cm.user_id,
    u.username
  FROM
    crew_members cm
    JOIN users u ON u.id = cm.user_id
    AND u.deleted_at IS NULL
  WHERE
    cm.crew_id = $1
`,
        [crewId],
      );

      const memberIds = members.map((m: any) => m.user_id);
      const nameMap: Record<string, string> = Object.fromEntries(members.map((m: any) => [m.user_id, m.username]));
      // Work in integer cents to avoid float drift and guarantee a zero-sum
      // ledger. node-postgres returns NUMERIC as a JS string, so amounts must be
      // coerced with Number() — `+=` on the raw value would string-concatenate.
      const cents: Record<string, number> = {};
      memberIds.forEach((id: string) => {
        cents[id] = 0;
      });

      for (const exp of expenses) {
        let splitWith = exp.split_with || [];
        if (typeof exp.split_with === 'string') {
          try {
            splitWith = JSON.parse(exp.split_with);
          } catch {
            splitWith = [];
          }
        }
        // Split among the named members (empty = whole crew); drop any id that
        // is no longer a current member so removed members can't leave the
        // ledger non-zero-sum — their share redistributes across the rest.
        const splitMembers = (splitWith.length > 0 ? splitWith : memberIds).filter(
          (uid: string) => cents[uid] !== undefined,
        );
        const shareCount = splitMembers.length;
        if (shareCount === 0) continue;

        const amountCents = Math.round(Number(exp.amount) * 100);
        if (!Number.isFinite(amountCents)) continue;

        // Payer fronted the whole amount.
        const payerBal = cents[exp.paid_by];
        if (payerBal !== undefined) cents[exp.paid_by] = payerBal + amountCents;

        // Each member owes an equal share; spread the leftover pennies one each
        // across the first `remainder` members so the shares sum to the total.
        const baseShare = Math.floor(amountCents / shareCount);
        let remainder = amountCents - baseShare * shareCount;
        splitMembers.forEach((uid: string) => {
          const cur = cents[uid];
          if (cur === undefined) return;
          const owed = baseShare + (remainder > 0 ? 1 : 0);
          if (remainder > 0) remainder -= 1;
          cents[uid] = cur - owed;
        });
      }

      return memberIds.map((id: string) => ({
        userId: id,
        username: nameMap[id] ?? id,
        balanceCents: cents[id] ?? 0,
      }));
    },

    // Dollars projection — the existing public contract (balance: number).
    async getBalances(crewId: string) {
      const cents = await this.computeBalanceCents(crewId);
      return cents.map((b) => ({
        userId: b.userId,
        username: b.username,
        balance: b.balanceCents / 100,
      }));
    },

    // Raw cents projection — feeds simplifyDebts for the settlement plan.
    async getBalancesCents(crewId: string): Promise<BalanceCents[]> {
      return this.computeBalanceCents(crewId);
    },
  };
}
