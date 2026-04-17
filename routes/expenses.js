'use strict';

module.exports = function createExpenseRoutes(deps) {
  const router = deps.express.Router();
  const { stores, userAuth, sendSuccess, sendError, ErrorCodes, log, rateLimit, emitter, sanitizeIdentifier } = deps;

  // GET /crew/:crewId/expenses
  router.get('/crews/:crewId/expenses', userAuth, async (req, res) => {
    try {
      const crewId = sanitizeIdentifier(req.params.crewId);
      if (!crewId) return sendError(res, 400, 'Invalid crew ID', ErrorCodes.INVALID_INPUT);
      const member = await stores.crews.getMember(crewId, req.user.userId);
      if (!member) return sendError(res, 403, 'Not a crew member', ErrorCodes.FORBIDDEN);
      const expenses = await stores.expenses.getByCrew(crewId);
      return sendSuccess(res, expenses);
    } catch (err) {
      log.error('get expenses failed', { error: err.message });
      return sendError(res, 500, 'Failed to load expenses', ErrorCodes.INTERNAL_ERROR);
    }
  });

  // POST /crew/:crewId/expenses
  router.post('/crews/:crewId/expenses', userAuth, rateLimit(30, 'expense-create'), async (req, res) => {
    try {
      const crewId = sanitizeIdentifier(req.params.crewId);
      if (!crewId) return sendError(res, 400, 'Invalid crew ID', ErrorCodes.INVALID_INPUT);
      const member = await stores.crews.getMember(crewId, req.user.userId);
      if (!member) return sendError(res, 403, 'Not a crew member', ErrorCodes.FORBIDDEN);

      const { description, amount, splitWith, category } = req.body || {};
      if (!description || typeof description !== 'string' || description.trim().length === 0) {
        return sendError(res, 400, 'Description required', ErrorCodes.INVALID_INPUT);
      }
      const numAmount = Number(amount);
      if (!Number.isFinite(numAmount) || numAmount <= 0 || numAmount > 99999) {
        return sendError(res, 400, 'Valid amount required (0-99999)', ErrorCodes.INVALID_INPUT);
      }

      const expense = await stores.expenses.create({
        crewId,
        paidBy: req.user.userId,
        description: description.trim().slice(0, 200),
        amount: Math.round(numAmount * 100) / 100,
        splitWith: Array.isArray(splitWith) ? splitWith : [],
      category: typeof category === 'string' ? category.slice(0,20) : 'other',
      });

      emitter.crewExpenseAdded({ crewId, expense });
      return sendSuccess(res, expense, 201);
    } catch (err) {
      log.error('create expense failed', { error: err.message });
      return sendError(res, 500, 'Failed to create expense', ErrorCodes.INTERNAL_ERROR);
    }
  });

  // DELETE /crew/:crewId/expenses/:expenseId
  router.delete('/crews/:crewId/expenses/:expenseId', userAuth, rateLimit(30, 'expense-delete'), async (req, res) => {
    try {
      const crewId = sanitizeIdentifier(req.params.crewId);
      const expenseId = sanitizeIdentifier(req.params.expenseId);
      if (!crewId || !expenseId) return sendError(res, 400, 'Invalid IDs', ErrorCodes.INVALID_INPUT);
      const member = await stores.crews.getMember(crewId, req.user.userId);
      if (!member) return sendError(res, 403, 'Not a crew member', ErrorCodes.FORBIDDEN);

      const expense = await stores.expenses.getById(expenseId);
      if (!expense || expense.crew_id !== crewId) return sendError(res, 404, 'Expense not found', ErrorCodes.NOT_FOUND);
      if (expense.paid_by !== req.user.userId) return sendError(res, 403, 'Only the payer can delete', ErrorCodes.FORBIDDEN);

      await stores.expenses.delete(expenseId);
      emitter.crewExpenseDeleted({ crewId, expenseId });
      return sendSuccess(res, { deleted: true });
    } catch (err) {
      log.error('delete expense failed', { error: err.message });
      return sendError(res, 500, 'Failed to delete expense', ErrorCodes.INTERNAL_ERROR);
    }
  });

  // GET /crew/:crewId/expenses/balances
  router.get('/crews/:crewId/expenses/balances', userAuth, async (req, res) => {
    try {
      const crewId = sanitizeIdentifier(req.params.crewId);
      if (!crewId) return sendError(res, 400, 'Invalid crew ID', ErrorCodes.INVALID_INPUT);
      const member = await stores.crews.getMember(crewId, req.user.userId);
      if (!member) return sendError(res, 403, 'Not a crew member', ErrorCodes.FORBIDDEN);
      const balances = await stores.expenses.getBalances(crewId);
      return sendSuccess(res, balances);
    } catch (err) {
      log.error('get balances failed', { error: err.message });
      return sendError(res, 500, 'Failed to load balances', ErrorCodes.INTERNAL_ERROR);
    }
  });

  
  router.post('/crews/:crewId/expenses/settle', userAuth, rateLimit(20, 'expense-settle'), async (req, res) => {
    try {
      const crewId = sanitizeIdentifier(req.params.crewId);
      if (!crewId) return sendError(res, 400, 'Invalid crew ID', ErrorCodes.INVALID_INPUT);
      const member = await stores.crews.getMember(crewId, req.user.userId);
      if (!member) return sendError(res, 403, 'Not a crew member', ErrorCodes.FORBIDDEN);
      const { toUserId, amount } = req.body || {};
      if (!toUserId || typeof toUserId !== 'string') return sendError(res, 400, 'toUserId required', ErrorCodes.INVALID_INPUT);
      const numAmount = Number(amount);
      if (!Number.isFinite(numAmount) || numAmount <= 0) return sendError(res, 400, 'Valid amount required', ErrorCodes.INVALID_INPUT);
      const settlement = await stores.expenses.create({
        crewId,
        paidBy: req.user.userId,
        description: `Settlement payment`,
        amount: Math.round(numAmount * 100) / 100,
        splitWith: [toUserId],
        category: 'settlement',
      });
      await stores.activity.log({ crewId, userId: req.user.userId, type: 'expense_settled', detail: `$${numAmount.toFixed(2)} to ${toUserId}` });
      emitter.crewExpenseAdded({ crewId, expense: settlement });
      return sendSuccess(res, settlement, 201);
    } catch (err) {
      log.error('settle expense failed', { error: err.message });
      return sendError(res, 500, 'Failed to record settlement', ErrorCodes.INTERNAL_ERROR);
    }
  });
  return router;
};
