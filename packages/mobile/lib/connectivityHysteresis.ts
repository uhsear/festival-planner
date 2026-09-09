/**
 * Hysteresis for NetInfo connectivity transitions.
 *
 * NetInfo emits an event per radio change, and a wifi/cell handover produces a
 * short false "offline" burst. Writing every one of those straight into
 * uiStore.offlineMode tears the map down: OfflineMap gates `canRenderMap` on
 * offlineMode and falls back to a pin list, which unmounts the WebView, loses
 * the user's pan/zoom, and re-parses the ~1.2 MB inlined MapLibre runtime on
 * the way back. So a transition has to hold before it is believed.
 *
 * The two directions are deliberately NOT symmetric:
 *
 *  - OFFLINE is expensive to get wrong (map teardown above), and a handover
 *    blip is over in 1-3s. 5s is longer than any handover but still well
 *    inside the time a user needs to see an honest "you're offline" bar after
 *    walking into a dead zone.
 *  - ONLINE is cheap to get wrong (a queued mutation simply fails and retries)
 *    and users want the bar gone as soon as signal returns, so 1s — enough to
 *    reject a single spurious event, not enough to keep lying about an outage
 *    that has actually ended.
 *
 * The decision is pure so it can be tested without a device; the caller owns
 * the timer and the store write.
 *
 * WHAT THIS DOES NOT COVER, stated so the guarantee is not overclaimed. It
 * gates the NetInfo path only. `markOffline()` in shared/src/services/api.ts
 * sets offlineMode straight to true on ANY failed request, and
 * `markOnlineAndDrain()` sets it back, both bypassing this module entirely. So
 * a handover blip that also fails an in-flight request still flips offlineMode
 * instantly and still tears the WebView down. This module removes the teardowns
 * caused by radio events alone, which is the common case, not all of them.
 *
 * Routing api.ts through here is the wrong fix: it is shared with the web SPA,
 * which has no WebView to protect, and delaying the offline flag there would
 * also delay pre-emptive write queueing, which wants to be eager. The teardown
 * is what should be debounced, not the connectivity signal — the durable fix is
 * hysteresis on OfflineMap's own `canRenderMap` gate, so the banner stays
 * honest and fast while the expensive unmount is the thing that waits.
 */

/** How long a reported outage must hold before the UI believes it. */
export const OFFLINE_CONFIRM_MS = 5_000;

/** How long recovered connectivity must hold before the UI believes it. */
export const ONLINE_CONFIRM_MS = 1_000;

export type FlapAction =
  /** Apply the reported state now (first event, or nothing to protect). */
  | { type: 'commit' }
  /** Apply the reported state if it still holds after `delayMs`. */
  | { type: 'schedule'; delayMs: number }
  /** Already in the reported state — drop any pending flip the other way. */
  | { type: 'cancel' }
  /** A timer for this same target is already running — let it run out. */
  | { type: 'ignore' };

export interface FlapInput {
  /** Connectivity as this NetInfo event reports it. */
  online: boolean;
  /** uiStore.offlineMode right now. */
  currentOffline: boolean;
  /** Target of the flip already scheduled, or null when none is pending. */
  pendingOnline: boolean | null;
  /**
   * True for the first event after the listener attaches. offlineMode is not
   * persisted, so it starts false (= online) whether or not that is true; the
   * first event is the only source of truth there and nothing is mounted yet
   * to protect, so it applies immediately. Without this, launching in
   * airplane mode would mount a doomed WebView for 5s.
   */
  firstEvent: boolean;
}

export function decideFlap({ online, currentOffline, pendingOnline, firstEvent }: FlapInput): FlapAction {
  if (firstEvent) return { type: 'commit' };
  if (currentOffline === !online) {
    // Already showing what this event reports. Normally that means any flip the
    // other way is stale and should be dropped — but NOT when the pending flip
    // is toward offline.
    //
    // OFFLINE_CONFIRM_MS is a FLOOR measured from the first offline event, not
    // a countdown that any online event may restart. Cancelling here let a
    // radio flapping faster than 5s starve the flip forever: each spurious
    // `online` discarded the armed commit and the next `offline` began a fresh
    // 5s, so the bar kept claiming "online" while the device was genuinely
    // offline, indefinitely. That is precisely the direction it is dangerous to
    // be wrong in — an edge-of-coverage cell at a festival flaps exactly like
    // that. So the armed offline flip is left to run.
    //
    // The cost of leaving it armed is bounded and self-correcting: if signal
    // really had returned, the UI shows offline for at most ONLINE_CONFIRM_MS
    // before the next online event schedules the flip back. Briefly saying
    // "offline" when online is the harmless error.
    if (pendingOnline === false) return { type: 'ignore' };
    return { type: 'cancel' };
  }
  if (pendingOnline === online) return { type: 'ignore' };
  return { type: 'schedule', delayMs: online ? ONLINE_CONFIRM_MS : OFFLINE_CONFIRM_MS };
}
