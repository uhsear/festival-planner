import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  api,
  ApiClientError,
  setApiBase,
  getApiBase,
  setAuthMode,
  setAuthToken,
  getAuthToken,
  clearAuthToken,
  setOnUnauthorized,
} from './api';

// Mock global fetch
const mockFetch = vi.fn();
globalThis.fetch = mockFetch;

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    json: async () => body,
    headers: {
      get: (name: string) => headers[name] ?? null,
    },
  };
}

describe('api service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setApiBase('/api/v1');
    setAuthMode('cookie');
    clearAuthToken();
    setOnUnauthorized(null as unknown as () => Promise<boolean>);
  });

  describe('setApiBase / getApiBase', () => {
    it('defaults to /api/v1', () => {
      expect(getApiBase()).toBe('/api/v1');
    });

    it('updates the base URL', () => {
      setApiBase('http://localhost:3000/api');
      expect(getApiBase()).toBe('http://localhost:3000/api');
    });
  });

  describe('setAuthToken / getAuthToken / clearAuthToken', () => {
    it('starts with null token', () => {
      expect(getAuthToken()).toBeNull();
    });

    it('sets and gets the token', () => {
      setAuthToken('abc123');
      expect(getAuthToken()).toBe('abc123');
    });

    it('clears the token', () => {
      setAuthToken('abc123');
      clearAuthToken();
      expect(getAuthToken()).toBeNull();
    });
  });

  describe('api.get', () => {
    it('makes a GET request to the correct URL', async () => {
      mockFetch.mockResolvedValue(jsonResponse({ data: { name: 'test' }, error: null }));
      await api.get('/festivals');
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/v1/festivals',
        expect.objectContaining({ method: 'GET' }),
      );
    });

    it('returns unwrapped data from envelope response', async () => {
      mockFetch.mockResolvedValue(jsonResponse({ data: { id: '1', name: 'Fest' }, error: null }));
      const result = await api.get('/festivals/1');
      expect(result).toEqual({ id: '1', name: 'Fest' });
    });

    it('returns body directly when not in envelope format', async () => {
      mockFetch.mockResolvedValue(jsonResponse({ id: '1', name: 'Direct' }));
      const result = await api.get('/festivals/1');
      expect(result).toEqual({ id: '1', name: 'Direct' });
    });

    it('uses same-origin credentials in cookie mode', async () => {
      mockFetch.mockResolvedValue(jsonResponse({ ok: true }));
      await api.get('/test');
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/v1/test',
        expect.objectContaining({ credentials: 'same-origin' }),
      );
    });

    it('does not add X-Festie-Request header for GET', async () => {
      mockFetch.mockResolvedValue(jsonResponse({ ok: true }));
      await api.get('/test');
      const headers = mockFetch.mock.calls[0]![1]!.headers as Record<string, string>;
      expect(headers['X-Festie-Request']).toBeUndefined();
    });
  });

  describe('api.post', () => {
    it('makes a POST request with JSON body', async () => {
      mockFetch.mockResolvedValue(jsonResponse({ data: { id: '1' }, error: null }));
      await api.post('/festivals', { name: 'New Fest' });
      const callArgs = mockFetch.mock.calls[0]!;
      expect(callArgs[1]!.method).toBe('POST');
      expect(callArgs[1]!.body).toBe(JSON.stringify({ name: 'New Fest' }));
    });

    it('adds Content-Type: application/json for body requests', async () => {
      mockFetch.mockResolvedValue(jsonResponse({ data: null, error: null }));
      await api.post('/test', { x: 1 });
      const headers = mockFetch.mock.calls[0]![1]!.headers as Record<string, string>;
      expect(headers['Content-Type']).toBe('application/json');
    });

    it('adds X-Festie-Request header for mutations', async () => {
      mockFetch.mockResolvedValue(jsonResponse({ data: null, error: null }));
      await api.post('/test', {});
      const headers = mockFetch.mock.calls[0]![1]!.headers as Record<string, string>;
      expect(headers['X-Festie-Request']).toBe('1');
    });
  });

  describe('api.put', () => {
    it('makes a PUT request', async () => {
      mockFetch.mockResolvedValue(jsonResponse({ data: null, error: null }));
      await api.put('/festivals/1', { name: 'Updated' });
      expect(mockFetch.mock.calls[0]![1]!.method).toBe('PUT');
    });
  });

  describe('api.patch', () => {
    it('makes a PATCH request', async () => {
      mockFetch.mockResolvedValue(jsonResponse({ data: null, error: null }));
      await api.patch('/festivals/1', { name: 'Patched' });
      expect(mockFetch.mock.calls[0]![1]!.method).toBe('PATCH');
    });
  });

  describe('api.delete', () => {
    it('makes a DELETE request', async () => {
      mockFetch.mockResolvedValue(jsonResponse({ data: null, error: null }));
      await api.delete('/festivals/1');
      expect(mockFetch.mock.calls[0]![1]!.method).toBe('DELETE');
    });

    it('adds X-Festie-Request header for DELETE', async () => {
      mockFetch.mockResolvedValue(jsonResponse({ data: null, error: null }));
      await api.delete('/festivals/1');
      const headers = mockFetch.mock.calls[0]![1]!.headers as Record<string, string>;
      expect(headers['X-Festie-Request']).toBe('1');
    });
  });

  describe('error handling', () => {
    it('throws ApiClientError on non-OK response', async () => {
      mockFetch.mockResolvedValue(
        jsonResponse({ error: { message: 'Not found', code: 'NOT_FOUND' } }, 404),
      );
      await expect(api.get('/missing')).rejects.toThrow(ApiClientError);
    });

    it('ApiClientError contains status and message', async () => {
      mockFetch.mockResolvedValue(
        jsonResponse({ error: { message: 'Forbidden', code: 'FORBIDDEN' } }, 403),
      );
      try {
        await api.get('/secret');
        expect.fail('should have thrown');
      } catch (e) {
        expect(e).toBeInstanceOf(ApiClientError);
        const err = e as ApiClientError;
        expect(err.status).toBe(403);
        expect(err.message).toBe('Forbidden');
        expect(err.code).toBe('FORBIDDEN');
      }
    });

    it('includes Retry-After from response headers', async () => {
      mockFetch.mockResolvedValue(
        jsonResponse({ error: { message: 'Too many' } }, 429, { 'Retry-After': '60' }),
      );
      try {
        await api.get('/rate-limited');
        expect.fail('should have thrown');
      } catch (e) {
        const err = e as ApiClientError;
        expect(err.retryAfter).toBe('60');
      }
    });

    it('throws ApiClientError with isNetworkError for fetch failures', async () => {
      mockFetch.mockRejectedValue(new TypeError('Failed to fetch'));
      try {
        await api.get('/offline');
        expect.fail('should have thrown');
      } catch (e) {
        expect(e).toBeInstanceOf(ApiClientError);
        const err = e as ApiClientError;
        expect(err.status).toBe(0);
        expect(err.isNetworkError).toBe(true);
      }
    });

    it('handles non-JSON error responses gracefully', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        json: async () => { throw new Error('not json'); },
        headers: { get: () => null },
      });
      await expect(api.get('/crash')).rejects.toThrow('Internal Server Error');
    });
  });

  describe('bearer auth mode', () => {
    it('adds Authorization header when in bearer mode with token', async () => {
      setAuthMode('bearer');
      setAuthToken('my-token');
      mockFetch.mockResolvedValue(jsonResponse({ ok: true }));
      await api.get('/test');
      const headers = mockFetch.mock.calls[0]![1]!.headers as Record<string, string>;
      expect(headers['Authorization']).toBe('Bearer my-token');
    });

    it('does not add Authorization in cookie mode', async () => {
      setAuthMode('cookie');
      setAuthToken('my-token');
      mockFetch.mockResolvedValue(jsonResponse({ ok: true }));
      await api.get('/test');
      const headers = mockFetch.mock.calls[0]![1]!.headers as Record<string, string>;
      expect(headers['Authorization']).toBeUndefined();
    });

    it('omits credentials in bearer mode', async () => {
      setAuthMode('bearer');
      mockFetch.mockResolvedValue(jsonResponse({ ok: true }));
      await api.get('/test');
      expect(mockFetch.mock.calls[0]![1]!.credentials).toBe('omit');
    });
  });

  describe('401 retry with onUnauthorized', () => {
    it('retries once after successful token refresh', async () => {
      const refreshHandler = vi.fn(async () => true);
      setOnUnauthorized(refreshHandler);

      mockFetch
        .mockResolvedValueOnce(jsonResponse({ error: { message: 'Unauthorized' } }, 401))
        .mockResolvedValueOnce(jsonResponse({ data: { id: '1' }, error: null }));

      const result = await api.get('/protected');
      expect(refreshHandler).toHaveBeenCalledOnce();
      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(result).toEqual({ id: '1' });
    });

    it('does not retry when refresh fails', async () => {
      setOnUnauthorized(async () => false);

      mockFetch.mockResolvedValue(
        jsonResponse({ error: { message: 'Unauthorized' } }, 401),
      );

      await expect(api.get('/protected')).rejects.toThrow('Unauthorized');
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('does not retry on auth routes', async () => {
      setOnUnauthorized(async () => true);

      mockFetch.mockResolvedValue(
        jsonResponse({ error: { message: 'Bad creds' } }, 401),
      );

      await expect(api.post('/auth/login', {})).rejects.toThrow('Bad creds');
      // No retry attempt for auth routes
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });

  describe('ApiClientError class', () => {
    it('extends Error', () => {
      const err = new ApiClientError('test', 400);
      expect(err).toBeInstanceOf(Error);
      expect(err).toBeInstanceOf(ApiClientError);
    });

    it('stores all properties', () => {
      const err = new ApiClientError('msg', 429, 'RATE_LIMIT', '30', false);
      expect(err.message).toBe('msg');
      expect(err.status).toBe(429);
      expect(err.code).toBe('RATE_LIMIT');
      expect(err.retryAfter).toBe('30');
      expect(err.isNetworkError).toBe(false);
    });
  });
});
