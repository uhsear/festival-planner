/**
 * Copyright (c) 2026 Asir Khan. All rights reserved.
 * Licensed under the Business Source License 1.1. See LICENSE file for details.
 */

/**
 * Admin analytics tab — top sets, active users, crew leaderboard, festival breakdowns
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

function barEl(value, max, color, label) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return h('div', {
    className: 'admin-bar-bg',
    role: 'progressbar',
    'aria-valuenow': String(value),
    'aria-valuemin': '0',
    'aria-valuemax': String(max || value || 1),
    'aria-label': label || `${value} of ${max}`,
  },
    h('div', { className: 'admin-bar-fill', style: { width: `${pct}%`, background: color || 'var(--accent-aqua)' } }),
  );
}

// ── Load ──────────────────────────────────────────────────────

export async function loadAnalytics(deps) {
  const { adminApi, toast } = deps;
  try {
    adminState.analyticsData = await adminApi('/admin/analytics');
    adminState.analyticsLoaded = true;
  } catch (e) {
    toast('Failed to load analytics', 'error');
    adminState.analyticsData = null;
  }
}

// ── Render ─────────────────────────────────────────────────────

export function renderAnalytics(panel, deps) {
  const { rerender } = deps;
  const data = adminState.analyticsData;

  // Wrap panel content with region semantics
  panel.setAttribute?.('role', 'region');
  panel.setAttribute?.('aria-labelledby', 'analytics-heading');

  if (!data) {
    if (!adminState.analyticsLoaded) {
      loadAnalytics(deps).then(() => rerender());
      panel.appendChild(h('h2', { id: 'analytics-heading', className: 'sr-only' }, 'Analytics'));
      panel.appendChild(spinner('Loading analytics...'));
      return;
    }
    panel.appendChild(h('h2', { id: 'analytics-heading', className: 'sr-only' }, 'Analytics'));
    panel.appendChild(h('p', { style: { color: 'var(--text-muted)', textAlign: 'center', padding: '20px' } }, 'Analytics data unavailable.'));
    return;
  }

  const { topSets, activeUsers, crews, festivalStats } = data;

  // Hidden heading to anchor the region label
  panel.appendChild(h('h2', { id: 'analytics-heading', className: 'sr-only' }, 'Analytics'));

  // ── Top Sets ──
  panel.appendChild(h('h3', { className: 'admin-section-title', id: 'analytics-top-sets' }, 'Most Picked Sets'));
  if (topSets && topSets.length > 0) {
    const maxPicks = parseInt(topSets[0].pickCount || 0, 10);
    const setsTable = h('div', { className: 'admin-analytics-table', role: 'table', 'aria-labelledby': 'analytics-top-sets' });

    const setsHeader = h('div', { className: 'admin-analytics-row header', role: 'row' },
      h('span', { className: 'admin-analytics-cell grow', role: 'columnheader' }, 'Artist'),
      h('span', { className: 'admin-analytics-cell num', role: 'columnheader' }, 'Must'),
      h('span', { className: 'admin-analytics-cell num', role: 'columnheader' }, 'Want'),
      h('span', { className: 'admin-analytics-cell num', role: 'columnheader' }, 'Maybe'),
      h('span', { className: 'admin-analytics-cell num', role: 'columnheader' }, 'Total'),
      h('span', { className: 'admin-analytics-cell bar', role: 'columnheader', 'aria-label': 'Relative popularity' }, ''),
    );
    setsTable.appendChild(setsHeader);

    topSets.forEach(s => {
      const total = parseInt(s.pickCount || 0, 10);
      setsTable.appendChild(h('div', { className: 'admin-analytics-row', role: 'row' },
        h('span', { className: 'admin-analytics-cell grow', role: 'cell' }, s.artist || '—'),
        h('span', { className: 'admin-analytics-cell num must', role: 'cell' }, String(s.mustCount || 0)),
        h('span', { className: 'admin-analytics-cell num want', role: 'cell' }, String(s.wantCount || 0)),
        h('span', { className: 'admin-analytics-cell num maybe', role: 'cell' }, String(s.maybeCount || 0)),
        h('span', { className: 'admin-analytics-cell num total', role: 'cell' }, String(total)),
        h('span', { className: 'admin-analytics-cell bar', role: 'cell' }, barEl(total, maxPicks, 'var(--accent-coral)', `${total} picks`)),
      ));
    });
    panel.appendChild(setsTable);
  } else {
    panel.appendChild(h('p', { className: 'admin-empty-text' }, 'No picks yet.'));
  }

  // ── Active Users ──
  panel.appendChild(h('h3', { className: 'admin-section-title', id: 'analytics-active-users' }, 'Most Active Users'));
  if (activeUsers && activeUsers.length > 0) {
    const maxUserPicks = parseInt(activeUsers[0].totalPicks || 0, 10);
    const usersTable = h('div', { className: 'admin-analytics-table', role: 'table', 'aria-labelledby': 'analytics-active-users' });

    usersTable.appendChild(h('div', { className: 'admin-analytics-row header', role: 'row' },
      h('span', { className: 'admin-analytics-cell grow', role: 'columnheader' }, 'User'),
      h('span', { className: 'admin-analytics-cell num', role: 'columnheader' }, 'Profiles'),
      h('span', { className: 'admin-analytics-cell num', role: 'columnheader' }, 'Picks'),
      h('span', { className: 'admin-analytics-cell bar', role: 'columnheader', 'aria-label': 'Relative activity' }, ''),
    ));

    activeUsers.slice(0, 20).forEach(u => {
      const picks = parseInt(u.totalPicks || 0, 10);
      usersTable.appendChild(h('div', { className: 'admin-analytics-row', role: 'row' },
        h('span', { className: 'admin-analytics-cell grow', role: 'cell' }, u.username || '—'),
        h('span', { className: 'admin-analytics-cell num', role: 'cell' }, String(u.profileCount || 0)),
        h('span', { className: 'admin-analytics-cell num total', role: 'cell' }, String(picks)),
        h('span', { className: 'admin-analytics-cell bar', role: 'cell' }, barEl(picks, maxUserPicks, 'var(--accent-aqua)', `${picks} picks`)),
      ));
    });
    panel.appendChild(usersTable);
  } else {
    panel.appendChild(h('p', { className: 'admin-empty-text' }, 'No active users.'));
  }

  // ── Crew Leaderboard ──
  panel.appendChild(h('h3', { className: 'admin-section-title', id: 'analytics-crew-board' }, 'Crew Leaderboard'));
  if (crews && crews.length > 0) {
    const maxMembers = parseInt(crews[0].memberCount || 0, 10);
    const crewTable = h('div', { className: 'admin-analytics-table', role: 'table', 'aria-labelledby': 'analytics-crew-board' });

    crewTable.appendChild(h('div', { className: 'admin-analytics-row header', role: 'row' },
      h('span', { className: 'admin-analytics-cell grow', role: 'columnheader' }, 'Crew'),
      h('span', { className: 'admin-analytics-cell num', role: 'columnheader' }, 'Members'),
      h('span', { className: 'admin-analytics-cell bar', role: 'columnheader', 'aria-label': 'Relative size' }, ''),
    ));

    crews.forEach(c => {
      const count = parseInt(c.memberCount || 0, 10);
      crewTable.appendChild(h('div', { className: 'admin-analytics-row', role: 'row' },
        h('span', { className: 'admin-analytics-cell grow', role: 'cell' }, c.name || '—'),
        h('span', { className: 'admin-analytics-cell num total', role: 'cell' }, String(count)),
        h('span', { className: 'admin-analytics-cell bar', role: 'cell' }, barEl(count, maxMembers, 'var(--accent-green)', `${count} members`)),
      ));
    });
    panel.appendChild(crewTable);
  } else {
    panel.appendChild(h('p', { className: 'admin-empty-text' }, 'No crews yet.'));
  }

  // ── Festival Stats ──
  panel.appendChild(h('h3', { className: 'admin-section-title', id: 'analytics-festivals' }, 'Festival Breakdown'));
  if (festivalStats && festivalStats.length > 0) {
    const festTable = h('div', { className: 'admin-analytics-table', role: 'table', 'aria-labelledby': 'analytics-festivals' });

    festTable.appendChild(h('div', { className: 'admin-analytics-row header', role: 'row' },
      h('span', { className: 'admin-analytics-cell grow', role: 'columnheader' }, 'Festival'),
      h('span', { className: 'admin-analytics-cell num', role: 'columnheader' }, 'Profiles'),
      h('span', { className: 'admin-analytics-cell num', role: 'columnheader' }, 'Sets Picked'),
      h('span', { className: 'admin-analytics-cell num', role: 'columnheader' }, 'Total Picks'),
    ));

    festivalStats.forEach(f => {
      festTable.appendChild(h('div', { className: 'admin-analytics-row', role: 'row' },
        h('span', { className: 'admin-analytics-cell grow', role: 'cell' }, f.name || '—'),
        h('span', { className: 'admin-analytics-cell num', role: 'cell' }, String(f.profileCount || 0)),
        h('span', { className: 'admin-analytics-cell num', role: 'cell' }, String(f.uniqueSetsPicked || 0)),
        h('span', { className: 'admin-analytics-cell num total', role: 'cell' }, String(f.totalPicks || 0)),
      ));
    });
    panel.appendChild(festTable);
  } else {
    panel.appendChild(h('p', { className: 'admin-empty-text' }, 'No festival data.'));
  }

  // Generated timestamp + Refresh
  if (data.generatedAt) {
    panel.appendChild(h('p', { className: 'admin-analytics-timestamp' },
      `Generated: ${new Date(data.generatedAt).toLocaleString()}`
    ));
  }

  panel.appendChild(h('div', { style: { textAlign: 'center', marginTop: '16px' } },
    h('button', { className: 'btn btn-ghost btn-sm', 'aria-label': 'Refresh analytics', onclick: async () => {
      adminState.analyticsLoaded = false;
      await loadAnalytics(deps);
      rerender();
    } }, 'Refresh Analytics'),
  ));
}
