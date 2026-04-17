/**
 * Grid View — Schedule conflict grid layout
 * X-axis = stages (columns)
 * Y-axis = 30-minute time slots (rows)
 */

import { S } from '../app/state.js?v=1776342458439';
import { h } from '../app/dom.js?v=1776342458439';
import { formatTime, getAvatarColor, artistDisplayName } from '../app/helpers.js?v=1776342458439';

const COLOR_MAP = {
  'must': 'var(--accent-coral)',
  'want-to-see': 'var(--accent-aqua)',
  'maybe': 'var(--accent-amber)',
  'none': 'var(--bg-secondary)',
};

function timeToMinutes(time) {
  if (!time) return 0;
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

function getTimeSlotIndex(startTime, earliestTime) {
  const startMin = timeToMinutes(startTime);
  const earliestMin = timeToMinutes(earliestTime);
  return Math.floor((startMin - earliestMin) / 30);
}

export function renderGrid(deps) {
  const { getDays, getStages, filteredSets, getMyPick, getStageColor, getStageName, getConflicts, render, S: appState } = deps;

  const container = h('div', { className: 'grid-view-container', role: 'region', 'aria-label': 'Festival set grid' });

  if (!appState.user) {
    const t = h('div', { className: 'guest-teaser' });
    t.appendChild(h('div', { className: 'empty-state-icon', 'aria-hidden': 'true' }, '⏱'));
    t.appendChild(h('h2', { style: { margin: '12px 0 8px', fontSize: '18px', color: 'var(--text-primary)' } }, 'See the whole schedule at a glance'));
    t.appendChild(h('p', { style: { color: 'var(--text-secondary)', fontSize: '14px', maxWidth: '300px', margin: '0 auto 16px' } }, 'Grid view shows every stage and set across the festival. Sign in to track conflicts and plan your day.'));
    t.appendChild(h('button', { className: 'btn btn-primary', type: 'button', onclick: () => { appState.authMode = 'register'; if (deps.render) deps.render(); } }, 'Sign Up Free'));
    container.appendChild(t);
    return container;
  }

  if (!appState.currentFestival) {
    container.appendChild(h('p', {}, 'No festival selected'));
    return container;
  }

  const days = getDays();
  const stages = getStages();
  const sets = filteredSets();

  if (!sets.length || !stages.length) {
    container.appendChild(h('p', {}, 'No sets or stages'));
    return container;
  }

  // Find earliest and latest times
  let earliestTime = '23:59';
  let latestTime = '00:00';
  sets.forEach(set => {
    if (set.startTime) {
      const start = timeToMinutes(set.startTime);
      const earliest = timeToMinutes(earliestTime);
      if (start < earliest) earliestTime = set.startTime;
    }
    if (set.endTime) {
      const end = timeToMinutes(set.endTime);
      const latest = timeToMinutes(latestTime);
      if (end > latest) latestTime = set.endTime;
    }
  });

  const earliestMin = timeToMinutes(earliestTime);
  const latestMin = timeToMinutes(latestTime);
  const totalSlots = Math.ceil((latestMin - earliestMin) / 30);

  // Generate time slots
  const timeSlots = [];
  for (let i = 0; i < totalSlots; i++) {
    const minFromStart = earliestMin + (i * 30);
    const h_val = Math.floor(minFromStart / 60);
    const m_val = minFromStart % 60;
    const timeStr = String(h_val).padStart(2, '0') + ':' + String(m_val).padStart(2, '0');
    timeSlots.push(timeStr);
  }

  // Build grid layout
  const grid = h('div', { className: 'grid-schedule', 'aria-label': 'Schedule by stage and time' });
  const style = document.createElement('style');
  style.textContent = `
    .grid-schedule {
      display: grid;
      grid-template-columns: 60px repeat(${stages.length}, 1fr);
      gap: 1px;
      background: var(--border);
      padding: 10px;
      overflow-x: auto;
    }
    .grid-time-col {
      position: sticky;
      left: 0;
      z-index: 10;
      background: var(--bg-primary);
      font-size: 12px;
      font-weight: 600;
      padding: 8px;
      border-right: 2px solid var(--border);
    }
    .grid-stage-header {
      position: sticky;
      top: 0;
      z-index: 9;
      background: var(--bg-primary);
      font-weight: 600;
      padding: 10px;
      text-align: center;
      border-bottom: 2px solid var(--border);
      font-size: 13px;
    }
    .grid-cell {
      background: var(--bg-card);
      min-height: 40px;
      position: relative;
    }
    .grid-set {
      position: absolute;
      left: 2px;
      right: 2px;
      cursor: pointer;
      padding: 6px;
      border-radius: 4px;
      font-size: 11px;
      font-weight: 600;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      border-left: 4px solid;
    }
    .grid-set:hover {
      opacity: 0.9;
    }
  `;
  grid.appendChild(style);

  // Add stage headers
  const headerRow = h('div', { style: { display: 'contents' }, role: 'row' });
  headerRow.appendChild(h('div', { className: 'grid-stage-header', role: 'columnheader', 'aria-label': 'Time' }, ''));
  stages.forEach(stage => {
    headerRow.appendChild(h('div', {
      className: 'grid-stage-header',
      role: 'columnheader',
      style: { background: getStageColor(stage.id) + '15' }
    }, getStageName(stage.id)));
  });
  grid.appendChild(headerRow);

  // Add time slots and sets
  timeSlots.forEach((timeStr, slotIdx) => {
    // Time column
    grid.appendChild(h('div', { className: 'grid-time-col', role: 'rowheader' }, formatTime(timeStr)));

    // Stage columns
    stages.forEach(stage => {
      const cell = h('div', { className: 'grid-cell', role: 'gridcell' });

      // Find sets in this time slot and stage
      sets.forEach(set => {
        if (set.stageId !== stage.id) return;
        if (!set.startTime) return;

        const setSlot = getTimeSlotIndex(set.startTime, earliestTime);
        if (setSlot !== slotIdx) return;

        // Calculate span (how many rows this set spans)
        const durationMin = (timeToMinutes(set.endTime || set.startTime) - timeToMinutes(set.startTime)) / 30;
        const span = Math.max(1, Math.ceil(durationMin));

        const myPick = getMyPick(set.id) || 'none';
        const pickColor = COLOR_MAP[myPick] || COLOR_MAP['none'];

        const setLabel = artistDisplayName(set, appState.currentFestival?.b2bSeparator);
        const setEl = h('div', {
          className: 'grid-set',
          role: 'button',
          tabindex: '0',
          'aria-label': `${setLabel} at ${getStageName(stage.id)}, ${formatTime(set.startTime)}${set.endTime ? ' to ' + formatTime(set.endTime) : ''}${myPick !== 'none' ? ', ' + myPick : ''}`,
          style: {
            background: pickColor + '40',
            borderLeftColor: pickColor,
            top: '2px',
            height: (span * 40 - 4) + 'px',
          },
          onkeydown: (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              appState.detailSet = set;
              appState.detailSetTrigger = setEl;
              render();
            }
          },
          onclick: () => {
            appState.detailSet = set;
            appState.detailSetTrigger = setEl;
            render();
          },
        }, setLabel);

        cell.appendChild(setEl);
      });

      grid.appendChild(cell);
    });
  });

  container.appendChild(grid);
  return container;
}

