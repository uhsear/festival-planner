import { Router } from 'express';

import { simplifyDebts } from '../lib/db/stores/expenses.js';

export default function createExpenseRoutes(deps: any) {
  const router = Router();
  const {
    stores,
    userAuth,
    sendSuccess,
    sendError,
    ErrorCodes,
    log,
    rateLimit,
    emitter,
    sanitizeIdentifier,
    schemas,
    validate,
    validateParams,
  } = deps;

  // GET /crew/:crewId/expenses
  router.get(
    '/crews/:crewId/expenses',
    userAuth,
    rateLimit(120, 'expense-list'),
    validateParams(schemas.crewIdParams),
    async (req: any, res: any) => {
      try {
        const crewId = sanitizeIdentifier(req.validatedParams.crewId);
        const member = await stores.crews.getMember(crewId, req.user.userId);
        if (!member) return sendError(res, 403, 'Not a crew member', ErrorCodes.FORBIDDEN);
        const expenses = await stores.expenses.getByCrew(crewId);
        return sendSuccess(res, expenses);
      } catch (err: any) {
        log.error('get expenses failed', { error: err.message });
        return sendError(res, 500, 'Failed to load expenses', ErrorCodes.INTERNAL_ERROR);
      }
    },
  );

  // POST /crew/:crewId/expenses
  router.post(
    '/crews/:crewId/expenses',
    userAuth,
    rateLimit(30, 'expense-create'),
    validateParams(schemas.crewIdParams),
    validate(schemas.expenseCreate),
    async (req: any, res: any) => {
      try {
        const crewId = sanitizeIdentifier(req.validatedParams.crewId);
        const member = await stores.crews.getMember(crewId, req.user.userId);
        if (!member) return sendError(res, 403, 'Not a crew member', ErrorCodes.FORBIDDEN);

        const { description, amount, splitWith, category } = req.validatedBody;

        // Every split target must be a current crew member, with no duplicates —
        // otherwise a non-member's share is counted but never owed, leaving the
        // ledger non-zero-sum.
        const memberIds = new Set((await stores.crews.getMembers(crewId)).map((m: any) => m.userId));
        if (new Set(splitWith).size !== splitWith.length) {
          return sendError(res, 400, 'splitWith contains duplicate users', ErrorCodes.INVALID_INPUT);
        }
        if (splitWith.some((id: string) => !memberIds.has(id))) {
          return sendError(res, 400, 'splitWith includes users who are not crew members', ErrorCodes.INVALID_INPUT);
        }

        const expense = await stores.expenses.create({
          crewId,
          paidBy: req.user.userId,
          description: description.trim().slice(0, 200),
          amount: Math.round(amount * 100) / 100,
          splitWith,
          category: category || 'other',
        });

        emitter.crewExpenseAdded({ crewId, expense });
        await stores.activity
          .log({
            crewId,
            userId: req.user.userId,
            type: 'expense-added',
            detail: `${expense.description} $${expense.amount}`,
          })
          .catch(() => {});
        res.status(201);
        return sendSuccess(res, expense);
      } catch (err: any) {
        log.error('create expense failed', { error: err.message });
        return sendError(res, 500, 'Failed to create expense', ErrorCodes.INTERNAL_ERROR);
      }
    },
  );

  // DELETE /crew/:crewId/expenses/:expenseId
  router.delete(
    '/crews/:crewId/expenses/:expenseId',
    userAuth,
    rateLimit(30, 'expense-delete'),
    validateParams(schemas.crewIdExpenseIdParams),
    async (req: any, res: any) => {
      try {
        const crewId = sanitizeIdentifier(req.validatedParams.crewId);
        const expenseId = sanitizeIdentifier(req.validatedParams.expenseId);
        const member = await stores.crews.getMember(crewId, req.user.userId);
        if (!member) return sendError(res, 403, 'Not a crew member', ErrorCodes.FORBIDDEN);

        const expense = await stores.expenses.getById(expenseId);
        if (!expense || expense.crew_id !== crewId)
          return sendError(res, 404, 'Expense not found', ErrorCodes.NOT_FOUND);
        if (expense.paid_by !== req.user.userId)
          return sendError(res, 403, 'Only the payer can delete', ErrorCodes.FORBIDDEN);

        await stores.expenses.delete(expenseId);
        emitter.crewExpenseDeleted({ crewId, expenseId });
        return sendSuccess(res, { deleted: true });
      } catch (err: any) {
        log.error('delete expense failed', { error: err.message });
        return sendError(res, 500, 'Failed to delete expense', ErrorCodes.INTERNAL_ERROR);
      }
    },
  );

  // GET /crew/:crewId/expenses/balances
  router.get(
    '/crews/:crewId/expenses/balances',
    userAuth,
    rateLimit(60, 'expense-balances'),
    validateParams(schemas.crewIdParams),
    async (req: any, res: any) => {
      try {
        const crewId = sanitizeIdentifier(req.validatedParams.crewId);
        const member = await stores.crews.getMember(crewId, req.user.userId);
        if (!member) return sendError(res, 403, 'Not a crew member', ErrorCodes.FORBIDDEN);
        const balances = await stores.expenses.getBalances(crewId);
        return sendSuccess(res, balances);
      } catch (err: any) {
        log.error('get balances failed', { error: err.message });
        return sendError(res, 500, 'Failed to load balances', ErrorCodes.INTERNAL_ERROR);
      }
    },
  );

  // GET /crews/:crewId/expenses/settlement-plan
  // Returns the netted who-pays-whom plan (greedy min-cash-flow over the
  // integer-cent ledger) alongside the raw dollar balances. Each settlement
  // row carries the PAYEE's payment handles (and only the payee's) so the
  // client can render prefilled Venmo/Cash App/PayPal links without leaking
  // the whole roster's handles.
  router.get(
    '/crews/:crewId/expenses/settlement-plan',
    userAuth,
    rateLimit(60, 'expense-settlement-plan'),
    validateParams(schemas.crewIdParams),
    async (req: any, res: any) => {
      try {
        const crewId = sanitizeIdentifier(req.validatedParams.crewId);
        const member = await stores.crews.getMember(crewId, req.user.userId);
        if (!member) return sendError(res, 403, 'Not a crew member', ErrorCodes.FORBIDDEN);

        const balancesCents = await stores.expenses.getBalancesCents(crewId);
        const settlements = simplifyDebts(balancesCents);

        // Attach payee payment handles (only for users who actually receive a
        // transfer in this plan). Handles are optional/nullable.
        const payeeIds = [...new Set(settlements.map((s: any) => s.toUserId))];
        const userMap = payeeIds.length ? await stores.users.getByIds(payeeIds) : new Map();
        const settlementsWithHandles = settlements.map((s: any) => {
          const payee = userMap.get(s.toUserId);
          return {
            fromUserId: s.fromUserId,
            fromName: s.fromName,
            toUserId: s.toUserId,
            toName: s.toName,
            amountCents: s.amountCents,
            // Dollars convenience for clients that render currency directly.
            amount: s.amountCents / 100,
            payeeHandles: payee
              ? {
                  venmo: payee.venmoHandle || null,
                  cashapp: payee.cashappCashtag || null,
                  paypal: payee.paypalHandle || null,
                }
              : { venmo: null, cashapp: null, paypal: null },
          };
        });

        // Dollars balances mirror the existing /balances contract.
        const balances = balancesCents.map((b: any) => ({
          userId: b.userId,
          username: b.username,
          balance: b.balanceCents / 100,
        }));

        return sendSuccess(res, { balances, settlements: settlementsWithHandles });
      } catch (err: any) {
        log.error('get settlement plan failed', { error: err.message });
        return sendError(res, 500, 'Failed to load settlement plan', ErrorCodes.INTERNAL_ERROR);
      }
    },
  );

  router.post(
    '/crews/:crewId/expenses/settle',
    userAuth,
    rateLimit(20, 'expense-settle'),
    validateParams(schemas.crewIdParams),
    validate(schemas.expenseSettleFull),
    async (req: any, res: any) => {
      try {
        const crewId = sanitizeIdentifier(req.validatedParams.crewId);
        const member = await stores.crews.getMember(crewId, req.user.userId);
        if (!member) return sendError(res, 403, 'Not a crew member', ErrorCodes.FORBIDDEN);
        const { toUserId, amount } = req.validatedBody;
        // The settlement target must be a different current crew member.
        if (toUserId === req.user.userId) {
          return sendError(res, 400, 'Cannot settle with yourself', ErrorCodes.INVALID_INPUT);
        }
        const settleMemberIds = new Set((await stores.crews.getMembers(crewId)).map((m: any) => m.userId));
        if (!settleMemberIds.has(toUserId)) {
          return sendError(res, 400, 'Settlement target is not a crew member', ErrorCodes.INVALID_INPUT);
        }
        const settlement = await stores.expenses.create({
          crewId,
          paidBy: req.user.userId,
          description: `Settlement payment`,
          amount: Math.round(amount * 100) / 100,
          splitWith: [toUserId],
          category: 'settlement',
        });
        await stores.activity.log({
          crewId,
          userId: req.user.userId,
          type: 'expense_settled',
          detail: `$${amount.toFixed(2)} to ${toUserId}`,
        });
        emitter.crewExpenseAdded({ crewId, expense: settlement });
        res.status(201);
        return sendSuccess(res, settlement);
      } catch (err: any) {
        log.error('settle expense failed', { error: err.message });
        return sendError(res, 500, 'Failed to record settlement', ErrorCodes.INTERNAL_ERROR);
      }
    },
  );
  return router;
}
