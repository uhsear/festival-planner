// ── Configuration ────────────────────────────────────────────────
const API_BASE = window.__FP_API_BASE || '/api/v1';
const AUTH_MODE = window.__FP_AUTH_MODE || 'cookie'; // 'cookie' | 'bearer'
let _bearerToken = null;

export function setAuthToken(token) { _bearerToken = token; window.__FP_BEARER_TOKEN = token; }
export function getAuthToken() { return _bearerToken; }
export function clearAuthToken() { _bearerToken = null; window.__FP_BEARER_TOKEN = null; }
export function getApiBase() { return API_BASE; }

function isMutatingMethod(method = 'GET') {
  return ['POST', 'PUT', 'PATCH', 'DELETE'].includes(String(method).toUpperCase());
}

export async function api(path, trustedMutationHeader, options = {}) {
  const method = String(options.method || 'GET').toUpperCase();
  const headers = { ...(options.headers || {}) };

  // CSRF header for cookie-based auth on mutations
  if (isMutatingMethod(method) && !headers[trustedMutationHeader] && !headers[trustedMutationHeader.toLowerCase()]) {
    headers[trustedMutationHeader] = '1';
  }

  // Bearer token auth for native apps
  if (AUTH_MODE === 'bearer' && _bearerToken && !headers['Authorization']) {
    headers['Authorization'] = `Bearer ${_bearerToken}`;
  }

  if (options.body !== undefined && !headers['Content-Type']) headers['Content-Type'] = 'application/json';

  try {
    const response = await fetch(`${API_BASE}${path}`, {
      credentials: AUTH_MODE === 'cookie' ? 'same-origin' : 'omit',
      ...options,
      method,
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    });
    if (!response.ok) {
      const errorBody = await response.json().catch(() => ({ data: null, error: { message: response.statusText } }));
      const errInfo = errorBody.error || {};
      const error = new Error(errInfo.message || errorBody.message || 'Request failed');
      error.status = response.status;
      error.code = errInfo.code || errorBody.code || null;
      error.retryAfter = response.headers.get('Retry-After') || null;
      throw error;
    }
    const body = await response.json();
    // Unwrap standard { data, error } envelope
    return (body !== null && typeof body === 'object' && 'data' in body && 'error' in body) ? body.data : body;
  } catch (error) {
    if (error?.status === undefined) error.isNetworkError = true;
    if (error?.status !== 401 && error?.status !== 403 && !String(error.message || '').includes('Request failed')) console.error('API error:', path, error);
    throw error;
  }
}

export function createAdminApi(trustedMutationHeader) {
  return (path, options = {}) => api(path, trustedMutationHeader, options);
}
