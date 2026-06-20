import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { init, capture, identify, reset } from '../analytics';

// ── Helpers ────────────────────────────────────────────────────────────────

const mockFetch = vi.fn();

function withKey(key: string, host?: string) {
  init({ apiKey: key, ...(host ? { host } : {}) });
}

function withoutKey() {
  // Re-init with an explicitly empty key so env vars (if any) don't leak in.
  init({ apiKey: '' });
  // Reset distinct_id too.
  reset();
}

// ── Setup ──────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  globalThis.fetch = mockFetch;
});

afterEach(() => {
  reset();
});

// ── No-op when unconfigured ────────────────────────────────────────────────

describe('analytics — unconfigured (no API key)', () => {
  beforeEach(() => {
    withoutKey();
  });

  it('capture() does not call fetch', () => {
    capture('test_event', { foo: 'bar' });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('identify() does not call fetch', () => {
    identify('user-123', { name: 'Alice' });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('reset() does not call fetch', () => {
    reset();
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

// ── Payload shape when key is set ─────────────────────────────────────────

describe('analytics — configured with API key', () => {
  // Deliberately NOT the real 'phc_' PostHog-key prefix so secret scanners
  // (gitleaks) don't flag this test fixture as a leaked key.
  const TEST_KEY = 'test-analytics-key';
  const TEST_HOST = 'https://eu.i.posthog.com';

  beforeEach(() => {
    mockFetch.mockResolvedValue({ ok: true });
    withKey(TEST_KEY, TEST_HOST);
    reset(); // start anonymous
  });

  it('capture() POSTs to <host>/capture/ with correct shape', async () => {
    capture('crew_created', { crew_id: 'c-1' });

    // give the void async a tick to run
    await new Promise((r) => setTimeout(r, 0));

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${TEST_HOST}/capture/`);
    expect(opts.method).toBe('POST');

    const body = JSON.parse(opts.body as string) as Record<string, unknown>;
    expect(body.api_key).toBe(TEST_KEY);
    expect(body.event).toBe('crew_created');
    expect(body.distinct_id).toBe('anonymous');
    expect((body.properties as Record<string, unknown>).crew_id).toBe('c-1');
    expect(typeof body.timestamp).toBe('string');
  });

  it('capture() uses default host when none is provided', async () => {
    withKey(TEST_KEY); // no host arg -> default
    capture('pick_saved');

    await new Promise((r) => setTimeout(r, 0));

    const [url] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://us.i.posthog.com/capture/');
  });

  it('identify() fires $identify event and updates distinct_id for subsequent captures', async () => {
    identify('user-42', { plan: 'free' });

    await new Promise((r) => setTimeout(r, 0));

    expect(mockFetch).toHaveBeenCalledOnce();
    const [, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(opts.body as string) as Record<string, unknown>;
    expect(body.event).toBe('$identify');
    expect(body.distinct_id).toBe('user-42');
    expect((body.properties as Record<string, unknown>).$set).toEqual({ plan: 'free' });

    // Subsequent capture should use the new distinct_id
    mockFetch.mockClear();
    capture('crew_joined');
    await new Promise((r) => setTimeout(r, 0));

    const body2 = JSON.parse((mockFetch.mock.calls[0] as [string, RequestInit])[1].body as string) as Record<string, unknown>;
    expect(body2.distinct_id).toBe('user-42');
  });

  it('reset() reverts distinct_id to anonymous so post-reset captures are anonymous', async () => {
    identify('user-99');
    reset();

    capture('page_view');
    await new Promise((r) => setTimeout(r, 0));

    // Only the page_view call (identify was before key init in this test, but
    // fetch was cleared by reset path; just check the last capture)
    const lastCall = mockFetch.mock.calls[mockFetch.mock.calls.length - 1] as [string, RequestInit];
    const body = JSON.parse(lastCall[1].body as string) as Record<string, unknown>;
    expect(body.distinct_id).toBe('anonymous');
  });

  it('capture() swallows fetch errors silently', async () => {
    mockFetch.mockRejectedValue(new TypeError('Network error'));

    // Must not throw
    expect(() => capture('crew_created')).not.toThrow();
    await new Promise((r) => setTimeout(r, 0));
    // No unhandled rejection — test passes if we get here
  });

  it('capture() with no props sends an empty properties object', async () => {
    capture('user_registered');
    await new Promise((r) => setTimeout(r, 0));

    const [, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(opts.body as string) as Record<string, unknown>;
    expect(body.properties).toEqual({});
  });
});
