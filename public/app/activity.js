/**
 * Activity Feed — Festie
 * Live stream of crew actions in crew view.
 */
import { S } from './state.js?v=1776342458439';
import { h } from './dom.js?v=1776342458439';

let _api, _toast, _render, _events;


const ACTIVITY_ICONS = {
  pick_added: '🎵', pick_removed: '✕', expense_added: '💰',
  member_joined: '👋', member_left: '🚪', poll_created: '📊',
  poll_voted: '✓', rating_added: '⭐', expense_settled: '✅',
};

const ACTIVITY_LABELS = {
  pick_added: 'added a pick', pick_removed: 'removed a pick',
  expense_added: 'added an expense', member_joined: 'joined the crew',
  member_left: 'left the crew', poll_created: 'created a poll',
  poll_voted: 'voted on a poll', rating_added: 'rated a set',
  expense_settled: 'settled up',
};
export function initActivity(deps) {
  _api = deps.api;
  _toast = deps.toast;
  _render = deps.render;
  _events = deps.events;
}


export async function loadActivity(crewId) {
  try {
    S._crewActivity = await _api(`/crews/${crewId}/activity`);
  } catch (_e) {
    S._crewActivity = [];
  }
}

export function pushActivity(item) {
  if (!S._crewActivity) S._crewActivity = [];
  S._crewActivity = [item, ...S._crewActivity].slice(0, 50);
}

export function renderActivityTab(deps) {
  const { crewId } = deps;
  const container = h('div', { className: 'activity-container' });

  const items = S._crewActivity || [];
  if (items.length === 0) {
    container.appendChild(h('div', { className: 'empty-state-guide' },
      h('div', { className: 'empty-state-icon' }, '📡'),
      h('div', { className: 'empty-state-text' }, 'No crew activity yet. Actions by crew members will appear here.')
    ));
    return container;
  }

  items.forEach(item => {
    const row = h('div', { className: 'activity-item' });
    const icon = ACTIVITY_ICONS[item.type] || '•';
    const label = ACTIVITY_LABELS[item.type] || item.type;

    row.appendChild(h('span', { className: 'activity-icon' }, icon));
    const body = h('div', { className: 'activity-body' });
    body.appendChild(h('span', { className: 'activity-user' }, item.username || 'Someone'));
    body.appendChild(h('span', { className: 'activity-label' }, ` ${label}`));
    if (item.detail) {
      body.appendChild(h('span', { className: 'activity-detail' }, ` — ${item.detail}`));
    }
    row.appendChild(body);

    const d = new Date(item.created_at);
    const timeStr = timeAgo(d);
    row.appendChild(h('span', { className: 'activity-time' }, timeStr));
    container.appendChild(row);
  });

  return container;
}

function timeAgo(date) {
  const s = Math.floor((Date.now() - date.getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}
