/**
 * Timeline view — renders sets organized by stage and time slots
 * Dependencies: state (S, PRI_MAP), DOM helpers (h), and shared utilities
 */

import { getConflictingSetIds } from '../app/conflicts.js?v=1776342458439';
import { S, PRI_MAP } from '../app/state.js?v=1776342458439';
import { h } from '../app/dom.js?v=1776342458439';
import {
  formatTime,
  timeToMinutes,
  getAvatarColor,
  getInitials,
  artistDisplayName,
  artistSubtitle,
} from '../app/helpers.js?v=1776342458439';

/**
 * renderTimeline - Main timeline view renderer
 * Uses filteredSets(), getDays(), getMyPick(), getOtherPicks(),
 * createAvatar(), savePick(), and render() from app.js
 */
export function renderTimeline(deps = {}) {
  const { filteredSets, getDays, getMyPick, getOtherPicks, createAvatar, savePick, render, dayIsToday } = deps;
  const container = h('div', { className: 'timeline-container', role: 'region', 'aria-label': 'Timeline view' });
  const allSets = filteredSets();
  const sets = allSets.filter(s => s.startTime && s.endTime);
  const timelessSets = allSets.filter(s => !s.startTime || !s.endTime)
    .sort((a, b) => artistDisplayName(a,S.currentFestival?.b2bSeparator).localeCompare(artistDisplayName(b,S.currentFestival?.b2bSeparator), undefined, { sensitivity: 'base' }));
  if (!allSets.length) {
    container.appendChild(
      h(
        'div',
        { className: 'no-festival' },
        h('p', {}, 'No sets to display.')
      )
    );
    return container;
  }
  // Default: if no stages selected, show all stages (prevents broken empty state on first load)
  const allStages = S.currentFestival?.stages || [];
  if (!S.activeStages || !S.activeStages.length) {
    S.activeStages = allStages.map((st) => st.id);
  }
  const stages = allStages.filter((st) => S.activeStages.includes(st.id));
  if (!stages.length) {
    container.appendChild(
      h(
        'div',
        { className: 'no-festival' },
        h('p', {}, 'No stages selected.')
      )
    );
    return container;
  }
  let minMin = 24 * 60,
    maxMin = 0;
  sets.forEach((s) => {
    const start = timeToMinutes(s.startTime);
    let end = timeToMinutes(s.endTime);
    if (end <= start) end += 24 * 60;
    if (start < minMin) minMin = start;
    if (end > maxMin) maxMin = end;
  });
  const SLOT = 15;
  minMin = Math.floor(minMin / SLOT) * SLOT;
  maxMin = Math.ceil(maxMin / SLOT) * SLOT;
  const totalSlots = (maxMin - minMin) / SLOT;
  if (sets.length === 0 || totalSlots <= 0 || totalSlots > 200) {
  const _conflictIds = getConflictingSetIds(sets, getMyPick);
    // Skip grid if no timed sets — TBA section renders below
    if (timelessSets.length > 0) {
      const tbaOnly = h('div', { className: 'timeline-tba-section' });
      tbaOnly.appendChild(h('div', { className: 'timeline-tba-header' }, 'TBA \u2014 Times Not Yet Announced'));
      const tbaGrid = h('div', { className: 'timeline-tba-grid' });
      timelessSets.forEach(s => {
        const myPick = getMyPick(s.id);
        const stage = (S.currentFestival?.stages || []).find(st => st.id === s.stageId);
        const priClass = myPick ? ' priority-' + (PRI_MAP[myPick] || '') : '';
        const conflictClass = (myPick && _conflictIds.has(s.id)) ? ' has-conflict' : '';
        const card = h('div', {
          className: 'timeline-tba-card' + priClass,
          style: stage ? { borderLeft: '3px solid ' + stage.color } : {},
          role: 'button', tabindex: '0',
          onclick: () => { S.detailSetTrigger = card; S.detailSet = s; render(); },
        });
        card.appendChild(h('div', { className: 'set-artist' }, artistDisplayName(s,S.currentFestival?.b2bSeparator)));
        const _tbaSub=artistSubtitle(s,S.currentFestival?.b2bSeparator);
        if (_tbaSub) card.appendChild(h('div', { className: 'set-artist-sub' }, _tbaSub));
        if (stage) card.appendChild(h('span', { className: 'pick-stage', style: { background: stage.color + '25', color: stage.color, fontSize: '11px' } }, stage.name));
        tbaGrid.appendChild(card);
      });
      tbaOnly.appendChild(tbaGrid);
      container.appendChild(tbaOnly);
      return container;
    }
    container.appendChild(h('div', { className: 'no-festival' }, h('p', {}, 'Invalid time range.')));
    return container;
  }
  const grid = h(
    'div',
    {
      className: 'timeline-grid',
      style: {
        gridTemplateColumns: `70px repeat(${stages.length},minmax(140px,1fr))`,
        gridTemplateRows: `auto repeat(${totalSlots},36px)`,
      },
      role: 'grid',
      'aria-label': 'Timeline view of festival sets by stage and time',
    }
  );
  grid.appendChild(
    h(
      'div',
      {
        className: 'timeline-header-cell',
        style: { background: 'var(--bg-primary)' },
        role: 'columnheader',
      },
      ''
    )
  );
  stages.forEach((st) => {
    grid.appendChild(
      h(
        'div',
        {
          className: 'timeline-header-cell',
          style: {
            borderBottom: `3px solid ${st.color}`,
            color: st.color,
          },
          role: 'columnheader',
        },
        st.name
      )
    );
  });
  for (let i = 0; i < totalSlots; i++) {
    const mins = minMin + i * SLOT;
    const hh = Math.floor(mins / 60) % 24;
    const mm = mins % 60;
    const show = mm === 0 || mm === 30;
    grid.appendChild(
      h(
        'div',
        {
          className: 'timeline-time-cell',
          style: {
            gridRow: i + 2,
            gridColumn: 1,
            borderBottom:
              mm === 0
                ? '1px solid var(--border-light)'
                : '1px solid var(--border)',
          },
        },
        show ? formatTime(`${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`) : ''
      )
    );
  }
  stages.forEach((st, ci) => {
    for (let i = 0; i < totalSlots; i++) {
      const mins = minMin + i * SLOT;
      const mm = mins % 60;
      grid.appendChild(
        h('div', {
          className: 'timeline-cell',
          style: {
            gridRow: i + 2,
            gridColumn: ci + 2,
            borderBottom:
              mm === 0
                ? '1px solid var(--border-light)'
                : '1px solid var(--border)',
          },
        })
      );
    }
    sets
      .filter((s) => s.stageId === st.id)
      .forEach((s) => {
        const startMin = timeToMinutes(s.startTime);
        let endMin = timeToMinutes(s.endTime);
        if (endMin <= startMin) endMin += 24 * 60;
        const topSlot = (startMin - minMin) / SLOT;
        const spanSlots = (endMin - startMin) / SLOT;
        const myPick = getMyPick(s.id);
        const others = getOtherPicks(s.id);
        const priClass = myPick ? ' priority-' + (PRI_MAP[myPick] || '') : '';
        const conflictClass = (myPick && _conflictIds.has(s.id)) ? ' has-conflict' : '';
        const setEl = h(
          'div',
          {
            className: 'timeline-set' + priClass + conflictClass,
            style: {
              gridRow: `${Math.floor(topSlot) + 2} / span ${Math.max(1, Math.ceil(spanSlots))}`,
              gridColumn: ci + 2,
              background: st.color + '20',
              position: 'relative',
              top: '1px',
              left: '2px',
              right: '2px',
              minHeight: 'auto',
              height: 'calc(100% - 2px)',
            },
            'data-set-id': s.id,
            role: 'button',
            tabindex: '0',
            'aria-label': `${artistDisplayName(s,S.currentFestival?.b2bSeparator)} at ${st.name}, ${formatTime(s.startTime)}-${formatTime(s.endTime)}${myPick ? ', priority: ' + myPick : ''}`,
            onclick: () => {
              S.detailSetTrigger = setEl;
              S.detailSet = s;
              render();
            },
            onkeydown: (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                S.detailSetTrigger = setEl;
                S.detailSet = s;
                render();
              }
            },
          }
        );
        const _dn=artistDisplayName(s,S.currentFestival?.b2bSeparator);
        setEl.appendChild(h('div', { className: 'set-artist', title: _dn }, _dn));
        const _tsub=artistSubtitle(s,S.currentFestival?.b2bSeparator);
        if (_tsub && spanSlots >= 3) setEl.appendChild(h('div', { className: 'set-artist-sub', title: _tsub }, _tsub));
        if (spanSlots >= 2)
          setEl.appendChild(
            h(
              'div',
              { className: 'set-time' },
              formatTime(s.startTime) + ' - ' + formatTime(s.endTime)
            )
          );
        if (S.currentProfile && spanSlots >= 2) {
          const tpg = h('div', { className: 'timeline-pick-group' });
          [
            ['must', '★'],
            ['want-to-see', '◆'],
            ['maybe', '●'],
          ].forEach(([p, icon]) => {
            const active = myPick === p;
            tpg.appendChild(
              h(
                'button',
                {
                  className:
                    'timeline-pick-btn' + (active ? ' active-' + PRI_MAP[p] : ''),
                  type: 'button',
                  'aria-pressed': active ? 'true' : 'false',
                  'aria-label':
                    (p === 'must'
                      ? 'Must See'
                      : p === 'want-to-see'
                        ? 'Want to See'
                        : 'Maybe') + (active ? ' (selected)' : ''),
                  title:
                    p === 'must'
                      ? 'Must See'
                      : p === 'want-to-see'
                        ? 'Want to See'
                        : 'Maybe',
                  onclick: (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    savePick(s.id, active ? null : p);
                  },
                },
                icon
              )
            );
          });
          setEl.appendChild(tpg);
        }
        if (others.length > 0) {
          const ov = h('div', { className: 'set-overlap' });
          others.slice(0, 3).forEach((o) =>
            ov.appendChild(
              createAvatar(o, {
                className: 'mini-avatar',
                size: 16,
                fontSize: 7,
                title: o.name + ' (' + o.priority + ')',
              })
            )
          );
          setEl.appendChild(ov);
        }
        grid.appendChild(setEl);
      });
  });
  // Now-indicator line
  const day = getDays()[S.selectedDay];
  if (day && dayIsToday(day)) {
    const now = new Date();
    const nowMins = now.getHours() * 60 + now.getMinutes();
    if (nowMins >= minMin && nowMins <= maxMin) {
      const pct = ((nowMins - minMin) / (maxMin - minMin)) * 100;
      const nowLine = h('div', {
        className: 'timeline-now-line',
        style: { top: `calc(${pct}% + 38px)` },
      });
      nowLine.appendChild(h('div', { className: 'timeline-now-dot' }));
      grid.style.position = 'relative';
      grid.appendChild(nowLine);
    }
  }
  container.appendChild(grid);

  // TBA section for sets without times
  if (timelessSets.length > 0) {
    const tbaSection = h('div', { className: 'timeline-tba-section' });
    tbaSection.appendChild(h('div', { className: 'timeline-tba-header' }, 'TBA — Times Not Yet Announced'));
    const tbaGrid = h('div', { className: 'timeline-tba-grid' });
    timelessSets.forEach(s => {
      const myPick = getMyPick(s.id);
      const others = getOtherPicks(s.id);
      const stage = (S.currentFestival?.stages || []).find(st => st.id === s.stageId);
      const priClass = myPick ? ' priority-' + (PRI_MAP[myPick] || '') : '';
      const card = h('div', {
        className: 'timeline-tba-card' + priClass,
        style: stage ? { borderLeft: '3px solid ' + stage.color } : {},
        role: 'button', tabindex: '0',
        'aria-label': artistDisplayName(s,S.currentFestival?.b2bSeparator) + (stage ? ' at ' + stage.name : '') + ', time TBA' + (myPick ? ', priority: ' + myPick : ''),
        onclick: () => { S.detailSetTrigger = card; S.detailSet = s; render(); },
        onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); S.detailSetTrigger = card; S.detailSet = s; render(); } },
      });
      card.appendChild(h('div', { className: 'set-artist' }, s.artist));
      if (stage) card.appendChild(h('span', { className: 'pick-stage', style: { background: stage.color + '25', color: stage.color, fontSize: '11px' } }, stage.name));
      if (S.currentProfile) {
        const tpg = h('div', { className: 'timeline-pick-group' });
        [['must', '★'], ['want-to-see', '◆'], ['maybe', '●']].forEach(([p, icon]) => {
          const active = myPick === p;
          tpg.appendChild(h('button', {
            className: 'timeline-pick-btn' + (active ? ' active-' + PRI_MAP[p] : ''),
            type: 'button', 'aria-pressed': active ? 'true' : 'false',
            'aria-label': (p === 'must' ? 'Must See' : p === 'want-to-see' ? 'Want to See' : 'Maybe') + (active ? ' (selected)' : ''),
            onclick: (e) => { e.preventDefault(); e.stopPropagation(); savePick(s.id, active ? null : p); },
          }, icon));
        });
        card.appendChild(tpg);
      }
      if (others.length > 0) {
        const ov = h('div', { className: 'set-overlap' });
        others.slice(0, 3).forEach(o => ov.appendChild(createAvatar(o, { className: 'mini-avatar', size: 16, fontSize: 7, title: o.name + ' (' + o.priority + ')' })));
        card.appendChild(ov);
      }
      tbaGrid.appendChild(card);
    });
    tbaSection.appendChild(tbaGrid);
    container.appendChild(tbaSection);
  }

  return container;
}
