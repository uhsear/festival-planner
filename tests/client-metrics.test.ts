/**
 * Unit tests for routes/client-metrics.ts (POST /web-vitals).
 *
 * Pure unit tests — no DB, no network. This route never touches the DB, so
 * it's exercised directly against a real prom-client registry rather than
 * tests/_integration-helpers.ts (which hard-requires TEST_DATABASE_URL even
 * for routes that don't need one).
 *
 * Node style: `node:test` + `node:assert/strict`.
 */

import { describe, test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import promClient from 'prom-client';

import createClientMetricsRoutes from '../routes/client-metrics';

function buildApp(deps: any) {
  const app = express();
  app.use(express.text({ type: '*/*' }));
  app.use(createClientMetricsRoutes(deps));
  return app;
}

function makeDeps() {
  const registry = new promClient.Registry();
  return {
    log: { info() {}, warn() {}, error() {}, debug() {} },
    rateLimit: () => (_req: any, _res: any, next: any) => next(),
    promMetrics: { available: true, client: promClient, registry },
  };
}

describe('routes/client-metrics.ts — POST /web-vitals', () => {
  // prom-client's Metric base class auto-registers every new metric onto its
  // process-wide default registry (Registry.globalRegistry) in addition to
  // whichever registry we explicitly pass, unless `registers: []` is given.
  // Each test builds its own local Registry, but the Histogram constructor
  // still touches that shared global one — clear it so same-named histograms
  // across tests in this file don't collide.
  beforeEach(() => {
    promClient.register.clear();
  });

  test('caps navigationType Prometheus label to a bounded, known set (cardinality-blowup DoS guard)', async () => {
    // Unauthenticated route: any caller can POST an arbitrary navigationType.
    // Each distinct value becomes a Prometheus label -> a new time series if
    // unbounded, which is the actual audit finding for this endpoint.
    const deps = makeDeps();
    const app = buildApp(deps);

    for (let i = 0; i < 25; i++) {
      await request(app)
        .post('/web-vitals')
        .set('Content-Type', 'text/plain')
        .send(JSON.stringify({ name: 'LCP', value: 1000, navigationType: `attacker-${i}` }))
        .expect(204);
    }

    const text = await deps.promMetrics.registry.metrics();
    const navValues = new Set([...text.matchAll(/nav="([^"]*)"/g)].map((m) => m[1]));
    assert.ok(
      navValues.size <= 1,
      `expected unrecognized navigationType values to collapse to one label, got ${navValues.size}: ${[...navValues].join(', ')}`
    );
  });

  test('still records the real navigationType for known, legitimate values', async () => {
    const knownTypes = ['navigate', 'reload', 'back-forward', 'back-forward-cache', 'prerender', 'restore'];
    const deps = makeDeps();
    const app = buildApp(deps);

    for (const navigationType of knownTypes) {
      await request(app)
        .post('/web-vitals')
        .set('Content-Type', 'text/plain')
        .send(JSON.stringify({ name: 'LCP', value: 1000, navigationType }))
        .expect(204);
    }

    const text = await deps.promMetrics.registry.metrics();
    for (const navigationType of knownTypes) {
      assert.ok(text.includes(`nav="${navigationType}"`), `expected label nav="${navigationType}" to be recorded`);
    }
  });
});
