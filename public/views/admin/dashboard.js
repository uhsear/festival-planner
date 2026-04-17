/**
 * Copyright (c) 2026 Asir Khan. All rights reserved.
 * Licensed under the Business Source License 1.1. See LICENSE file for details.
 */

/**
 * Admin dashboard — stats cards, system health, activity feed
 */

import { adminState } from '../../app/state.js?v=1776342458439';
import { h } from '../../app/dom.js?v=1776342458439';

// ── Helpers ────────────────────────────────────────────────────

function spinner(text = 'Loading...') {
  return h('div', { className: 'admin-loading' },
    h('div', { className: 'admin-spinner' }),
    h('span', {}, text),
  );
}

function formatUptime(seconds) {
  const d = Math.floor(seconds / 86400);
  const hr = Math.floor((seconds % 86400) / 3600);
  const mn = Math.floor((seconds % 3600) / 60);
  const sc = seconds % 60;
  if (d > 0) return `${d}d ${hr}h ${mn}m`;
  if (hr > 0) return `${hr}h ${mn}m`;
  if (mn > 0) return `${mn}m`;
  return `${sc}s`;
}

function formatTimeAgo(dateStr) {
  const diff = (Date.now() - new Date(dateStr).getTime()) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

// ── Dashboard ──────────────────────────────────────────────────

export async function loadDashboard(deps) {
  const { adminApi, toast } = deps;
  try {
    adminState.dashboardData = await adminApi('/admin/dashboard');
    adminState.dashboardLoaded = true;
  } catch (e) {
    toast('Failed to load dashboard', 'error');
    adminState.dashboardData = null;
  }
}

export function renderDashboard(panel, deps) {
  const { rerender } = deps;
  const data = adminState.dashboardData;
  if (!data) {
    if (!adminState.dashboardLoaded) {
      loadDashboard(deps).then(() => rerender());
      panel.appendChild(spinner('Loading dashboard...'));
      return;
    }
    panel.appendChild(h('p', { style: { color: 'var(--text-muted)', textAlign: 'center', padding: '20px' } }, 'Dashboard data unavailable.'));
    return;
  }

  const { stats, health, groupedActivity, recentActivity } = data;

  // Stats cards
  const grid = h('div', { className: 'admin-dash-grid', role: 'region', 'aria-label': 'Dashboard statistics' });
  const cards = [
    { label: 'Users', value: stats.users, icon: '👥', color: 'var(--accent-aqua)', tab: 'users' },
    { label: 'Festivals', value: stats.festivals, icon: '🎪', color: 'var(--accent-coral)', tab: 'festivals' },
    { label: 'Profiles', value: stats.profiles, icon: '📋', color: 'var(--accent-amber)', tab: null },
    { label: 'Total Picks', value: stats.picks, icon: '🎵', color: 'var(--accent-green)', tab: null },
  ];
  cards.forEach(c => {
    const card = h('div', {
      className: 'admin-stat-card' + (c.tab ? ' admin-stat-clickable' : ''),
      onclick: c.tab ? async () => {
        adminState.tab = c.tab;
        if (c.tab === 'users') await deps.loadAdminUsers?.(deps) || null;
        rerender();
      } : null,
      title: c.tab ? `Go to ${c.label}` : '',
    },
      h('div', { className: 'admin-stat-icon', style: { color: c.color } }, c.icon),
      h('div', { className: 'admin-stat-value', style: { color: c.color } }, String(c.value)),
      h('div', { className: 'admin-stat-label' }, c.label),
    );
    grid.appendChild(card);
  });
  panel.appendChild(grid);

  // System health
  panel.appendChild(h('h3', { className: 'admin-section-title' }, 'System Health'));
  const healthGrid = h('div', { className: 'admin-health-grid' });
  const healthItems = [
    { label: 'Uptime', value: formatUptime(health.uptime) },
    { label: 'Memory (RSS)', value: `${health.memory.rss} MB` },
    { label: 'Heap Used', value: `${health.memory.heapUsed} / ${health.memory.heapTotal} MB` },
    { label: 'WebSocket Conns', value: String(health.connections) },
    { label: 'Online Rooms', value: String(health.onlineRooms) },
  ];
  if (health.database) {
    healthItems.push(
      { label: 'DB Pool (active/idle/waiting)', value: `${health.database.totalCount - health.database.idleCount}/${health.database.idleCount}/${health.database.waitingCount}` },
    );
  }
  healthItems.forEach(item => {
    healthGrid.appendChild(h('div', { className: 'admin-health-item' },
      h('span', { className: 'admin-health-label' }, item.label),
      h('span', { className: 'admin-health-value' }, item.value),
    ));
  });
  panel.appendChild(healthGrid);

  // Activity feed
  panel.appendChild(h('h3', { className: 'admin-section-title' }, 'Recent Activity'));
  const activityList = groupedActivity || recentActivity || [];
  if (activityList.length === 0) {
    panel.appendChild(h('p', { style: { color: 'var(--text-muted)', fontSize: '13px' } }, 'No recent activity.'));
  } else {
    const feed = h('div', { className: 'admin-activity-feed' });
    activityList.slice(0, 15).forEach(a => {
      const who = a.actorUsername || a.details?.targetUsername || a.actorId || 'system';
      const actionLabel = a.friendlyAction || a.action?.replace(/[_:]/g, ' ') || 'Unknown';
      const countBadge = (a.count && a.count > 1)
        ? h('span', { className: 'admin-activity-count' }, ` × ${a.count}`)
        : null;
      feed.appendChild(h('div', { className: 'admin-activity-item' },
        h('div', { className: 'admin-activity-dot' }),
        h('div', { className: 'admin-activity-content' },
          h('span', { className: 'admin-activity-action' }, actionLabel),
          countBadge,
          h('span', { className: 'admin-activity-who' }, who),
        ),
        h('div', { className: 'admin-activity-time' }, formatTimeAgo(a.createdAt)),
      ));
    });
    panel.appendChild(feed);
  }

  // Refresh
  panel.appendChild(h('div', { style: { textAlign: 'center', marginTop: '16px' } },
    h('button', { className: 'btn btn-ghost btn-sm', onclick: async () => {
      await loadDashboard(deps);
      rerender();
    } }, 'Refresh Dashboard'),
  ));
}
