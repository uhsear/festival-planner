/**
 * Copyright (c) 2026 Asir Khan. All rights reserved.
 * Licensed under the Business Source License 1.1. See LICENSE file for details.
 */

/**
 * Reactive State Store
 *
 * S is a Proxy-wrapped state object. Direct assignment (S.view = 'timeline')
 * works as before AND notifies subscribers registered via subscribe().
 *
 * API:
 *   subscribe(key, fn)       — watch a specific key; returns unsubscribe fn
 *   subscribe(fn)            — wildcard: called on any change; returns unsubscribe fn
 *   stateSet({ k: v, ... })  — batch-set multiple keys, notifies once per key after all are applied
 *   snapshot()               — shallow plain-object copy of current state
 */

// ── Subscription infrastructure ────────────────────────────────
const _subscribers = new Map();
const _wildcardSubs = new Set();

function _notify(key, newVal, oldVal) {
  const subs = _subscribers.get(key);
  if (subs) for (const fn of subs) try { fn(newVal, oldVal); } catch (e) { console.error('State subscriber error:', key, e); }
  for (const fn of _wildcardSubs) try { fn(key, newVal, oldVal); } catch (e) { console.error('State subscriber error: *', e); }
}

/** Subscribe to state changes. Returns an unsubscribe function. */
export function subscribe(keyOrFn, fn) {
  if (typeof keyOrFn === 'function') {
    _wildcardSubs.add(keyOrFn);
    return () => _wildcardSubs.delete(keyOrFn);
  }
  if (!_subscribers.has(keyOrFn)) _subscribers.set(keyOrFn, new Set());
  _subscribers.get(keyOrFn).add(fn);
  return () => _subscribers.get(keyOrFn)?.delete(fn);
}

/** Batch-set multiple state keys. Notifications fire after all keys are applied. */
export function stateSet(patch) {
  const changes = [];
  for (const [k, v] of Object.entries(patch)) {
    const old = _raw[k];
    if (old !== v) { _raw[k] = v; changes.push([k, v, old]); }
  }
  for (const [k, v, old] of changes) _notify(k, v, old);
}

/** Shallow plain-object copy of current state (safe to serialize). */
export function snapshot() { return { ..._raw }; }

// ── State definition ───────────────────────────────────────────
const _raw = {
  festivals: [],
  currentFestival: null,
  currentProfile: null,
  allProfiles: [],
  view: 'cards',
  crewTab: 'people',
  selectedDay: 0,
  picksDay: null,
  searchQuery: '',
  activeStages: [],
  detailSet: null,
  detailSetTrigger: null,
  connected: false,
  isAdmin: false,
  adminToken: null,
  user: null,
  userToken: null,
  authMode: 'login',
  onlineUsers: [],
  avatarBusy: false,
  joinBusy: false,
  offlineMode: false,
  pendingSync: false,
  crews: [],
  activeCrew: null,
  crewOverlap: {},
  crewMembers: [],
  crewLoading: false,
  canInstall: false,
  installPromptEvent: null,
  appInstalled: false,
  serviceWorkerReady: false,
};

const _handler = {
  set(target, key, value) {
    const old = target[key];
    target[key] = value;
    if (old !== value) _notify(key, value, old);
    return true;
  },
  deleteProperty(target, key) {
    if (key in target) {
      const old = target[key];
      delete target[key];
      _notify(key, undefined, old);
    }
    return true;
  },
};

export const S = new Proxy(_raw, _handler);

// ── Admin state (non-reactive — internal to admin panel) ───────
export const adminState = { open: false, tab: 'dashboard', editFestival: null, adminUsers: [], dashboardData: null, dashboardLoaded: false, userSearch: '', crewsData: null, crewsLoaded: false, expandedCrew: null, crewMembers: {}, analyticsData: null, analyticsLoaded: false, auditEntries: null, auditLoaded: false, auditFilter: { action: '', from: '', to: '' }, auditOffset: 0, auditLimit: 50 };

// ── Socket factory ─────────────────────────────────────────────
export function createSocket(bearerToken) {
  const opts = {
    transports: ['websocket'],
    reconnection: true,
    reconnectionDelay: 1000,
    randomizationFactor: 0.5,
    reconnectionDelayMax: 5000,
    reconnectionAttempts: Infinity,
  };
  if (bearerToken) opts.auth = { token: bearerToken };
  let baseUrl;
  try { baseUrl = window.__FP_API_BASE ? new URL(window.__FP_API_BASE).origin : undefined; } catch { baseUrl = undefined; }
  return window.io(baseUrl || undefined, opts);
}

// ── Constants ──────────────────────────────────────────────────
export const PRI_MAP = { must: 'must', 'want-to-see': 'want', maybe: 'maybe' };
export const TRUSTED_MUTATION_HEADER = 'X-Festie-Request';
export const MAX_AVATAR_UPLOAD_BYTES = 5 * 1024 * 1024;
export const ALLOWED_AVATAR_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
export const OFFLINE_SNAPSHOT_KEY = 'festivalPlannerOfflineSnapshotV2';
export const LEGACY_OFFLINE_KEYS = ['festivalPlannerOfflineSnapshotV1'];
export const OFFLINE_SYNC_KEY = 'festivalPlannerPendingProfileSyncV1';
export const MAX_IMPORT_TEXT_LENGTH = 200000;
export const ICON_SPECS = {
  admin: [['path', { d: 'M12 15v2m-6 4h12a2 2 0 0 0 2-2v-6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2zm10-10V7a4 4 0 0 0-8 0v4h8z' }]],
  search: [['circle', { cx: '11', cy: '11', r: '8' }], ['path', { d: 'm21 21-4.3-4.3' }]],
  cards: [['rect', { x: '3', y: '3', width: '7', height: '7' }], ['rect', { x: '14', y: '3', width: '7', height: '7' }], ['rect', { x: '3', y: '14', width: '7', height: '7' }], ['rect', { x: '14', y: '14', width: '7', height: '7' }]],
  timeline: [['path', { d: 'M3 3h18v18H3z' }], ['path', { d: 'M3 9h18M3 15h18M9 3v18' }]],
  picks: [['polygon', { points: '12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2' }]],
  crew: [['path', { d: 'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2' }], ['circle', { cx: '9', cy: '7', r: '4' }], ['path', { d: 'M23 21v-2a4 4 0 0 0-3-3.87' }], ['path', { d: 'M16 3.13a4 4 0 0 1 0 7.75' }]],
  grid: [['path', { d: 'M3 3h18v18H3z' }], ['line', { x1: '3', y1: '9', x2: '21', y2: '9' }], ['line', { x1: '3', y1: '15', x2: '21', y2: '15' }], ['line', { x1: '9', y1: '3', x2: '9', y2: '21' }], ['line', { x1: '15', y1: '3', x2: '15', y2: '21' }]],
  plus: [['line', { x1: '12', y1: '5', x2: '12', y2: '19' }], ['line', { x1: '5', y1: '12', x2: '19', y2: '12' }]],
  copy: [['rect', { x: '9', y: '9', width: '13', height: '13', rx: '2' }], ['path', { d: 'M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1' }]],
  settings: [['circle', { cx: '12', cy: '12', r: '3' }], ['path', { d: 'M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42' }]],
  logout: [['path', { d: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4' }], ['polyline', { points: '16 17 21 12 16 7' }], ['line', { x1: '21', y1: '12', x2: '9', y2: '12' }]],
  download: [['path', { d: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4' }], ['polyline', { points: '7 10 12 15 17 10' }], ['line', { x1: '12', y1: '15', x2: '12', y2: '3' }]],
  heart: [['path', { d: 'M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z' }]],
};
