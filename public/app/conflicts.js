/**
 * Conflict Detection Module — finds overlapping picks + suggests alternatives
 * Copyright (c) 2026 Asir Khan. All rights reserved.
 */
import { S, PRI_MAP } from './state.js?v=1776342458439';
import { h } from './dom.js?v=1776342458439';
import { timeToMinutes, formatTime, artistDisplayName } from './helpers.js?v=1776342458439';

/**
 * Detect conflicts among picked sets for the current day.
 * Returns array of { setA, setB, overlapMinutes } objects.
 */
export function detectConflicts(sets, getMyPick) {
  const picked = sets.filter(s => getMyPick(s.id) && s.startTime && s.endTime);
  const conflicts = [];
  const seen = new Set();

  for (let i = 0; i < picked.length; i++) {
    for (let j = i + 1; j < picked.length; j++) {
      const a = picked[i], b = picked[j];
      const aS = timeToMinutes(a.startTime); let aE = timeToMinutes(a.endTime); if (aE <= aS) aE += 1440;
      const bS = timeToMinutes(b.startTime); let bE = timeToMinutes(b.endTime); if (bE <= bS) bE += 1440;
      if (aS < bE && bS < aE) {
        const key = [a.id, b.id].sort().join('-');
        if (!seen.has(key)) {
          seen.add(key);
          const overlapStart = Math.max(aS, bS);
          const overlapEnd = Math.min(aE, bE);
          conflicts.push({ setA: a, setB: b, overlapMinutes: overlapEnd - overlapStart });
        }
      }
    }
  }
  return conflicts;
}

/**
 * Get set IDs that have at least one conflict.
 * Returns a Set of set IDs.
 */
export function getConflictingSetIds(sets, getMyPick) {
  const conflicts = detectConflicts(sets, getMyPick);
  const ids = new Set();
  conflicts.forEach(({ setA, setB }) => {
    ids.add(setA.id);
    ids.add(setB.id);
  });
  return ids;
}

/**
 * Find non-conflicting alternative sets in the same time window.
 * For a conflicting set, returns other unpicked sets that overlap
 * with its time range and DON'T conflict with the user's other picks.
 */
export function findAlternatives(conflictingSetId, allSets, getMyPick, limit = 3) {
  const targetSet = allSets.find(s => s.id === conflictingSetId);
  if (!targetSet || !targetSet.startTime || !targetSet.endTime) return [];

  const tS = timeToMinutes(targetSet.startTime);
  let tE = timeToMinutes(targetSet.endTime); if (tE <= tS) tE += 1440;

  // Get all other picked sets (to check for conflicts with alternatives)
  const otherPicked = allSets.filter(s => s.id !== conflictingSetId && getMyPick(s.id) && s.startTime && s.endTime);

  return allSets
    .filter(s => {
      if (s.id === conflictingSetId) return false;
      if (getMyPick(s.id)) return false;  // Already picked
      if (!s.startTime || !s.endTime) return false;
      if (s.stageId === targetSet.stageId) return false;  // Same stage, not an alternative

      // Must overlap with the target's time window
      const sS = timeToMinutes(s.startTime); let sE = timeToMinutes(s.endTime); if (sE <= sS) sE += 1440;
      if (!(sS < tE && tS < sE)) return false;

      // Must NOT conflict with user's other picks
      for (const op of otherPicked) {
        const opS = timeToMinutes(op.startTime); let opE = timeToMinutes(op.endTime); if (opE <= opS) opE += 1440;
        if (sS < opE && opS < sE) return false;
      }
      return true;
    })
    .slice(0, limit);
}

/**
 * Render a conflict suggestion bar for a specific set.
 */
export function renderConflictSuggestionBar(setId, allSets, getMyPick, deps) {
  const { render } = deps;
  const alternatives = findAlternatives(setId, allSets, getMyPick);
  if (alternatives.length === 0) return null;

  const bar = h('div', { className: 'conflict-suggestion-bar' });
  bar.appendChild(h('span', { className: 'suggestion-label' }, 'Also at this time:'));
  alternatives.forEach(alt => {
    const chip = h('button', {
      className: 'conflict-alt-chip',
      type: 'button',
      onclick: (e) => { e.stopPropagation(); S.detailSet = alt; render(); },
    }, artistDisplayName(alt, S.currentFestival?.b2bSeparator) + ' (' + formatTime(alt.startTime) + ')');
    bar.appendChild(chip);
  });
  return bar;
}

/**
 * Post-render: mark conflicting timeline sets with CSS class.
 * Call this after renderTimeline has built the DOM.
 */
export function markTimelineConflicts(containerEl, sets, getMyPick) {
  const conflictIds = getConflictingSetIds(sets, getMyPick);
  if (conflictIds.size === 0) return;

  // Find all timeline-set elements and add conflict class
  const setEls = containerEl.querySelectorAll('.timeline-set');
  setEls.forEach(el => {
    // Extract set ID from the element's click handler or aria-label
    // We store it as a data attribute during render
    const setId = el.dataset?.setId;
    if (setId && conflictIds.has(setId)) {
      el.classList.add('has-conflict');
    }
  });
}
