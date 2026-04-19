import { API_BASE, TRUSTED_MUTATION_HEADER } from '../constants/config';
import { ApiError } from '../types/api';

type AuthMode = 'cookie' | 'bearer';

interface ApiOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
  credentials?: RequestCredentials;
}

let _apiBase = API_BASE;
let _authMode: AuthMode = 'cookie';
let _bearerToken: string | null = null;

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

async function apiRequest<T>(
  path: string,
  options: ApiOptions = {},
): Promise<T> {
  const method = String(options.method || 'GET').toUpperCase();
  const headers = { ...(options.headers || {}) };

  if (isMutatingMethod(method) && !headers[TRUSTED_MUTATION_HEADER] && !headers[TRUSTED_MUTATION_HEADER.toLowerCase()]) {
    headers[TRUSTED_MUTATION_HEADER] = '1';
  }

  if (_authMode === 'bearer' && _bearerToken && !headers['Authorization']) {
    headers['Authorization'] = `Bearer ${_bearerToken}`;
  }

  if (options.body !== undefined && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }

  try {
    const response = await fetch(`${_apiBase}${path}`, {
      credentials: _authMode === 'cookie' ? 'same-origin' : 'omit',
      ...options,
      method,
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    });

    if (!response.ok) {
      const errorBody = await response
        .json()
        .catch(() => ({ data: null, error: { message: response.statusText } }));
      const errInfo = errorBody.error || {};
      const error = new ApiClientError(
        errInfo.message || errorBody.message || 'Request failed',
        response.status,
        errInfo.code || errorBody.code || undefined,
        response.headers.get('Retry-After') || undefined,
      );
      throw error;
    }

    const body = await response.json();
    if (body !== null && typeof body === 'object' && 'data' in body && 'error' in body) {
      return body.data as T;
    }
    return body as T;
  } catch (error) {
    if (error instanceof ApiClientError) {
      throw error;
    }

    const err = error instanceof Error ? error : new Error(String(error));
    const networkError = new ApiClientError(
      err.message || 'Network request failed',
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

export function createAdminApi(): typeof api {
  return api;
}
