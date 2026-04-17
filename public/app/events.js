/**
 * Event Bus — typed pub/sub for decoupled module communication
 * Copyright (c) 2026 Asir Khan. All rights reserved.
 */

const _listeners = new Map();

export const Events = {
  VIEW_CHANGED:          'view:changed',
  FESTIVAL_SELECTED:     'festival:selected',
  PICK_CHANGED:          'pick:changed',
  PICK_REMOVED:          'pick:removed',
  CREW_SELECTED:         'crew:selected',
  CREW_LEFT:             'crew:left',
  PROFILE_UPDATED:       'profile:updated',
  AUTH_LOGIN:             'auth:login',
  AUTH_LOGOUT:            'auth:logout',
  SOCKET_CONNECTED:      'socket:connected',
  SOCKET_DISCONNECTED:   'socket:disconnected',
  DETAIL_OPEN:           'detail:open',
  DETAIL_CLOSE:          'detail:close',
};

/** Subscribe to an event. Returns an unsubscribe function. */
export function on(event, fn) {
  if (!_listeners.has(event)) _listeners.set(event, new Set());
  _listeners.get(event).add(fn);
  return () => _listeners.get(event)?.delete(fn);
}

export function off(event, fn) {
  _listeners.get(event)?.delete(fn);
}

export function emit(event, data) {
  const fns = _listeners.get(event);
  if (fns) for (const fn of fns) {
    try { fn(data); } catch (e) { console.error('Event handler error:', event, e); }
  }
}

export function once(event, fn) {
  const unsub = on(event, (data) => { unsub(); fn(data); });
  return unsub;
}

export function clear() { _listeners.clear(); }
