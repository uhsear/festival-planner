/**
 * Festival Mode — Festie
 * Optional toggle for simplified "now/next" UI during festival dates.
 * Larger touch targets, reduced chrome, focus on what's happening now.
 */
import { S } from './state.js?v=1776342458439';
import { h } from './dom.js?v=1776342458439';

let _render, _events;

// ── Auto-detect if today is a festival day ──
export function isTodayFestivalDay() {
  const days = S.currentFestival?.days || [];
  if (!days.length) return false;
  const today = new Date().toISOString().slice(0, 10);
  return days.some(d => d.date === today);
}

export function initFestivalMode(deps) {
  _render = deps.render;
  _events = deps.events;
  // Auto-enable on festival days unless user manually disabled
  const manuallyDisabled = localStorage.getItem('festie-festival-mode-disabled') === 'true';
  if (isTodayFestivalDay() && !manuallyDisabled) {
    S._festivalMode = true;
  } else {
    const saved = localStorage.getItem('festie-festival-mode');
    S._festivalMode = saved === 'true';
  }
  applyFestivalMode();
  // Refresh every 60s while in festival mode so now/next stays live
  setInterval(() => { if (S._festivalMode && _render) _render(); }, 60000);
}

export function toggleFestivalMode() {
  S._festivalMode = !S._festivalMode;
  localStorage.setItem('festie-festival-mode', S._festivalMode);
  if (!S._festivalMode) {
    localStorage.setItem('festie-festival-mode-disabled', 'true');
  } else {
    localStorage.removeItem('festie-festival-mode-disabled');
  }
  applyFestivalMode();
  _render();
}

function applyFestivalMode() {
  document.documentElement.setAttribute('data-festival-mode', S._festivalMode ? 'on' : 'off');
}

export function isFestivalMode() {
  return !!S._festivalMode;
}

/* ── Now/Next view for festival mode ── */
export function renderFestivalView() {
  const container = h('div', { className: 'festival-mode-view' });

  const festival = S.currentFestival;
  if (!festival) {
    container.appendChild(h('div', { className: 'empty-state-guide' },
      h('div', { className: 'empty-state-icon' }, '🎪'),
      h('div', { className: 'empty-state-text' }, 'No festival loaded.')
    ));
    return container;
  }

  // Header
  const header = h('div', { className: 'fm-header' });
  header.appendChild(h('div', { className: 'fm-festival-name' }, festival.name));
  header.appendChild(h('div', { className: 'fm-time' }, new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })));
  container.appendChild(header);

  // Find current and upcoming sets from user picks
  const picks = S.currentProfile?.picks || {};
  const now = Date.now();
  const allDays = festival.days || [];
  const sets = allDays.flatMap(d => (d.sets || []).filter(s => picks[s.id]));
  const withTime = sets.filter(s => s.startTime).map(s => {
    const day = allDays.find(d => (d.sets || []).some(ds => ds.id === s.id));
    if (!day?.date || !s.startTime) return null;
    const start = new Date(day.date + 'T' + s.startTime + ':00');
    const end = s.endTime ? new Date(day.date + 'T' + s.endTime + ':00') : new Date(start.getTime() + 3600000);
    return { ...s, _start: start.getTime(), _end: end.getTime(), _dayDate: day.date };
  }).filter(Boolean);

  const current = withTime.filter(s => s._start <= now && s._end > now);
  const upcoming = withTime.filter(s => s._start > now).sort((a, b) => a._start - b._start).slice(0, 5);

  // Now playing
  const nowSection = h('div', { className: 'fm-section' });
  nowSection.appendChild(h('div', { className: 'fm-section-title' }, '🔴 NOW'));
  if (current.length > 0) {
    current.forEach(s => {
      const card = h('div', { className: 'fm-set-card fm-now' });
      card.appendChild(h('div', { className: 'fm-set-name' }, s.artist || s.name));
      card.appendChild(h('div', { className: 'fm-set-stage' }, s.stage || ''));
      const endTime = new Date(s._end).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      card.appendChild(h('div', { className: 'fm-set-time' }, `until ${endTime}`));
      nowSection.appendChild(card);
    });
  } else {
    nowSection.appendChild(h('div', { className: 'fm-empty' }, 'Nothing right now'));
  }
  container.appendChild(nowSection);

  // Up next
  const nextSection = h('div', { className: 'fm-section' });
  nextSection.appendChild(h('div', { className: 'fm-section-title' }, '⏭ UP NEXT'));
  if (upcoming.length > 0) {
    upcoming.forEach(s => {
      const card = h('div', { className: 'fm-set-card' });
      card.appendChild(h('div', { className: 'fm-set-name' }, s.artist || s.name));
      const info = h('div', { className: 'fm-set-info' });
      info.appendChild(h('span', { className: 'fm-set-stage' }, s.stage || ''));
      const startTime = new Date(s._start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      info.appendChild(h('span', { className: 'fm-set-time' }, startTime));
      // Countdown
      const minsUntil = Math.round((s._start - now) / 60000);
      const countdownText = minsUntil < 60
        ? `in ${minsUntil}m`
        : `in ${Math.floor(minsUntil / 60)}h ${minsUntil % 60}m`;
      info.appendChild(h('span', { className: 'fm-countdown' }, countdownText));
      card.appendChild(info);
      nextSection.appendChild(card);
    });
  } else {
    nextSection.appendChild(h('div', { className: 'fm-empty' }, 'No upcoming picks'));
  }
  container.appendChild(nextSection);

  return container;
}

/* ── Toggle button for header ── */
export function renderFestivalModeToggle() {
  const active = isFestivalMode();
  return h('button', {
    className: `fm-toggle ${active ? 'active' : ''}`,
    onclick: (e) => { e.stopPropagation(); toggleFestivalMode(); },
    title: active ? 'Exit Festival Mode' : 'Enter Festival Mode',
    'aria-label': active ? 'Festival mode on' : 'Festival mode off',
    'aria-pressed': active ? 'true' : 'false',
    type: 'button',
  }, active ? '🎪' : '🎪');
}
