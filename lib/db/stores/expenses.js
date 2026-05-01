'use strict';

function createExpensesStore(pool) {
  return {
    async create({ crewId, paidBy, description, amount, splitWith, category = 'other' }) {
      const id = require('crypto').randomUUID();
      const splitJson = JSON.stringify(splitWith || []);
      const { rows } = await pool.query(
        `INSERT INTO crew_expenses (id, crew_id, paid_by, description, amount, split_with, category, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, NOW()) RETURNING *`,
        [id, crewId, paidBy, description, amount, splitJson, category]
      );
      return rows[0];
    },

    async getByCrew(crewId) {
      const { rows } = await pool.query(
        `SELECT e.*, u.username as paid_by_name
         FROM crew_expenses e
         JOIN users u ON u.id = e.paid_by AND u.deleted_at IS NULL
         WHERE e.crew_id = $1
         ORDER BY e.created_at DESC`,
        [crewId]
      );
      return rows.map(r => {
        let splitWith = r.split_with || [];
        if (typeof r.split_with === 'string') {
          try { splitWith = JSON.parse(r.split_with); } catch { splitWith = []; }
        }
        return { ...r, split_with: splitWith };
      });
    },

    async getById(expenseId) {
      const { rows } = await pool.query(
        `SELECT id, crew_id, paid_by, description, amount, split_with, category, created_at
         FROM crew_expenses WHERE id = $1`,
        [expenseId],
      );
      return rows[0] || null;
    },

    async delete(expenseId) {
      await pool.query('DELETE FROM crew_expenses WHERE id = $1', [expenseId]);
    },

    async getBalances(crewId) {
      // Get all expenses for the crew
      const { rows: expenses } = await pool.query(
        `SELECT id, crew_id, paid_by, description, amount, split_with, category, created_at
         FROM crew_expenses WHERE crew_id = $1`, [crewId]
      );
      // Get all crew members
      const { rows: members } = await pool.query(
        `SELECT cm.user_id, u.username FROM crew_members cm
         JOIN users u ON u.id = cm.user_id AND u.deleted_at IS NULL
         WHERE cm.crew_id = $1`, [crewId]
      );

      const memberIds = members.map(m => m.user_id);
      const nameMap = Object.fromEntries(members.map(m => [m.user_id, m.username]));
      const balances = {};
      memberIds.forEach(id => { balances[id] = 0; });

      for (const exp of expenses) {
        let splitWith = exp.split_with || [];
        if (typeof exp.split_with === 'string') {
          try { splitWith = JSON.parse(exp.split_with); } catch { splitWith = []; }
        }
        // If splitWith is empty, split among all members
        const splitMembers = splitWith.length > 0 ? splitWith : memberIds;
        const shareCount = splitMembers.length;
        if (shareCount === 0) continue;
        const share = exp.amount / shareCount;

        // Payer gets credit
        if (balances[exp.paid_by] !== undefined) balances[exp.paid_by] += exp.amount;
        // Everyone in split owes their share
        splitMembers.forEach(uid => {
          if (balances[uid] !== undefined) balances[uid] -= share;
        });
      }

      return memberIds.map(id => ({
        userId: id,
        username: nameMap[id],
        balance: Math.round(balances[id] * 100) / 100,
      }));
    },
  };
}

module.exports = { createExpensesStore };
