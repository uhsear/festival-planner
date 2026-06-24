/**
 * Typed analytics event catalog — the single source of truth for the analytics
 * events web + mobile share.
 *
 * `analytics.capture(event, props)` is intentionally still free-form (a string +
 * a `Record<string, unknown>`) so one-off / experimental events don't need a
 * catalog edit. This module layers a TYPED surface on top: the common,
 * high-traffic events get a named union plus a per-event prop shape, so call
 * sites get autocomplete + a compile error if they typo an event name or send
 * the wrong props.
 *
 * Pure types + a thin generic — no globals, safe for both web and React Native.
 *
 * To add a typed event: add a `name` + prop shape to `AnalyticsEventMap`. To
 * fire something not (yet) in the catalog, use `analytics.capture(...)` directly
 * (the untyped escape hatch) — `captureEvent` only covers catalogued events.
 */

import type { Priority } from '../types/domain';

/**
 * The catalogued events and their property shapes. Keys are the exact event
 * names sent to PostHog; values are the typed props for that event.
 *
 * These mirror the existing shared-store call sites:
 *   - festivalDataStore.savePick -> 'pick_saved'
 *   - crewStore.createCrew       -> 'crew_created'
 *   - crewStore.joinByCode       -> 'crew_joined'
 *   - authStore.register         -> 'user_registered'
 */
export interface AnalyticsEventMap {
  /** A pick was saved/updated. `priority` is null when cleared/unset. */
  pick_saved: { set_id: string; priority: Priority | null };
  /** A new crew was created. */
  crew_created: { crew_id: string };
  /** The current user joined a crew via invite code. */
  crew_joined: { crew_id: string };
  /** A new account was registered (fired right after identify). */
  user_registered: Record<string, never>;
}

/** Union of all catalogued event names. */
export type AnalyticsEventName = keyof AnalyticsEventMap;

/** Props type for a given catalogued event name. */
export type AnalyticsEventProps<E extends AnalyticsEventName> = AnalyticsEventMap[E];
