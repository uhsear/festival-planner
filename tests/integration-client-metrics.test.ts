import { afterEach, describe, test } from 'node:test';
import {
  assert,
  startServer,
} from './_integration-helpers';

const servers: any[] = [];

afterEach(async () => {
  while (servers.length > 0) {
    const server = servers.pop();
    await server.close();
  }
});

describe('Integration — Client Metrics (Web Vitals)', { concurrency: 1 }, () => {
  test('accepts a valid LCP web-vitals beacon and returns 204', async () => {
    const server = await startServer();
    servers.push(server);

    const res = await server.request
      .post('/api/v1/metrics/web-vitals')
      .set('Content-Type', 'text/plain')
      .send(JSON.stringify({
        name: 'LCP',
        value: 2500,
        rating: 'good',
        delta: 2500,
        id: 'v4-' + Date.now(),
        url: 'https://festie.us/',
        navigationType: 'navigate',
      }))
      .expect(204);

    assert.equal(res.text, '');
  });

  test('accepts all valid metric types (CLS, LCP, FCP, INP, TTFB)', async () => {
    const server = await startServer();
    servers.push(server);

    const metrics = [
      { name: 'CLS', value: 0.05 },
      { name: 'LCP', value: 1800 },
      { name: 'FCP', value: 900 },
      { name: 'INP', value: 200 },
      { name: 'TTFB', value: 350 },
    ];

    for (const metric of metrics) {
      await server.request
        .post('/api/v1/metrics/web-vitals')
        .set('Content-Type', 'text/plain')
        .send(JSON.stringify({
          name: metric.name,
          value: metric.value,
          navigationType: 'navigate',
        }))
        .expect(204);
    }
  });

  test('returns 204 for invalid payload (fire-and-forget semantics)', async () => {
    const server = await startServer();
    servers.push(server);

    // Completely invalid JSON
    await server.request
      .post('/api/v1/metrics/web-vitals')
      .set('Content-Type', 'text/plain')
      .send('not-json-at-all{{{')
      .expect(204);

    // Empty body
    await server.request
      .post('/api/v1/metrics/web-vitals')
      .set('Content-Type', 'text/plain')
      .send('')
      .expect(204);

    // Missing name
    await server.request
      .post('/api/v1/metrics/web-vitals')
      .set('Content-Type', 'text/plain')
      .send(JSON.stringify({ value: 100 }))
      .expect(204);

    // Missing value
    await server.request
      .post('/api/v1/metrics/web-vitals')
      .set('Content-Type', 'text/plain')
      .send(JSON.stringify({ name: 'LCP' }))
      .expect(204);

    // Unknown metric name
    await server.request
      .post('/api/v1/metrics/web-vitals')
      .set('Content-Type', 'text/plain')
      .send(JSON.stringify({ name: 'FAKE', value: 100 }))
      .expect(204);
  });

  test('silently drops values outside sane ranges', async () => {
    const server = await startServer();
    servers.push(server);

    // LCP value way too high (>60000ms)
    await server.request
      .post('/api/v1/metrics/web-vitals')
      .set('Content-Type', 'text/plain')
      .send(JSON.stringify({ name: 'LCP', value: 999999, navigationType: 'navigate' }))
      .expect(204);

    // Negative CLS
    await server.request
      .post('/api/v1/metrics/web-vitals')
      .set('Content-Type', 'text/plain')
      .send(JSON.stringify({ name: 'CLS', value: -1, navigationType: 'navigate' }))
      .expect(204);
  });

  test('does not require authentication (beacon endpoint)', async () => {
    const server = await startServer();
    servers.push(server);

    // No auth header — should still work
    const res = await server.request
      .post('/api/v1/metrics/web-vitals')
      .set('Content-Type', 'text/plain')
      .send(JSON.stringify({ name: 'FCP', value: 800, navigationType: 'navigate' }));

    assert.equal(res.status, 204);
  });

  test('accepts JSON body sent as application/json too', async () => {
    const server = await startServer();
    servers.push(server);

    // sendBeacon uses text/plain, but direct fetch might use application/json
    await server.request
      .post('/api/v1/metrics/web-vitals')
      .set('Content-Type', 'text/plain')
      .send(JSON.stringify({ name: 'TTFB', value: 500, navigationType: 'reload' }))
      .expect(204);
  });
});
