/**
 * Copyright (c) 2026 Asir Khan. All rights reserved.
 * Licensed under the Business Source License 1.1. See LICENSE file for details.
 */

/**
 * Admin audit log tab — searchable, filterable, paginated audit log viewer
 */

import { adminState } from '../../app/state.js?v=1776342458439';
import { h } from '../../app/dom.js?v=1776342458439';

// ── Helpers ────────────────────────────────────────────────────

function spinner(text = 'Loading...') {
  return h('div', { className: 'admin-loading', role: 'status', 'aria-live': 'polite' },
    h('div', { className: 'admin-spinner', 'aria-hidden': 'true' }),
    h('span', {}, text),
  );
}

function formatTimestamp(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ' ' +
    d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
}

const ACTION_FRIENDLY = {
  'admin_delete_user': 'Delete User',
  'role_grant': 'Grant Role',
  'role_revoke': 'Revoke Role',
  'bulk_deactivate': 'Bulk Deactivate',
  'bulk_archive': 'Bulk Archive',
  'create:token': 'Create Token',
  'create:verify': 'Verify Email',
  'register': 'Register',
  'login': 'Login',
  'festival_create': 'Create Festival',
  'festival_update': 'Update Festival',
  'festival_delete': 'Delete Festival',
  'delete:users': 'Delete User',
  'crew_remove_member': 'Remove Crew Member',
  'crew_delete': 'Delete Crew',
};

function friendlyAction(action) {
  return ACTION_FRIENDLY[action] || action?.replace(/[_:]/g, ' ') || '—';
}

// ── State defaults ────────────────────────────────────────────

function ensureAuditState() {
  if (!adminState.auditFilter) {
    adminState.auditFilter = { action: '', from: '', to: '' };
  }
  if (adminState.auditOffset === undefined) adminState.auditOffset = 0;
  if (!adminState.auditLimit) adminState.auditLimit = 50;
}

// ── Load ──────────────────────────────────────────────────────

export async function loadAuditLog(deps) {
  const { adminApi, toast } = deps;
  ensureAuditState();
  try {
    const f = adminState.auditFilter;
    const params = new URLSearchParams();
    if (f.action) params.set('action', f.action);
    if (f.from) params.set('from', new Date(f.from).toISOString());
    if (f.to) params.set('to', new Date(f.to + 'T23:59:59').toISOString());
    params.set('limit', String(adminState.auditLimit));
    params.set('offset', String(adminState.auditOffset));

    const qs = params.toString();
    const result = await adminApi(`/admin/audit${qs ? '?' + qs : ''}`);

    // The API returns { data: entries, meta: { total, limit, offset } } but adminApi unwraps data
    // Check if result is the entries array directly or has nested structure
    if (Array.isArray(result)) {
      adminState.auditEntries = result;
      // Try to get total from response meta (if available via extended response)
      adminState.auditTotal = result.length < adminState.auditLimit
        ? adminState.auditOffset + result.length
        : adminState.auditOffset + result.length + 1; // indicate there's more
    } else {
      adminState.auditEntries = result;
      adminState.auditTotal = 0;
    }
    adminState.auditLoaded = true;
  } catch (e) {
    toast('Failed to load audit log', 'error');
    adminState.auditEntries = null;
  }
}

// ── Render ─────────────────────────────────────────────────────

export function renderAuditLog(panel, deps) {
  const { rerender } = deps;
  ensureAuditState();

  // Promote the panel container to a labeled region
  panel.setAttribute?.('role', 'region');
  panel.setAttribute?.('aria-label', 'Audit log');

  const entries = adminState.auditEntries;

  if (!entries) {
    if (!adminState.auditLoaded) {
      loadAuditLog(deps).then(() => rerender());
      panel.appendChild(spinner('Loading audit log...'));
      return;
    }
    panel.appendChild(h('p', { style: { color: 'var(--text-muted)', textAlign: 'center', padding: '20px' } }, 'Audit log unavailable.'));
    return;
  }

  // ── Filters ──
  const filters = h('div', { className: 'admin-audit-filters', role: 'search', 'aria-label': 'Audit log filters' });
  const f = adminState.auditFilter;

  // Action filter
  const actionSelect = h('select', {
    className: 'admin-input admin-audit-select',
    'aria-label': 'Filter by action type',
    value: f.action || '',
    onchange: (e) => {
      adminState.auditFilter.action = e.target.value;
      adminState.auditOffset = 0;
      loadAuditLog(deps).then(() => rerender());
    },
  },
    h('option', { value: '' }, 'All Actions'),
  );
  // Build unique action list from current entries + common actions
  const knownActions = new Set(Object.keys(ACTION_FRIENDLY));
  if (entries) entries.forEach(e => knownActions.add(e.action));
  [...knownActions].sort().forEach(action => {
    const opt = h('option', { value: action }, friendlyAction(action));
    if (action === f.action) opt.selected = true;
    actionSelect.appendChild(opt);
  });
  filters.appendChild(h('label', { className: 'admin-audit-filter-group' },
    h('span', { className: 'admin-audit-filter-label' }, 'Action'),
    actionSelect,
  ));

  // Date range
  const fromInput = h('input', {
    type: 'date', className: 'admin-input', value: f.from || '',
    'aria-label': 'Filter from date',
    onchange: (e) => {
      adminState.auditFilter.from = e.target.value;
      adminState.auditOffset = 0;
      loadAuditLog(deps).then(() => rerender());
    },
  });
  filters.appendChild(h('label', { className: 'admin-audit-filter-group' },
    h('span', { className: 'admin-audit-filter-label' }, 'From'),
    fromInput,
  ));

  const toInput = h('input', {
    type: 'date', className: 'admin-input', value: f.to || '',
    'aria-label': 'Filter to date',
    onchange: (e) => {
      adminState.auditFilter.to = e.target.value;
      adminState.auditOffset = 0;
      loadAuditLog(deps).then(() => rerender());
    },
  });
  filters.appendChild(h('label', { className: 'admin-audit-filter-group' },
    h('span', { className: 'admin-audit-filter-label' }, 'To'),
    toInput,
  ));

  // Clear button
  filters.appendChild(h('button', {
    className: 'btn btn-ghost btn-sm',
    'aria-label': 'Clear all filters',
    style: { alignSelf: 'flex-end' },
    onclick: () => {
      adminState.auditFilter = { action: '', from: '', to: '' };
      adminState.auditOffset = 0;
      loadAuditLog(deps).then(() => rerender());
    },
  }, 'Clear'));

  panel.appendChild(filters);

  // ── Entries ──
  if (entries.length === 0) {
    panel.appendChild(h('p', { className: 'admin-empty-text', role: 'status' }, 'No audit entries match your filters.'));
  } else {
    const table = h('div', {
      className: 'admin-audit-table',
      role: 'log',
      'aria-live': 'polite',
      'aria-label': 'Audit log entries',
    });

    table.appendChild(h('div', { className: 'admin-audit-row header', role: 'row' },
      h('span', { className: 'admin-audit-cell time', role: 'columnheader' }, 'Time'),
      h('span', { className: 'admin-audit-cell action', role: 'columnheader' }, 'Action'),
      h('span', { className: 'admin-audit-cell actor', role: 'columnheader' }, 'Actor'),
      h('span', { className: 'admin-audit-cell target', role: 'columnheader' }, 'Target'),
      h('span', { className: 'admin-audit-cell status', role: 'columnheader' }, 'Status'),
      h('span', { className: 'admin-audit-cell details', role: 'columnheader' }, 'Details'),
    ));

    entries.forEach(e => {
      const details = e.details || (e.detailsJson ? JSON.parse(e.detailsJson) : null);
      const detailStr = details ? Object.entries(details).map(([k, v]) => `${k}: ${v}`).join(', ') : '—';

      table.appendChild(h('div', { className: 'admin-audit-row', role: 'row' },
        h('span', { className: 'admin-audit-cell time', role: 'cell' }, formatTimestamp(e.createdAt)),
        h('span', { className: 'admin-audit-cell action', role: 'cell' }, friendlyAction(e.action)),
        h('span', { className: 'admin-audit-cell actor', role: 'cell' }, e.actorId || '—'),
        h('span', { className: 'admin-audit-cell target', role: 'cell' },
          e.targetType ? `${e.targetType}${e.targetId ? ':' + e.targetId.substring(0, 8) : ''}` : '—'
        ),
        h('span', { className: 'admin-audit-cell status badge-' + (e.status || 'success'), role: 'cell' }, e.status || 'success'),
        h('span', { className: 'admin-audit-cell details', role: 'cell', title: detailStr }, detailStr.length > 40 ? detailStr.substring(0, 40) + '…' : detailStr),
      ));
    });
    panel.appendChild(table);
  }

  // ── Pagination ──
  const offset = adminState.auditOffset;
  const limit = adminState.auditLimit;
  const hasMore = entries.length >= limit;
  const hasPrev = offset > 0;

  const pag = h('div', { className: 'admin-audit-pagination', role: 'navigation', 'aria-label': 'Audit log pagination' },
    h('button', {
      className: 'btn btn-ghost btn-sm',
      'aria-label': 'Previous page',
      disabled: !hasPrev,
      onclick: () => {
        adminState.auditOffset = Math.max(0, offset - limit);
        loadAuditLog(deps).then(() => rerender());
      },
    }, '← Previous'),
    h('span', { className: 'admin-audit-page-info', role: 'status', 'aria-live': 'polite' },
      `Showing ${offset + 1}–${offset + entries.length}`
    ),
    h('button', {
      className: 'btn btn-ghost btn-sm',
      'aria-label': 'Next page',
      disabled: !hasMore,
      onclick: () => {
        adminState.auditOffset = offset + limit;
        loadAuditLog(deps).then(() => rerender());
      },
    }, 'Next →'),
  );
  panel.appendChild(pag);
}
