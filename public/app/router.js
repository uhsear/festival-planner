/**
 * History Router — view switching with clean URLs via pushState
 * Copyright (c) 2026 Asir Khan. All rights reserved.
 */

import { S } from './state.js?v=1776342458439';
import { Events, emit } from './events.js?v=1776342458439';

const VIEWS = new Set(['cards', 'timeline', 'picks', 'crew', 'grid']);
const PROFILE_VIEWS = new Set(['picks', 'crew']);
const DEFAULT_VIEW = 'cards';
// Per-route document.title map — keeps tab labels descriptive so history
// back/forward + tab switchers show "what you were looking at" instead of
// every entry reading "Festie". Also improves SR announcements.
const TITLES = {
  cards: 'Festie — Festivals',
  timeline: 'Festie — Timeline',
  picks: 'Festie — Your Picks',
  crew: 'Festie — Crew',
  grid: 'Festie — Grid',
};
let _renderFn = null;

/** Extract the view name from a pathname like "/crew" → "crew", "/" → default. */
function viewFromPath(pathname) {
  const seg = (pathname || '/').split('/').filter(Boolean)[0] || '';
  return VIEWS.has(seg) ? seg : '';
}

/**
 * On route change: update title, reset scroll, move focus to #main-content
 * (falls back to h1) for SR users. All three were missing pre-audit —
 * users on VoiceOver/NVDA stayed anchored to the stale focus target, and
 * mobile users saw the previous view's scroll offset on the new view.
 */
function applyRouteSideEffects(view) {
  document.title = TITLES[view] || 'Festie';
  // Reset scroll so a long timeline doesn't leave cards mid-page.
  try { window.scrollTo(0, 0); } catch { /* jsdom/tests */ }
  // Move focus to the landmark — preferredTarget is #main-content (matches
  // the skip-link in index.html), fallback is the first h1 in the app root.
  const target = document.getElementById('main-content')
    || document.querySelector('#app h1');
  if (target) {
    // Only set tabindex if the element isn't naturally focusable.
    if (!target.hasAttribute('tabindex') && target.tagName !== 'A' && target.tagName !== 'BUTTON') {
      target.setAttribute('tabindex', '-1');
    }
    try { target.focus({ preventScroll: true }); } catch { /* ignore */ }
  }
}

/** Navigate to a view. Updates S.view, URL, and triggers render. */
export function navigate(view, { replace = false, silent = false } = {}) {
  if (!VIEWS.has(view)) view = DEFAULT_VIEW;
  // Guests are allowed into picks/crew/grid — the views themselves render a teaser.
  const target = '/' + view;
  if (S.view === view && location.pathname === target) return;
  S.view = view;
  if (location.pathname !== target) history[replace ? 'replaceState' : 'pushState'](null, '', target);
  if (!silent) {
    emit(Events.VIEW_CHANGED, view);
    if (_renderFn) _renderFn();
    // Side effects run after render so the focus target exists in the DOM.
    applyRouteSideEffects(view);
  }
}

/** Guard protected views — no-op for guests so the teaser renders. */
export function guardView() {
  return false;
}

/** Initialize router: sync URL ↔ S.view, listen for popstate. */
export function initRouter(renderFn) {
  _renderFn = renderFn;

  // Handle back/forward navigation
  window.addEventListener('popstate', () => {
    const view = viewFromPath(location.pathname);
    if (view && VIEWS.has(view) && view !== S.view) {
      navigate(view, { replace: true });
    } else if (!view || !VIEWS.has(view)) {
      navigate(S.view || DEFAULT_VIEW, { replace: true });
    }
  });

  // Migrate hash URLs to clean URLs (one-time redirect for existing users)
  const hash = location.hash.slice(1);
  if (hash && VIEWS.has(hash)) {
    S.view = hash;
    history.replaceState(null, '', '/' + hash);
    document.title = TITLES[hash] || 'Festie';
    return;
  }

  // Read view from pathname
  const pathView = viewFromPath(location.pathname);
  if (pathView && VIEWS.has(pathView)) {
    S.view = pathView;
    document.title = TITLES[pathView] || 'Festie';
  } else if (S.view) {
    history.replaceState(null, '', '/' + S.view);
    document.title = TITLES[S.view] || 'Festie';
  }
}

/** List of valid view names. */
export { VIEWS, PROFILE_VIEWS, DEFAULT_VIEW };
