/**
 * Copyright (c) 2026 Asir Khan. All rights reserved.
 * Licensed under the Business Source License 1.1. See LICENSE file for details.
 */

/**
 * Admin panel shell — tab switching, overlay management, shared helpers.
 * Sub-modules: dashboard.js, users.js, festivals.js, crews.js, analytics.js, audit.js
 */

import { S, adminState } from '../../app/state.js?v=1776342458439';
import { $, $$, h } from '../../app/dom.js?v=1776342458439';
import { loadDashboard, renderDashboard } from './dashboard.js?v=1776342458439';
import { loadAdminUsers, renderAdminUserList } from './users.js?v=1776342458439';
import { renderAdminFestivalList, renderAdminFestivalEditor } from './festivals.js?v=1776342458439';
import { loadAdminCrews, renderAdminCrews } from './crews.js?v=1776342458439';
import { loadAnalytics, renderAnalytics } from './analytics.js?v=1776342458439';
import { loadAuditLog, renderAuditLog } from './audit.js?v=1776342458439';

// ── Shared helpers (used by sub-modules via enriched deps) ─────

export function styledConfirm(message, { confirmLabel = 'Confirm', confirmClass = 'btn btn-danger', cancelLabel = 'Cancel' } = {}) {
  return new Promise((resolve) => {
    const ov = h('div', { className: 'admin-confirm-overlay' });
    const box = h('div', { className: 'admin-confirm-box' });
    box.appendChild(h('p', { className: 'admin-confirm-msg' }, message));
    const row = h('div', { className: 'btn-row' });
    row.appendChild(h('button', { className: 'btn btn-ghost', onclick: () => { ov.remove(); resolve(false); } }, cancelLabel));
    row.appendChild(h('button', { className: confirmClass, onclick: () => { ov.remove(); resolve(true); } }, confirmLabel));
    box.appendChild(row);
    ov.appendChild(box);
    ov.addEventListener('click', e => { if (e.target === ov) { ov.remove(); resolve(false); } });
    ov.addEventListener('keydown', e => { if (e.key === 'Escape') { ov.remove(); resolve(false); } });
    document.body.appendChild(ov);
    box.querySelector(`.${confirmClass.split(' ').pop()}`).focus();
  });
}

export function harvestEditorFields(fest) {
  const nameField = $('#adminFestName');
  const locField = $('#adminFestLocation');
  const sepField = $('#adminFestB2bSeparator');
  if (nameField) fest.name = nameField.value;
  if (locField) fest.location = locField.value;
  if (sepField) fest.b2bSeparator = sepField.value || '';
  $$('#adminStages .admin-stage-row').forEach((row, i) => {
    if (fest.stages[i]) {
      const nameInput = row.querySelector('[data-field="name"]');
      const colorInput = row.querySelector('[data-field="color"]');
      if (nameInput) fest.stages[i].name = nameInput.value;
      if (colorInput) fest.stages[i].color = colorInput.value;
    }
  });
  $$('[data-dayfield]').forEach(inp => {
    const di = parseInt(inp.dataset.dayindex);
    if (fest.days[di]) fest.days[di][inp.dataset.dayfield] = inp.value;
  });
  // Collect set fields — handle nested paths like artists[0].name, artists[1].links.spotify
  $$('[data-setfield]').forEach(inp => {
    const di = parseInt(inp.dataset.di),
      si = parseInt(inp.dataset.si);
    const set = fest.days[di]?.sets?.[si];
    if (!set) return;
    const field = inp.dataset.setfield;
    // Flat fields (stageId, startTime, endTime)
    if (!field.startsWith('artists[')) { set[field] = inp.value; return; }
    // Parse artists[N].name or artists[N].links.platform or artists[N].links._platform_*
    const m = field.match(/^artists\[(\d+)]\.(.+)$/);
    if (!m) return;
    const ai = parseInt(m[1]);
    const rest = m[2]; // "name" | "links.spotify" | "links._platform_spotify"
    if (!set.artists) set.artists = [];
    while (set.artists.length <= ai) set.artists.push({ name: '', links: {} });
    if (rest === 'name') {
      set.artists[ai].name = inp.value;
    } else if (rest.startsWith('links._platform_')) {
      // Platform selector — rename the key if changed
      const oldPlatform = rest.replace('links._platform_', '');
      const newPlatform = inp.value;
      if (oldPlatform !== newPlatform && set.artists[ai].links) {
        const url = set.artists[ai].links[oldPlatform] || '';
        delete set.artists[ai].links[oldPlatform];
        set.artists[ai].links[newPlatform] = url;
      }
    } else if (rest.startsWith('links.')) {
      const platform = rest.replace('links.', '');
      if (!set.artists[ai].links) set.artists[ai].links = {};
      set.artists[ai].links[platform] = inp.value;
    }
  });
  // Dual-write: compute flat artist + linkUrl from artists array for backward compat
  (fest.days || []).forEach(d => (d.sets || []).forEach(set => {
    if (set.artists?.length) {
      const sep = fest.b2bSeparator || fest.b2bseparator || 'b2b';
      set.artist = set.artists.map(a => a.name).join(` ${sep} `);
      set.linkUrl = set.artists[0]?.links?.spotify || '';
    }
  }));
  return fest;
}

// ── Panel open/close ───────────────────────────────────────────

export function openAdminPanel(deps) {
  if (!S.isAdmin) return;
  adminState.trigger = document.activeElement;
  adminState.open = true;
  if (!adminState.tab) adminState.tab = 'dashboard';
  renderAdminOverlay(deps);
}

export function renderAdminOverlay(deps) {
  const { api, adminApi, toast, render, trapFocus } = deps;
  let ov = document.querySelector('.admin-overlay');
  if (ov) ov.remove();
  if (!adminState.open) return;

  // Enrich deps with shared helpers + rerender for sub-modules
  const adminDeps = { ...deps, styledConfirm, harvestEditorFields, rerender: () => renderAdminOverlay(deps) };

  ov = h('div', {
    className: 'admin-overlay open',
    role: 'dialog',
    'aria-modal': 'true',
    'aria-labelledby': 'admin-panel-title',
  });
  const panel = h('div', { className: 'admin-panel', role: 'region', 'aria-label': 'Admin panel' });
  const ph = h('div', { className: 'flex items-center justify-between mb-2' });
  ph.appendChild(h('h2', { id: 'admin-panel-title' }, 'Admin Panel'));
  const hb = h('div', { className: 'flex gap-2' });
  hb.appendChild(
    h('button', {
      className: 'btn btn-ghost btn-sm',
      onclick: () => {
        adminState.open = false;
        const _t1 = adminState.trigger;
        adminState.trigger = null;
        ov.remove();
        if (_t1 && typeof _t1.focus === 'function') requestAnimationFrame(() => _t1.focus());
      },
    }, '× Close')
  );
  ph.appendChild(hb);
  panel.appendChild(ph);

  // Tabs
  const tabs = h('div', {
    className: 'admin-tabs',
    role: 'tablist',
    'aria-label': 'Admin sections',
  });
  [
    ['dashboard', 'Dashboard'],
    ['festivals', 'Festivals'],
    ['create', 'Create/Edit'],
    ['users', 'Users'],
    ['crews', 'Crews'],
    ['analytics', 'Analytics'],
    ['audit', 'Audit Log'],
  ].forEach(([t, l]) => {
    const isActive = adminState.tab === t;
    tabs.appendChild(
      h('button', {
        className: 'admin-tab' + (isActive ? ' active' : ''),
        role: 'tab',
        id: `admin-tab-${t}`,
        'aria-selected': isActive ? 'true' : 'false',
        'aria-controls': `admin-tabpanel-${t}`,
        tabindex: isActive ? '0' : '-1',
        onclick: async () => {
          if (adminState.tab === 'create' && adminState.editFestival) harvestEditorFields(adminState.editFestival);
          adminState.tab = t;
          if (t === 'users') await loadAdminUsers(adminDeps);
          if (t === 'dashboard') await loadDashboard(adminDeps);
          if (t === 'crews') await loadAdminCrews(adminDeps);
          if (t === 'analytics') await loadAnalytics(adminDeps);
          if (t === 'audit') await loadAuditLog(adminDeps);
          renderAdminOverlay(deps);
        },
      }, l)
    );
  });
  panel.appendChild(tabs);

  // Tab content — wrap active panel in a tabpanel region
  const tabpanel = h('div', {
    className: 'admin-tabpanel',
    role: 'tabpanel',
    id: `admin-tabpanel-${adminState.tab}`,
    'aria-labelledby': `admin-tab-${adminState.tab}`,
    tabindex: '0',
  });
  if (adminState.tab === 'dashboard') renderDashboard(tabpanel, adminDeps);
  else if (adminState.tab === 'festivals') renderAdminFestivalList(tabpanel, adminDeps);
  else if (adminState.tab === 'create') renderAdminFestivalEditor(tabpanel, adminDeps);
  else if (adminState.tab === 'users') renderAdminUserList(tabpanel, adminDeps);
  else if (adminState.tab === 'crews') renderAdminCrews(tabpanel, adminDeps);
  else if (adminState.tab === 'analytics') renderAnalytics(tabpanel, adminDeps);
  else if (adminState.tab === 'audit') renderAuditLog(tabpanel, adminDeps);
  panel.appendChild(tabpanel);

  ov.appendChild(panel);
  ov.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      adminState.open = false;
      const _t2 = adminState.trigger;
      adminState.trigger = null;
      ov.remove();
      if (_t2 && typeof _t2.focus === 'function') requestAnimationFrame(() => _t2.focus());
    }
  });
  requestAnimationFrame(() => { trapFocus(panel); const _fc = panel.querySelector('.btn-ghost.btn-sm'); if (_fc) _fc.focus(); });
  document.body.appendChild(ov);
}
