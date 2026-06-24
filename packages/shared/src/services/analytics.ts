/**
 * Vendor-neutral analytics service — PostHog HTTP capture implementation.
 *
 * Uses PostHog's /capture/ HTTP endpoint directly via fetch so it works on both
 * web (Vite) and React Native (Expo) without any native module or SDK dependency.
 *
 * Configuration:
 *   Web:    VITE_POSTHOG_KEY + optional VITE_POSTHOG_HOST
 *   Native: EXPO_PUBLIC_POSTHOG_KEY + optional EXPO_PUBLIC_POSTHOG_HOST
 *
 * When no key is configured EVERY method is a silent no-op. This ensures dev,
 * test, and unconfigured installs never make network calls.
 */

import type {
  AnalyticsEventName,
  AnalyticsEventProps,
} from './analyticsEvents';

/** Shape of a PostHog capture payload. */
interface CapturePayload {
  api_key: string;
  event: string;
  distinct_id: string;
  properties: Record<string, unknown>;
  timestamp: string;
}

const DEFAULT_HOST = 'https://us.i.posthog.com';
const ANONYMOUS_ID = 'anonymous';

let _apiKey: string | null = null;
let _host: string = DEFAULT_HOST;
let _distinctId: string = ANONYMOUS_ID;

/**
 * Read the PostHog key from the environment, supporting both Vite and Expo
 * public env conventions. Returns null when neither is set.
 */
function resolveEnvKey(): string | null {
  // Vite (web)
  try {
    const vite = (
      globalThis as { import?: { meta?: { env?: Record<string, string> } } }
    ).import?.meta?.env;
    if (vite?.['VITE_POSTHOG_KEY']) return vite['VITE_POSTHOG_KEY'];
  } catch {
    // not a Vite environment
  }

  // Expo / React Native (process.env is inlined at build time by Metro)
  try {
    const proc = (globalThis as { process?: { env?: Record<string, string> } }).process;
    if (proc?.env?.['EXPO_PUBLIC_POSTHOG_KEY']) return proc.env['EXPO_PUBLIC_POSTHOG_KEY'];
  } catch {
    // process not available
  }

  return null;
}

/**
 * Read the PostHog host override from the environment.
 */
function resolveEnvHost(): string {
  try {
    const vite = (
      globalThis as { import?: { meta?: { env?: Record<string, string> } } }
    ).import?.meta?.env;
    if (vite?.['VITE_POSTHOG_HOST']) return vite['VITE_POSTHOG_HOST'];
  } catch {
    // not a Vite environment
  }

  try {
    const proc = (globalThis as { process?: { env?: Record<string, string> } }).process;
    if (proc?.env?.['EXPO_PUBLIC_POSTHOG_HOST']) return proc.env['EXPO_PUBLIC_POSTHOG_HOST'];
  } catch {
    // process not available
  }

  return DEFAULT_HOST;
}

export interface AnalyticsInitOptions {
  /** PostHog project API key. Overrides env detection when provided. */
  apiKey?: string;
  /** PostHog ingest host. Defaults to https://us.i.posthog.com */
  host?: string;
}

/**
 * Initialise the analytics service. Call once at app boot.
 *
 * If `apiKey` is omitted, the service reads it from:
 *   - import.meta.env.VITE_POSTHOG_KEY  (web)
 *   - process.env.EXPO_PUBLIC_POSTHOG_KEY  (native)
 *
 * When no key is found every subsequent call is a silent no-op.
 */
export function init(opts: AnalyticsInitOptions = {}): void {
  _apiKey = opts.apiKey ?? resolveEnvKey();
  _host = opts.host ?? resolveEnvHost();
}

/**
 * Fire-and-forget POST to PostHog's /capture/ endpoint.
 * Never throws, never blocks the UI.
 */
function post(payload: CapturePayload): void {
  const url = `${_host}/capture/`;
  // Use void to intentionally discard the promise — best-effort delivery.
  void (async () => {
    try {
      await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    } catch {
      // Network failure — silently ignore. Analytics must never surface errors.
    }
  })();
}

/**
 * Capture an analytics event.
 *
 * @param event - Event name (e.g. 'crew_created').
 * @param props - Optional free-form properties attached to the event.
 */
export function capture(event: string, props: Record<string, unknown> = {}): void {
  if (!_apiKey) return;
  post({
    api_key: _apiKey,
    event,
    distinct_id: _distinctId,
    properties: props,
    timestamp: new Date().toISOString(),
  });
}

/**
 * Typed wrapper over {@link capture} for catalogued events (see
 * `analyticsEvents.ts`). The event name is constrained to the catalog union and
 * the props are checked against that event's shape, so a typo or a wrong-shaped
 * payload is a compile error rather than a silent analytics mismatch.
 *
 * Events with no props (prop type `Record<string, never>`) may omit the second
 * argument. For events NOT in the catalog, call {@link capture} directly — that
 * remains the free-form escape hatch.
 *
 * @example
 *   captureEvent('pick_saved', { set_id, priority });
 *   captureEvent('user_registered');
 */
export function captureEvent<E extends AnalyticsEventName>(
  ...args: Record<string, never> extends AnalyticsEventProps<E>
    ? [event: E, props?: AnalyticsEventProps<E>]
    : [event: E, props: AnalyticsEventProps<E>]
): void {
  const [event, props] = args;
  capture(event, (props ?? {}) as Record<string, unknown>);
}

/**
 * Associate future events with a known user.
 *
 * Also fires a PostHog `$identify` event so the profile is linked server-side.
 *
 * @param userId - Stable, non-PII user identifier (e.g. UUID from the DB).
 * @param traits - Optional user traits (displayName, plan, …).
 */
export function identify(userId: string, traits: Record<string, unknown> = {}): void {
  _distinctId = userId;
  if (!_apiKey) return;
  post({
    api_key: _apiKey,
    event: '$identify',
    distinct_id: userId,
    properties: {
      $set: traits,
    },
    timestamp: new Date().toISOString(),
  });
}

/**
 * Clear the current identity (e.g. on logout). Resets to the anonymous
 * distinct_id so subsequent events are not attributed to the previous user.
 */
export function reset(): void {
  _distinctId = ANONYMOUS_ID;
}

export const analytics = { init, capture, captureEvent, identify, reset };
