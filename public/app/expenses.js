/**
 * Crew Expenses — Festie
 * Lightweight expense splitting with per-member selection.
 */
import { S, TRUSTED_MUTATION_HEADER } from './state.js?v=1776342458439';
import { h } from './dom.js?v=1776342458439';

let _api, _toast, _render;

export function initExpenses(deps) {
  _api = deps.api;
  _toast = deps.toast;
  _render = deps.render;
}

export async function loadExpenses(crewId) {
  try {
    S._crewExpenses = await _api(`/crews/${crewId}/expenses`);
    S._crewBalances = await _api(`/crews/${crewId}/expenses/balances`);
  } catch (_e) {
    S._crewExpenses = [];
    S._crewBalances = [];
  }
}

export async function addExpense(crewId, description, amount, splitWith, category = 'other') {
  const expense = await _api(`/crews/${crewId}/expenses`, {
    method: 'POST',
    body: { description, amount: Number(amount), splitWith: splitWith || [], category },
  });
  await loadExpenses(crewId);
  _render();
  return expense;
}

export async function deleteExpense(crewId, expenseId) {
  await _api(`/crews/${crewId}/expenses/${expenseId}`, { method: 'DELETE' });
  await loadExpenses(crewId);
  _render();
}

export async function settleUp(crewId, toUserId, amount) {
  await _api(`/crews/${crewId}/expenses/settle`, {
    method: 'POST',
    body: { toUserId, amount: Number(amount) },
  });
  await loadExpenses(crewId);
  _render();
}

/**
 * Compute simplified debt resolution from net balances.
 * Returns array of { from, fromName, to, toName, amount }
 */
function computeSimplifiedDebts(balances) {
  const debtors = balances.filter(b => b.balance < -0.01).map(b => ({ ...b, owed: -b.balance })).sort((a,b) => b.owed - a.owed);
  const creditors = balances.filter(b => b.balance > 0.01).map(b => ({ ...b })).sort((a,b) => b.balance - a.balance);
  const debts = [];
  let i = 0, j = 0;
  while (i < debtors.length && j < creditors.length) {
    const pay = Math.min(debtors[i].owed, creditors[j].balance);
    if (pay > 0.01) {
      debts.push({ from: debtors[i].userId, fromName: debtors[i].username, to: creditors[j].userId, toName: creditors[j].username, amount: Math.round(pay * 100) / 100 });
    }
    debtors[i].owed -= pay;
    creditors[j].balance -= pay;
    if (debtors[i].owed < 0.01) i++;
    if (creditors[j].balance < 0.01) j++;
  }
  return debts;
}

export function renderExpensesTab(deps) {
  const { crewId, crewMembers, currentUserId } = deps;
  const container = h('div', { className: 'expenses-container', role: 'region', 'aria-label': 'Crew expenses' });

  // Spend overview
  const expenses = S._crewExpenses || [];
  const balances = S._crewBalances || [];
  if (expenses.length > 0) {
    const totalSpend = expenses.filter(e => e.category !== 'settlement').reduce((sum, e) => sum + Number(e.amount), 0);
    const myOwed = balances.find(b => b.userId === currentUserId)?.balance || 0;
    const overview = h('div', { className: 'expense-overview', role: 'group', 'aria-label': 'Spending overview' });
    overview.appendChild(h('div', { className: 'expense-overview-stat' },
      h('div', { className: 'expense-overview-amount' }, '\$' + totalSpend.toFixed(2)),
      h('div', { className: 'expense-overview-label' }, 'Total spent')
    ));
    if (myOwed < -0.01) {
      overview.appendChild(h('div', { className: 'expense-overview-stat expense-overview-negative' },
        h('div', { className: 'expense-overview-amount' }, '\$' + Math.abs(myOwed).toFixed(2)),
        h('div', { className: 'expense-overview-label' }, 'You owe')
      ));
    } else if (myOwed > 0.01) {
      overview.appendChild(h('div', { className: 'expense-overview-stat expense-overview-positive' },
        h('div', { className: 'expense-overview-amount' }, '\$' + myOwed.toFixed(2)),
        h('div', { className: 'expense-overview-label' }, "You're owed")
      ));
    }
    container.appendChild(overview);
  }

  // Net balance summary: "You owe Alex $X" / "Jordan owes you $Y"
  const netBalances = S._crewBalances || [];
  if (netBalances.length > 1 && expenses.length > 0) {
    const debts = computeSimplifiedDebts(netBalances);
    const myDebts = debts.filter(d => d.from === currentUserId || d.to === currentUserId);
    if (myDebts.length > 0) {
      const summarySection = h('div', { className: 'expense-net-summary', role: 'group', 'aria-label': 'Net balance summary' });
      myDebts.forEach(d => {
        const isOwing = d.from === currentUserId;
        const other = isOwing ? d.toName : d.fromName;
        const label = isOwing ? `You owe ${other}` : `${other} owes you`;
        const row = h('div', { className: 'expense-net-row' + (isOwing ? ' expense-net-owing' : ' expense-net-owed') });
        row.appendChild(h('span', { className: 'expense-net-label' }, label));
        row.appendChild(h('span', { className: 'expense-net-amount' }, `$${d.amount.toFixed(2)}`));
        if (isOwing) {
          const settleBtn = h('button', {
            className: 'btn btn-ghost btn-sm expense-settle-btn', type: 'button',
            'aria-label': `Settle $${d.amount.toFixed(2)} with ${other}`,
            onclick: async () => {
              settleBtn.disabled = true;
              try { await settleUp(crewId, d.to, d.amount); _toast(`Settled $${d.amount.toFixed(2)} with ${other}`, 'success'); }
              catch (e) { _toast(e.message || 'Couldn\u2019t settle up. Try again.', 'error'); settleBtn.disabled = false; }
            },
          }, 'Settle Up');
          row.appendChild(settleBtn);
        }
        summarySection.appendChild(row);
      });
      container.appendChild(summarySection);
    }
  }

  const selectedMembers = new Set(crewMembers.map(m => m.userId || m.user_id));

  const form = h('div', { className: 'expense-form-wrapper', role: 'form', 'aria-label': 'Add expense' });
  let selectedCategory = 'other';

  const inputRow = h('div', { className: 'expense-form' });
  const descInput = h('input', {
    type: 'text', placeholder: 'What was it for?', className: 'expense-desc-input',
    'aria-label': 'Expense description',
    maxLength: 200,
  });
  const amountInput = h('input', {
    type: 'number', placeholder: '0.00', className: 'expense-amount-input',
    'aria-label': 'Expense amount in dollars',
    step: '0.01', min: '0.01', max: '99999',
  });
  inputRow.appendChild(descInput);
  inputRow.appendChild(amountInput);
  const catSelect = h('select', { className: 'expense-cat-select', 'aria-label': 'Expense category', onchange: (e) => { selectedCategory = e.target.value; } }, h('option', { value: 'food' }, '🍔 Food'), h('option', { value: 'drinks' }, '🍺 Drinks'), h('option', { value: 'transport' }, '🚗 Transport'), h('option', { value: 'accommodation' }, '🏨 Hotel'), h('option', { value: 'tickets' }, '🎫 Tickets'), h('option', { value: 'other', selected: true }, '💸 Other'));
  inputRow.appendChild(catSelect);
  form.appendChild(inputRow);

  let updateSplitPreview = () => {};

  if (crewMembers.length > 1) {
    const splitRow = h('div', { className: 'expense-split-row', role: 'group', 'aria-label': 'Split expense with members' });
    splitRow.appendChild(h('span', { className: 'expense-split-label', id: 'expense-split-label' }, 'Split with:'));
    const chipWrap = h('div', { className: 'expense-split-chips', role: 'group', 'aria-labelledby': 'expense-split-label' });

    crewMembers.forEach(m => {
      const uid = m.userId || m.user_id;
      const name = m.username || m.displayName || 'User';
      const isSelected = selectedMembers.has(uid);
      const chip = h('button', {
        type: 'button',
        className: `expense-split-chip ${isSelected ? 'selected' : ''}`,
        role: 'checkbox',
        'aria-checked': isSelected ? 'true' : 'false',
        'aria-label': `Include ${name} in split`,
        onclick: () => {
          if (selectedMembers.has(uid)) {
            if (selectedMembers.size <= 1) { _toast('At least one person must be selected', 'error'); return; }
            selectedMembers.delete(uid);
            chip.classList.remove('selected');
            chip.setAttribute('aria-checked', 'false');
          } else {
            selectedMembers.add(uid);
            chip.classList.add('selected');
            chip.setAttribute('aria-checked', 'true');
          }
          updateSplitPreview();
        },
      }, name);
      chipWrap.appendChild(chip);
    });

    const toggleAll = h('button', {
      type: 'button', className: 'expense-split-toggle',
      'aria-label': 'Toggle all members',
      onclick: () => {
        const allSelected = selectedMembers.size === crewMembers.length;
        chipWrap.querySelectorAll('.expense-split-chip').forEach((c, i) => {
          const uid = crewMembers[i].userId || crewMembers[i].user_id;
          if (allSelected && i > 0) { selectedMembers.delete(uid); c.classList.remove('selected'); c.setAttribute('aria-checked','false'); }
          else if (!allSelected) { selectedMembers.add(uid); c.classList.add('selected'); c.setAttribute('aria-checked','true'); }
        });
        if (selectedMembers.size === 0) {
          const firstUid = crewMembers[0].userId || crewMembers[0].user_id;
          selectedMembers.add(firstUid);
          const firstChip = chipWrap.querySelector('.expense-split-chip');
          if (firstChip) { firstChip.classList.add('selected'); firstChip.setAttribute('aria-checked','true'); }
        }
        updateSplitPreview();
      },
    }, 'Toggle All');

    splitRow.appendChild(chipWrap);
    splitRow.appendChild(toggleAll);
    form.appendChild(splitRow);

    const splitPreview = h('div', { className: 'expense-split-preview', role: 'status', 'aria-live': 'polite' });
    form.appendChild(splitPreview);

    updateSplitPreview = () => {
      const amt = Number(amountInput.value) || 0;
      if (amt > 0 && selectedMembers.size > 0) {
        const each = (amt / selectedMembers.size).toFixed(2);
        splitPreview.textContent = `$${each}/person \u00d7 ${selectedMembers.size}`;
      } else {
        splitPreview.textContent = '';
      }
    };
    amountInput.addEventListener('input', updateSplitPreview);
  }

  const addBtn = h('button', {
    className: 'btn btn-primary btn-sm expense-add-btn', type: 'button',
    'aria-label': 'Add expense',
    onclick: async () => {
      const desc = descInput.value.trim();
      const amt = amountInput.value;
      if (!desc) { _toast('Enter a description', 'error'); return; }
      if (!amt || Number(amt) <= 0) { _toast('Enter an amount', 'error'); return; }
      addBtn.disabled = true;
      try {
        const splitWith = selectedMembers.size === crewMembers.length
          ? [] : [...selectedMembers];
        await addExpense(crewId, desc, amt, splitWith, selectedCategory);
        descInput.value = '';
        amountInput.value = '';
        _toast('Expense added', 'success');
      } catch (e) { _toast(e.message || 'Couldn\u2019t save. Check your connection and try again.', 'error'); }
      addBtn.disabled = false;
    }
  }, '+ Add Expense');
  form.appendChild(addBtn);
  container.appendChild(form);

  if (balances.length > 0) {
    const balSection = h('div', { className: 'expense-balances', role: 'region', 'aria-labelledby': 'expense-balances-title' });
    balSection.appendChild(h('div', { className: 'expense-section-title', id: 'expense-balances-title' }, 'Balances'));
    balances.forEach(b => {
      const cls = b.balance > 0.01 ? 'positive' : b.balance < -0.01 ? 'negative' : 'settled';
      const label = b.balance > 0.01 ? `is owed $${b.balance.toFixed(2)}`
        : b.balance < -0.01 ? `owes $${Math.abs(b.balance).toFixed(2)}`
        : 'settled up';
      const row = h('div', { className: `expense-balance-row ${cls}` });
      row.appendChild(h('span', { className: 'expense-balance-name' }, b.username));
      row.appendChild(h('span', { className: 'expense-balance-amount' }, label));
      balSection.appendChild(row);
    });
    container.appendChild(balSection);
  }

  if (expenses.length > 0) {
    const listSection = h('div', { className: 'expense-list', role: 'region', 'aria-labelledby': 'expense-list-title' });
    listSection.appendChild(h('div', { className: 'expense-section-title', id: 'expense-list-title' }, `Expenses (${expenses.length})`));

    const nameMap = {};
    crewMembers.forEach(m => { nameMap[m.userId || m.user_id] = m.username || m.displayName || 'User'; });

    expenses.forEach(exp => {
      const row = h('div', { className: 'expense-item', role: 'listitem' });
      const info = h('div', { className: 'expense-info' });
      info.appendChild(h('div', { className: 'expense-desc' }, exp.description));

      const meta = h('div', { className: 'expense-meta' });
      meta.appendChild(h('span', {}, `${exp.paid_by_name} paid`));

      const splitWith = exp.split_with || [];
      if (splitWith.length > 0 && splitWith.length < crewMembers.length) {
        const names = splitWith.map(uid => nameMap[uid] || 'Unknown').join(', ');
        meta.appendChild(h('span', { className: 'expense-split-info' }, `Split: ${names}`));
      } else {
        meta.appendChild(h('span', { className: 'expense-split-info' }, 'Split: everyone'));
      }

      const d = new Date(exp.created_at);
      meta.appendChild(h('span', {}, d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })));
      info.appendChild(meta);
      row.appendChild(info);
      row.appendChild(h('div', { className: 'expense-amount' }, `$${Number(exp.amount).toFixed(2)}`));
      if (exp.paid_by === currentUserId) {
        row.appendChild(h('button', {
          className: 'btn btn-ghost btn-sm expense-delete', type: 'button',
          'aria-label': `Delete expense ${exp.description}`,
          onclick: async (e) => {
            e.stopPropagation();
            try { await deleteExpense(crewId, exp.id); _toast('Deleted', 'info'); } catch (er) { _toast('Couldn\u2019t delete. Try again.', 'error'); }
          }
        }, '\u00d7'));
      }
      listSection.appendChild(row);
    });
    container.appendChild(listSection);
  } else {
    container.appendChild(h('div', { className: 'empty-state-guide', role: 'status' },
      h('div', { className: 'empty-state-icon', 'aria-hidden': 'true' }, '$'),
      h('div', { className: 'empty-state-text' }, 'No expenses yet. Add one to start tracking crew spending.')
    ));
  }

  return container;
}
