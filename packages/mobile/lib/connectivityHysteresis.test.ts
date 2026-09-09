import { describe, it, expect } from 'vitest';
import { decideFlap, OFFLINE_CONFIRM_MS, ONLINE_CONFIRM_MS } from './connectivityHysteresis';

// Shorthand: the steady online state (offlineMode false, nothing pending).
const online = { currentOffline: false, pendingOnline: null, firstEvent: false };
// ...and the steady offline state.
const offline = { currentOffline: true, pendingOnline: null, firstEvent: false };

describe('decideFlap', () => {
  it('applies the first event immediately, in both directions', () => {
    expect(decideFlap({ ...online, online: false, firstEvent: true })).toEqual({ type: 'commit' });
    expect(decideFlap({ ...offline, online: true, firstEvent: true })).toEqual({ type: 'commit' });
  });

  it('is slow to believe an outage and quicker to believe recovery', () => {
    expect(decideFlap({ ...online, online: false })).toEqual({ type: 'schedule', delayMs: OFFLINE_CONFIRM_MS });
    expect(decideFlap({ ...offline, online: true })).toEqual({ type: 'schedule', delayMs: ONLINE_CONFIRM_MS });
    expect(OFFLINE_CONFIRM_MS).toBeGreaterThan(ONLINE_CONFIRM_MS);
  });

  it('cancels a stale pending ONLINE flip, which is cheap to restart', () => {
    expect(decideFlap({ currentOffline: true, pendingOnline: true, online: false, firstEvent: false })).toEqual({
      type: 'cancel',
    });
  });

  it('keeps an armed OFFLINE flip when an online blip arrives', () => {
    // This used to return 'cancel'. It could not: cancelling let a radio
    // flapping faster than OFFLINE_CONFIRM_MS discard the armed commit every
    // time, so the bar claimed "online" indefinitely while genuinely offline --
    // the dangerous direction. The offline delay is a floor from the first
    // offline event, not a countdown any later event may restart.
    //
    // Blip protection did not move to a worse place, it moved to a better one:
    // OfflineBanner re-reads the last reported state when the timer fires and
    // skips the commit if the radio has recovered, so a handover blip still
    // never tears the map down.
    expect(decideFlap({ currentOffline: false, pendingOnline: false, online: true, firstEvent: false })).toEqual({
      type: 'ignore',
    });
  });

  it('does not restart the clock while a flip to the same target is already pending', () => {
    // Repeated offline events during one outage must not push the banner out
    // forever -- the first event's 5s deadline stands.
    expect(decideFlap({ currentOffline: false, pendingOnline: false, online: false, firstEvent: false })).toEqual({
      type: 'ignore',
    });
  });

  it('treats a repeated event that matches the current state as a cancel, not a re-commit', () => {
    expect(decideFlap({ ...online, online: true })).toEqual({ type: 'cancel' });
    expect(decideFlap({ ...offline, online: false })).toEqual({ type: 'cancel' });
  });
});
