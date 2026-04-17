/**

 * Ratings Module — post-festival emoji quick-rate + wrap generation

 * Copyright (c) 2026 Asir Khan. All rights reserved.

 */

import { S } from './state.js?v=1776342458439';

import { h } from './dom.js?v=1776342458439';

import { formatTime, artistDisplayName } from './helpers.js?v=1776342458439';



let _api, _toast, _render;



export function initRatings(deps) {

  _api = deps.api;

  _toast = deps.toast;

  _render = deps.render;

}



// Rating emoji config: value → { emoji, label }

const RATING_MAP = {

  5: { emoji: '🔥', label: 'Fire' },

  4: { emoji: '😊', label: 'Good' },

  3: { emoji: '👍', label: 'Okay' },

  2: { emoji: '🤔', label: 'Meh' },

  1: { emoji: '👎', label: 'Skip' },

};



// ── State ─────────────────────────────────────────────────────

let _myRatings = {};     // setId → { rating, note }

let _festivalRatings = {}; // setId → { avgRating, totalRatings }

let _ratingsLoaded = false;



export function getMyRating(setId) { return _myRatings[setId] || null; }

export function getFestivalRating(setId) { return _festivalRatings[setId] || null; }

export function isRatingsLoaded() { return _ratingsLoaded; }



export async function loadMyRatings(festivalId) {

  if (!festivalId || !S.user) return;

  try {

    const data = await _api('/ratings/festival/' + festivalId);

    _myRatings = {};

    (data.ratings || []).forEach(r => {

      _myRatings[r.setId] = { rating: r.rating, note: r.note };

    });

    _ratingsLoaded = true;

  } catch { _ratingsLoaded = false; }

}



export async function loadFestivalRatings(festivalId) {

  if (!festivalId) return;

  try {

    const data = await _api('/ratings/festival/' + festivalId + '/all');

    _festivalRatings = {};

    (data.ratings || []).forEach(r => {

      _festivalRatings[r.setId] = { avgRating: r.avgRating, totalRatings: r.totalRatings };

    });

  } catch { /* silent */ }

}



export async function rateSet(setId, rating, note = '') {

  try {

    await _api('/ratings/' + setId, { method: 'POST', body: { rating, note } });

    _myRatings[setId] = { rating, note };

    _toast(RATING_MAP[rating].emoji + ' Rated!', 'success');

    _render();

  } catch (e) { _toast(e.message || 'Couldn\u2019t save rating. Try again.', 'error'); }

}



export async function removeRating(setId) {

  try {

    await _api('/ratings/' + setId, { method: 'DELETE' });

    delete _myRatings[setId];

    _toast('Rating removed', 'info');

    _render();

  } catch (e) { _toast(e.message || 'Couldn\u2019t remove rating. Try again.', 'error'); }

}



// ── Check if festival is in the past (for post-festival gating) ──

export function isFestivalOver(festival) {

  if (!festival?.days?.length) return false;

  const lastDay = festival.days[festival.days.length - 1];

  if (!lastDay?.date) return false;

  const endDate = new Date(lastDay.date + 'T23:59:59');

  return endDate < new Date();

}


// Allow rating once the set has started (not just post-festival)
export function hasSetStarted(set, festival) {
  if (!set?.startTime) return isFestivalOver(festival);
  const days = festival?.days || [];
  const day = days.find(d => (d.sets || []).some(s => s.id === set.id));
  if (!day?.date) return isFestivalOver(festival);
  const startDt = new Date(day.date + 'T' + set.startTime + ':00');
  return startDt <= new Date();
}


// ── Rating UI Component ───────────────────────────────────────

export function renderRatingButtons(setId, opts = {}) {

  const { compact = false } = opts;

  const existing = _myRatings[setId];

  const container = h('div', { className: 'rating-buttons' + (compact ? ' rating-compact' : '') });



  [5, 4, 3, 2, 1].forEach(val => {

    const { emoji, label } = RATING_MAP[val];

    const isActive = existing?.rating === val;

    const btn = h('button', {

      className: 'rating-btn' + (isActive ? ' rating-active' : ''),

      type: 'button',

      'aria-label': label + (isActive ? ' (selected)' : ''),

      'aria-pressed': isActive ? 'true' : 'false',

      title: label,

      onclick: (e) => {

        e.preventDefault();

        e.stopPropagation();

        if (isActive) removeRating(setId);

        else rateSet(setId, val);

      },

    }, emoji);

    container.appendChild(btn);

  });

  return container;

}



// ── Aggregate rating badge ────────────────────────────────────

export function renderRatingBadge(setId) {

  const agg = _festivalRatings[setId];

  if (!agg || agg.totalRatings === 0) return null;

  const avgEmoji = RATING_MAP[Math.round(agg.avgRating)]?.emoji || '⭐';

  return h('span', {

    className: 'rating-badge',

    title: agg.avgRating + ' avg from ' + agg.totalRatings + ' ratings',

  }, avgEmoji + ' ' + agg.avgRating);

}



// ── Wrap data loader ──────────────────────────────────────────

export async function loadWrapData(festivalId) {

  if (!festivalId || !S.user) return null;

  try {

    return await _api('/ratings/wrap/' + festivalId);

  } catch { return null; }

}



// ── Wrap poster renderer (lineup-poster style) ────────────────

export function renderWrapPoster(wrapData, festival) {

  if (!wrapData || !festival) return h('div', {}, 'No wrap data');

  const { stats, topSets } = wrapData;



  const poster = h('div', { className: 'wrap-poster', id: 'wrap-poster' });



  // Festival name header

  poster.appendChild(h('div', { className: 'wrap-poster-title' }, festival.name || 'My Festival'));

  poster.appendChild(h('div', { className: 'wrap-poster-subtitle' }, 'My Festival Wrap'));



  // Top sets as lineup tiers

  if (topSets.length > 0) {

    const lineup = h('div', { className: 'wrap-lineup' });

    topSets.forEach((set, i) => {

      const tier = i === 0 ? 'headliner' : i < 3 ? 'sub' : 'undercard';

      lineup.appendChild(h('div', {

        className: 'wrap-artist wrap-tier-' + tier,

      }, (RATING_MAP[set.rating]?.emoji || '') + ' ' + (set.artist || 'Unknown')));

    });

    poster.appendChild(lineup);

  }



  // Stats row

  const statsRow = h('div', { className: 'wrap-stats' });

  const statItems = [

    [stats.totalRated || 0, 'Sets Rated'],

    [stats.stagesVisited || 0, 'Stages'],

    [stats.daysAttended || 0, 'Days'],

    [Math.round(stats.totalHours || 0), 'Hours'],

  ];

  statItems.forEach(([val, label]) => {

    const stat = h('div', { className: 'wrap-stat' });

    stat.appendChild(h('div', { className: 'wrap-stat-value' }, String(val)));

    stat.appendChild(h('div', { className: 'wrap-stat-label' }, label));

    statsRow.appendChild(stat);

  });

  poster.appendChild(statsRow);



  // Branding

  poster.appendChild(h('div', { className: 'wrap-branding' }, 'festie.us'));



  return poster;

}



// ── Full wrap view ────────────────────────────────────────────

export function renderWrapView(deps) {

  const { getDays, getStageColor, getStageName } = deps;

  const container = h('div', { className: 'wrap-container' });



  if (!isFestivalOver(S.currentFestival)) {

    container.appendChild(h('div', { className: 'empty-state', style: 'padding:2rem;text-align:center' },

      'Festival wrap will be available after the event ends!'));

    return container;

  }



  if (!_ratingsLoaded || Object.keys(_myRatings).length === 0) {

    container.appendChild(h('div', { className: 'empty-state', style: 'padding:2rem;text-align:center' },

      'Rate your sets first to generate your festival wrap!'));



    // Show rating prompt for all sets

    const days = getDays();

    const allSets = days.flatMap(d => d.sets || []);

    const picked = allSets.filter(s => S.currentProfile?.picks?.[s.id]);



    if (picked.length > 0) {

      container.appendChild(h('div', { style: 'padding:8px 16px;color:var(--text-secondary);font-size:13px' },

        'Rate your ' + picked.length + ' picked sets:'));

      picked.forEach(set => {

        const card = h('div', { className: 'rating-set-card' });

        card.appendChild(h('div', { className: 'rating-set-artist' }, artistDisplayName(set, S.currentFestival?.b2bSeparator)));

        card.appendChild(h('div', { className: 'rating-set-time' },

          formatTime(set.startTime) + ' - ' + formatTime(set.endTime) + ' · ' + getStageName(set.stageId)));

        card.appendChild(renderRatingButtons(set.id));

        container.appendChild(card);

      });

    }

    return container;

  }



  // Load and show wrap

  const loadingEl = h('div', { className: 'wrap-loading', style: 'padding:2rem;text-align:center' }, 'Generating your wrap...');

  container.appendChild(loadingEl);



  loadWrapData(S.currentFestival.id).then(wrapData => {

    container.replaceChildren();

    if (!wrapData) {

      container.appendChild(h('div', { className: 'empty-state' }, 'Couldn\u2019t load wrap. Reconnect and retry.'));

      return;

    }

    container.appendChild(renderWrapPoster(wrapData, S.currentFestival));



    // Share button

    const shareBtn = h('button', {

      className: 'btn btn-primary', type: 'button',

      style: 'margin:16px auto;display:block',

      onclick: () => shareWrapPoster(),

    }, 'Share My Wrap');

    container.appendChild(shareBtn);



    // Full rating list below

    const ratingsSection = h('div', { className: 'wrap-all-ratings' });

    ratingsSection.appendChild(h('h3', { style: 'padding:12px 16px;color:var(--text-primary)' }, 'All Your Ratings'));

    (wrapData.allRatings || []).forEach(r => {

      const row = h('div', { className: 'rating-set-card' });

      const header = h('div', { style: 'display:flex;justify-content:space-between;align-items:center' });

      header.appendChild(h('div', { className: 'rating-set-artist' }, r.artist));

      header.appendChild(h('span', { className: 'rating-badge' }, RATING_MAP[r.rating]?.emoji || ''));

      row.appendChild(header);

      row.appendChild(h('div', { className: 'rating-set-time' },

        formatTime(r.startTime) + ' - ' + formatTime(r.endTime)));

      if (r.note) row.appendChild(h('div', { style: 'font-size:12px;color:var(--text-secondary);margin-top:4px' }, r.note));

      ratingsSection.appendChild(row);

    });

    container.appendChild(ratingsSection);

  });



  return container;

}



async function shareWrapPoster() {

  const el = document.getElementById('wrap-poster');

  if (!el) return;

  try {

    // Try native share with canvas screenshot

    const { default: html2canvas } = await import('https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.esm.js').catch(() => ({ default: null }));

    if (html2canvas) {

      const canvas = await html2canvas(el, { backgroundColor: '#0a0a0f', scale: 2 });

      canvas.toBlob(async (blob) => {

        if (navigator.share && blob) {

          const file = new File([blob], 'festie-wrap.png', { type: 'image/png' });

          await navigator.share({ files: [file], title: 'My Festival Wrap' }).catch(() => {});

        } else if (blob) {

          const url = URL.createObjectURL(blob);

          const a = document.createElement('a');

          a.href = url; a.download = 'festie-wrap.png'; a.click();

          URL.revokeObjectURL(url);

          _toast('Wrap downloaded!', 'success');

        }

      }, 'image/png');

    } else {

      _toast('Share not available in this browser', 'info');

    }

  } catch { _toast('Couldn\u2019t share. Try screenshotting instead.', 'error'); }

}
