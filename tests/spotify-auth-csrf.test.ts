/**
 * Copyright (c) 2026 Asir Khan. All rights reserved.
 * Licensed under the Business Source License 1.1. See LICENSE file for details.
 */
/**
 * Regression test for the OAuth state⇄browser-session binding (RFC 6749 §10.12)
 * on GET /spotify/auth/callback. The CSRF guard rejects BEFORE consuming the
 * server-side PKCE state or calling Spotify, so these assertions need no DB or
 * network — they exercise the cookie check alone.
 */
import { test } from 'node:test';
import assert from 'node:assert';
import express from 'express';
import request from 'supertest';
import createSpotifyAuthRoutes from '../routes/spotify-auth.js';

function buildApp() {
  const deps = {
    config: {
      SPOTIFY_CLIENT_ID: 'cid',
      SPOTIFY_CLIENT_SECRET: '',
      SPOTIFY_REDIRECT_URI: 'https://festie.us/api/v1/spotify/auth/callback',
      PUBLIC_ORIGIN: 'https://festie.us',
    },
    log: { error() {}, warn() {}, info() {} },
    stores: {},
    userAuth: (_req: any, _res: any, next: any) => next(),
    rateLimit: () => (_req: any, _res: any, next: any) => next(),
    sendSuccess: (res: any, data: any) => res.json({ data }),
    sendError: (res: any, status: number, message: string) => res.status(status).json({ error: { message } }),
    ErrorCodes: { SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE', INTERNAL_ERROR: 'INTERNAL_ERROR' },
    validate: () => (_req: any, _res: any, next: any) => next(),
    validateParams: () => (_req: any, _res: any, next: any) => next(),
    schemas: {},
  };
  const app = express();
  app.use('/api/v1', createSpotifyAuthRoutes(deps));
  return app;
}

test('callback rejects (status=invalid) when no state cookie is present', async () => {
  const res = await request(buildApp()).get('/api/v1/spotify/auth/callback?code=abc&state=xyz');
  assert.equal(res.status, 302);
  assert.match(res.headers.location, /status=invalid/);
});

test('callback rejects (status=invalid) when the cookie state mismatches the query state', async () => {
  const res = await request(buildApp())
    .get('/api/v1/spotify/auth/callback?code=abc&state=xyz')
    .set('Cookie', 'fp_spotify_oauth_state=DIFFERENT');
  assert.equal(res.status, 302);
  assert.match(res.headers.location, /status=invalid/);
});

test('callback passes the CSRF check when the cookie matches (then expired at takeState)', async () => {
  const res = await request(buildApp())
    .get('/api/v1/spotify/auth/callback?code=abc&state=xyz')
    .set('Cookie', 'fp_spotify_oauth_state=xyz');
  assert.equal(res.status, 302);
  // CSRF passed → proceeds to the (empty) state store → 'expired', NOT 'invalid'.
  assert.match(res.headers.location, /status=expired/);
});
