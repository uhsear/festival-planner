import { API_BASE, TRUSTED_MUTATION_HEADER } from '../constants/config';
import { ApiError } from '../types/api';
import { useUIStore } from '../stores/uiStore';

type AuthMode = 'cookie' | 'bearer';

interface ApiOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
  credentials?: RequestCredentials;
  /** Abort the request after this many ms (default 15000). */
  timeoutMs?: number;
  /**
   * Deterministic id used to coalesce/dedup this mutation in the offline queue.
   * Defaults to a per-resource key for PUT/PATCH/DELETE and a unique key for
   * POST (creates must stay distinct). Only consulted when the request is
   * routed to the offline queue.
   */
  clientId?: string;
  /** Human-readable label surfaced in failedSync if an offline write can't replay. */
  offlineLabel?: string;
  /**
   * Optimistic-create hook (offline POST only). When an offline POST is routed
   * into the write-queue, this is invoked AFTER the mutation is queued with the
   * synthetic optimistic result (`{ ...body, id: clientId, _optimistic: true }`)
   * so the caller can insert a placeholder into its store and render the new
   * entity immediately. Never called for online requests or for
   * PUT/PATCH/DELETE — those paths are unchanged. Optional; existing callers
   * are unaffected.
   */
  onOptimisticCreate?: (result: unknown) => void;
}

let _apiBase = API_BASE;
let _authMode: AuthMode = 'cookie';
let _bearerToken: string | null = null;
let _onUnauthorized: (() => Promise<boolean>) | null = null;
let _refreshPromise: Promise<boolean> | null = null;

export function setOnUnauthorized(handler: () => Promise<boolean>): void {
  _onUnauthorized = handler;
}

export function setApiBase(base: string): void {
  _apiBase = base;
}

export function getApiBase(): string {
  return _apiBase;
}

export function setAuthMode(mode: AuthMode): void {
  _authMode = mode;
}

export function setAuthToken(token: string | null): void {
  _bearerToken = token;
  if (typeof window !== 'undefined') {
    if (token) {
      window.__FP_BEARER_TOKEN = token;
    } else {
      delete window.__FP_BEARER_TOKEN;
    }
  }
}

export function getAuthToken(): string | null {
  return _bearerToken;
}

export function clearAuthToken(): void {
  _bearerToken = null;
  if (typeof window !== 'undefined') {
    delete window.__FP_BEARER_TOKEN;
  }
}

function isMutatingMethod(method: string = 'GET'): boolean {
  return ['POST', 'PUT', 'PATCH', 'DELETE'].includes(String(method).toUpperCase());
}

/**
 * Conservative allowlist of paths whose mutations we can safely queue + replay
 * while offline. ONLY user-data writes that are idempotent-enough to replay on
 * reconnect: a profile's picks/notes/reminders, and the crew sub-resources a
 * festival-goer edits in the field. We NEVER queue auth/account/admin/session
 * flows (replaying a stale login is dangerous and meaningless offline) — those
 * fall through to a normal fetch that fails fast with a network error.
 */
const OFFLINE_ELIGIBLE_PATTERNS: RegExp[] = [
  // Profile picks / notes / reminders: PUT /profiles/:id
  /^\/profiles\//,
  // Crew sub-resources: /crews/:id/<resource>[/...]
  /^\/crews\/[^/]+\/meeting-points(\/|$)/,
  /^\/crews\/[^/]+\/polls(\/|$)/, // includes /polls/:id/vote
  /^\/crews\/[^/]+\/packing(\/|$)/, // includes /packing/:id (claim/edit/delete)
  /^\/crews\/[^/]+\/rides(\/|$)/, // includes /rides/:id (edit/delete)
  /^\/crews\/[^/]+\/expenses(\/|$)/,
  /^\/crews\/[^/]+\/home-base(\/|$)/,
  /^\/crews\/[^/]+\/reminders(\/|$)/,
];

export function isOfflineEligible(path: string): boolean {
  // Strip any query string before matching.
  const p = path.split('?')[0] ?? path;
  return OFFLINE_ELIGIBLE_PATTERNS.some((re) => re.test(p));
}

/** UUID for clientIds; falls back to a random hex string where crypto is absent. */
function randomId(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Enqueue a replay-safe mutation into the platform offline queue and return a
 * synthetic optimistic result so optimistic UIs don't throw. No gating — the
 * caller decides WHEN to queue (offline-up-front, or on a network failure).
 */
async function enqueueOfflineMutation<T>(path: string, method: string, options: ApiOptions): Promise<T> {
  // POST creates stay distinct; PUT/PATCH/DELETE coalesce per-resource.
  const clientId = options.clientId ?? (method === 'POST' ? `POST:${path}:${randomId()}` : `${method}:${path}`);
  const label = options.offlineLabel ?? `${method} ${path}`;
  const body = options.body;

  // Web PWA: hand off to the IndexedDB-backed bridge so the web + RN paths share
  // one durable queue surface per platform.
  if (typeof window !== 'undefined' && window.__festieQueue?.queueMutation) {
    await window.__festieQueue.queueMutation({ type: 'api', url: path, method, body, clientId });
  } else {
    // Native: dynamic import avoids the api <-> offlineQueue module cycle.
    const { enqueueMutation } = await import('./offlineQueue');
    await enqueueMutation({
      clientId,
      url: path,
      method: method as 'POST' | 'PUT' | 'PATCH' | 'DELETE',
      body,
      label,
    });
  }

  if (method === 'POST') {
    const optimistic = { ...(body as object), id: clientId, _optimistic: true } as T;
    // Let the caller render the new entity immediately (offline POST only).
    // Wrapped so a buggy callback can never break the queue/return contract.
    if (options.onOptimisticCreate) {
      try {
        options.onOptimisticCreate(optimistic);
      } catch {
        /* optimistic UI insert is best-effort; the write is already queued */
      }
    }
    return optimistic;
  }
  if (method === 'PUT' || method === 'PATCH') {
    return { ...(body as object), _optimistic: true } as T;
  }
  // DELETE
  return { ok: true, _optimistic: true } as T;
}

/** Best-effort store flip into offline mode (banner + pre-emptive write queueing). */
function markOffline(): void {
  try {
    if (useUIStore.getState().offlineMode !== true) useUIStore.getState().setOfflineMode(true);
  } catch {
    /* store not ready */
  }
}

/**
 * A successful response from the NETWORK proves reachability. If we'd flipped
 * offline on a prior failure (e.g. a dead-but-"online" festival connection that
 * recovered), flip back and drain whatever queued in the meantime.
 *
 * Guards against false positives: a 200 is NOT reachability when the OS reports
 * offline (navigator.onLine === false), nor when it came from the service-worker
 * cache (only `/festivals` is runtime-cached StaleWhileRevalidate) — a cold
 * offline start fetches `/festivals` and gets a cached 200, which must not be
 * mistaken for a live connection.
 */
function markOnlineAndDrain(path: string): void {
  try {
    if (useUIStore.getState().offlineMode !== true) return;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
    if (/\/festivals(\/|$|\?)/.test(path)) return;
    useUIStore.getState().setOfflineMode(false);
    if (typeof window !== 'undefined' && window.__festieQueue?.processQueue) {
      void window.__festieQueue.processQueue();
    } else {
      void import('./offlineQueue').then((m) => m.drainQueue()).catch(() => {});
    }
  } catch {
    /* store not ready */
  }
}

/**
 * When offline (uiStore.offlineMode === true) and the path is replay-safe, route
 * a mutation into the offline queue instead of fetching. Returns the sentinel
 * `NOT_QUEUED` when the request should proceed to a normal fetch.
 */
const NOT_QUEUED = Symbol('not-queued');

async function maybeQueueOffline<T>(path: string, method: string, options: ApiOptions): Promise<T | typeof NOT_QUEUED> {
  if (!isMutatingMethod(method) || !isOfflineEligible(path)) return NOT_QUEUED;

  let offline: boolean;
  try {
    offline = useUIStore.getState().offlineMode === true;
  } catch {
    offline = false;
  }
  if (!offline) return NOT_QUEUED;

  return enqueueOfflineMutation<T>(path, method, options);
}

export class ApiClientError extends Error implements ApiError {
  status: number;
  code?: string;
  message: string;
  retryAfter?: number | string | null;
  isNetworkError?: boolean;

  constructor(
    message: string,
    status: number,
    code?: string,
    retryAfter?: number | string | null,
    isNetworkError?: boolean,
  ) {
    super(message);
    this.message = message;
    this.status = status;
    this.code = code;
    this.retryAfter = retryAfter;
    this.isNetworkError = isNetworkError;
  }
}

// Error-classification helpers live in ./errors (type-only dependency on this
// module) so store tests that mock '../services/api' don't clobber them.
export { isApiClientError, parseRetryAfterMs, mapErrorToUserMessage } from './errors';

async function apiRequest<T>(path: string, options: ApiOptions = {}, _isRetry = false): Promise<T> {
  const method = String(options.method || 'GET').toUpperCase();

  // Offline write path: when offline AND the path is replay-safe, queue the
  // mutation and return a synthetic optimistic result instead of fetching. This
  // is the ONLY new code path — when online or path-ineligible, behavior below
  // is 100% unchanged. (Skipped on the 401-refresh retry to avoid re-queuing.)
  if (!_isRetry) {
    const queued = await maybeQueueOffline<T>(path, method, options);
    if (queued !== NOT_QUEUED) return queued;
  }

  const headers = { ...(options.headers || {}) };

  if (
    isMutatingMethod(method) &&
    !headers[TRUSTED_MUTATION_HEADER] &&
    !headers[TRUSTED_MUTATION_HEADER.toLowerCase()]
  ) {
    headers[TRUSTED_MUTATION_HEADER] = '1';
  }

  if (_authMode === 'bearer' && _bearerToken && !headers['Authorization']) {
    headers['Authorization'] = `Bearer ${_bearerToken}`;
  }

  if (options.body !== undefined && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }

  // Abort the request after a bounded time so a dead/hanging network can never
  // leave a caller (e.g. checkSession gating the app splash) waiting forever —
  // a stalled fetch becomes a network error the caller can handle.
  const controller = new AbortController();
  const timeoutMs = options.timeoutMs ?? 15000;
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${_apiBase}${path}`, {
      credentials: _authMode === 'cookie' ? 'same-origin' : 'omit',
      signal: controller.signal,
      ...options,
      method,
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    });
    clearTimeout(timeoutId);

    if (!response.ok) {
      if (response.status === 401 && _onUnauthorized && !_isRetry && !path.includes('/auth/')) {
        if (!_refreshPromise) {
          _refreshPromise = _onUnauthorized().finally(() => {
            _refreshPromise = null;
          });
        }
        const refreshed = await _refreshPromise;
        if (refreshed) {
          return apiRequest<T>(path, options, true);
        }
      }

      const errorBody = await response.json().catch(() => ({ data: null, error: { message: response.statusText } }));
      const errInfo = errorBody.error || {};
      const error = new ApiClientError(
        errInfo.message || errorBody.message || 'Request failed',
        response.status,
        errInfo.code || errorBody.code || undefined,
        response.headers.get('Retry-After') || undefined,
      );
      throw error;
    }

    // Reachability confirmed (from the network) — recover from a prior
    // false-offline and drain. Guards inside reject cached/offline false 200s.
    markOnlineAndDrain(path);

    const body = await response.json();
    if (body !== null && typeof body === 'object' && 'data' in body && 'error' in body) {
      return body.data as T;
    }
    return body as T;
  } catch (error) {
    clearTimeout(timeoutId);
    if (error instanceof ApiClientError) {
      throw error;
    }

    // Network failure (fetch rejected or timed out). If this was a replay-safe
    // mutation, the device is effectively offline even if offlineMode wasn't set
    // up-front — the festival case: a cold start, or a connection that is
    // navigator.onLine===true but dead/congested. Capture the write into the
    // queue instead of losing it, and flip the store offline so the banner shows
    // and subsequent writes pre-emptively queue.
    if (!_isRetry && isMutatingMethod(method) && isOfflineEligible(path)) {
      markOffline();
      try {
        return await enqueueOfflineMutation<T>(path, method, options);
      } catch {
        /* fall through to surface the network error */
      }
    }

    const isAbort = error instanceof Error && error.name === 'AbortError';
    const networkError = new ApiClientError(
      isAbort ? 'Request timed out' : error instanceof Error ? error.message : 'Network request failed',
      0,
      undefined,
      undefined,
      true,
    );
    throw networkError;
  }
}

export const api = {
  async get<T>(path: string, options: ApiOptions = {}): Promise<T> {
    return apiRequest<T>(path, { ...options, method: 'GET' });
  },

  async post<T>(path: string, body?: unknown, options: ApiOptions = {}): Promise<T> {
    return apiRequest<T>(path, { ...options, method: 'POST', body });
  },

  async put<T>(path: string, body?: unknown, options: ApiOptions = {}): Promise<T> {
    return apiRequest<T>(path, { ...options, method: 'PUT', body });
  },

  async patch<T>(path: string, body?: unknown, options: ApiOptions = {}): Promise<T> {
    return apiRequest<T>(path, { ...options, method: 'PATCH', body });
  },

  async delete<T>(path: string, options: ApiOptions = {}): Promise<T> {
    return apiRequest<T>(path, { ...options, method: 'DELETE' });
  },
};

/**
 * One-call configuration for mobile / non-browser environments.
 *
 * ```ts
 * configureApi({ baseUrl: 'https://festie.us/api/v1', authMode: 'bearer' });
 * ```
 */
export function configureApi(options: {
  baseUrl?: string;
  authMode?: AuthMode;
  onUnauthorized?: () => Promise<boolean>;
}): void {
  if (options.baseUrl !== undefined) {
    _apiBase = options.baseUrl;
  }
  if (options.authMode !== undefined) {
    _authMode = options.authMode;
  }
  if (options.onUnauthorized !== undefined) {
    _onUnauthorized = options.onUnauthorized;
  }
}

export function createAdminApi(): typeof api {
  return api;
}
