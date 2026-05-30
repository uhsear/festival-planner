import type { ApiClientError } from './api';

/**
 * Error-classification helpers, kept in their own module (no runtime dependency
 * on api.ts — `ApiClientError` is a type-only import) so that tests which
 * `vi.mock('../services/api')` to stub the network layer don't clobber these
 * pure functions. Duck-typed (no `instanceof`) so they also survive module
 * mocks / realm boundaries.
 */

/** True when `err` looks like an ApiClientError (status + network/retry shape). */
export function isApiClientError(err: unknown): err is ApiClientError {
  return (
    typeof err === 'object' && err !== null &&
    typeof (err as { status?: unknown }).status === 'number' &&
    ('isNetworkError' in err || 'retryAfter' in err || (err as { name?: unknown }).name === 'ApiClientError')
  );
}

/**
 * Normalize an HTTP `Retry-After` value to milliseconds. The header may be
 * delta-seconds ("120") OR an HTTP-date ("Wed, 21 Oct 2026 07:28:00 GMT").
 * Returns null if unparseable.
 */
export function parseRetryAfterMs(retryAfter: number | string | null | undefined): number | null {
  if (retryAfter == null) return null;
  if (typeof retryAfter === 'number') return Math.max(0, Math.round(retryAfter * 1000));
  const s = String(retryAfter).trim();
  if (s === '') return null;
  if (/^\d+$/.test(s)) return Math.max(0, parseInt(s, 10) * 1000);
  const when = Date.parse(s);
  if (!Number.isNaN(when)) return Math.max(0, when - Date.now());
  return null;
}

/**
 * Map any thrown error to a user-facing message that distinguishes offline /
 * rate-limited / server / client failures. Non-ApiClientErrors fall back to
 * their `.message` (or the provided fallback), so plain-Error call sites and
 * existing message assertions are unaffected.
 */
export function mapErrorToUserMessage(err: unknown, fallback = 'Something went wrong'): string {
  if (isApiClientError(err)) {
    if (err.isNetworkError || err.status === 0) {
      return 'You appear to be offline — check your connection and try again.';
    }
    if (err.status === 429) {
      const ms = parseRetryAfterMs(err.retryAfter);
      const secs = ms != null ? Math.ceil(ms / 1000) : null;
      return secs ? `Too many requests — try again in ${secs}s.` : 'Too many requests — please slow down.';
    }
    if (err.status >= 500) return 'The server had a problem — please try again shortly.';
    return err.message || fallback;
  }
  return err instanceof Error ? err.message : fallback;
}
