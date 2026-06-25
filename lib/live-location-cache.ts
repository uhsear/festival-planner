// Copyright (c) 2026 Asir Khan. All rights reserved.
// All Rights Reserved. See the LICENSE file.

/**
 * Live-location late-joiner snapshot cache (Phase 3C).
 *
 * EPHEMERAL by construction. Live crew positions are NEVER written to Postgres
 * (see routes/socket.ts + tests/integration-live-location.test.ts). This module
 * adds a short-TTL Redis cache of each crew's *last-known* sharing positions so
 * a freshly-opened app can render peers IMMEDIATELY on join instead of waiting
 * for the next ~10s `location:update` tick.
 *
 * Storage: one Redis HASH per crew, `loc:pos:<crewId>`, field = sharer userId,
 * value = the exact `location:peer-update` payload (JSON). The whole key carries
 * a PEXPIRE refreshed on every write, so once a crew stops sharing cluster-wide
 * the cache self-expires. Individual sharers are HDEL'd on stop / leave /
 * disconnect / revoke; any field that nonetheless lingers is dropped at read
 * time by the staleness filter in `assembleSnapshot` — so a stale fix can never
 * be served as if live.
 *
 * Fail-open + best-effort: every Redis op is wrapped so a Redis outage degrades
 * to "no snapshot" (peers simply arrive on the next live tick, exactly as
 * today). Keys are passed UNPREFIXED — the ioredis client applies REDIS_PREFIX
 * (matches the registerSharingSocket / rate-limit convention).
 *
 * Privacy: the cache is scoped identically to the live broadcast — only members
 * who are CURRENTLY sharing ever have a field — so the snapshot honors the same
 * opt-in model (a viewer-only or stopped member is never included), and nothing
 * here touches disk on the client or persists on the server.
 */

import type { LocationPeerUpdatePayload } from './types/contracts.js';

/**
 * Per-sharer field TTL on the crew hash. Mirrors `LIVE_LOCATION.STALE_MS`
 * (120s) in @festie/shared — the same window after which the client sweeps a
 * peer from the map. The backend can't import the shared constant (different
 * package manager), so it is mirrored here; keep the two in sync.
 */
const POSITION_TTL_MS = 120_000;

/** Default freshness window for what a snapshot returns (mirrors STALE_MS). */
const SNAPSHOT_FRESH_MS = POSITION_TTL_MS;

function positionsKey(crewId: string): string {
  return `loc:pos:${crewId}`;
}

/**
 * Cache a sharer's latest position for late-joiner snapshots. Best-effort:
 * swallows all errors (the live broadcast already happened; the cache is a
 * pure optimization). No-op when redis / crewId / userId is missing.
 */
export async function writeLivePosition(
  redis: any,
  crewId: string,
  payload: LocationPeerUpdatePayload,
): Promise<void> {
  if (!redis || !crewId || !payload || !payload.userId) return;
  try {
    const key = positionsKey(crewId);
    const pipeline = redis.pipeline();
    pipeline.hset(key, payload.userId, JSON.stringify(payload));
    pipeline.pexpire(key, POSITION_TTL_MS);
    await pipeline.exec();
  } catch {
    /* ephemeral cache — never block the live path on a Redis hiccup */
  }
}

/**
 * Remove a sharer's cached position (on stop / leave / disconnect / revoke) so
 * the next snapshot doesn't show a member who is no longer sharing. Best-effort;
 * the field's TTL reaps it anyway if this fails.
 */
export async function dropLivePosition(redis: any, crewId: string, userId: string): Promise<void> {
  if (!redis || !crewId || !userId) return;
  try {
    await redis.hdel(positionsKey(crewId), userId);
  } catch {
    /* TTL will reap it */
  }
}

/** A raw cache entry as read back from the Redis hash (value is JSON text). */
export interface SnapshotEntry {
  userId: string;
  value: string | Record<string, unknown> | null | undefined;
}

export interface AssembleSnapshotOptions {
  /** Epoch ms "now" used for the staleness cutoff. */
  now: number;
  /** Exclude this user (the requester renders their own marker locally). */
  selfUserId?: string | null;
  /** Drop fixes whose serverAt is older than this (defaults to ~STALE_MS). */
  freshMs?: number;
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function optionalFiniteNumber(v: unknown): number | undefined {
  return isFiniteNumber(v) ? v : undefined;
}

/**
 * PURE: turn raw crew-hash entries into a clean, validated, privacy-filtered
 * array of peer-update payloads for the `location:sync` ack.
 *
 * Drops: malformed JSON, entries missing required fields (userId / crewId /
 * serverAt / finite lat,lng), the requester's own entry, and any fix older than
 * `freshMs` (so a lingering field is never served as if live). Only whitelisted
 * fields are emitted — no unexpected key written into the cache can leak.
 */
export function assembleSnapshot(
  entries: SnapshotEntry[],
  { now, selfUserId, freshMs = SNAPSHOT_FRESH_MS }: AssembleSnapshotOptions,
): LocationPeerUpdatePayload[] {
  const peers: LocationPeerUpdatePayload[] = [];
  for (const entry of entries) {
    if (!entry) continue;
    let obj: any = entry.value;
    if (typeof obj === 'string') {
      try {
        obj = JSON.parse(obj);
      } catch {
        continue; // malformed JSON — skip
      }
    }
    if (!obj || typeof obj !== 'object') continue;

    const userId = typeof obj.userId === 'string' && obj.userId ? obj.userId : entry.userId;
    if (!userId || typeof userId !== 'string') continue;
    if (selfUserId && userId === selfUserId) continue; // exclude self

    const crewId = typeof obj.crewId === 'string' ? obj.crewId : '';
    const serverAt = typeof obj.serverAt === 'string' ? obj.serverAt : '';
    if (!crewId || !serverAt) continue;
    if (!isFiniteNumber(obj.lat) || !isFiniteNumber(obj.lng)) continue;

    // Staleness: drop anything older than the freshness window so a lingering
    // (un-HDEL'd) field is never served. Unparseable serverAt → treat as stale.
    const serverMs = Date.parse(serverAt);
    if (!Number.isFinite(serverMs) || now - serverMs > freshMs) continue;

    const username = typeof obj.username === 'string' ? obj.username : '';
    const capturedAt = typeof obj.capturedAt === 'string' ? obj.capturedAt : serverAt;

    peers.push({
      _v: 1,
      crewId,
      userId,
      username,
      lat: obj.lat,
      lng: obj.lng,
      accuracy: optionalFiniteNumber(obj.accuracy),
      heading: optionalFiniteNumber(obj.heading),
      speed: optionalFiniteNumber(obj.speed),
      capturedAt,
      serverAt,
    });
  }
  return peers;
}

/**
 * Read + assemble a crew's late-joiner snapshot in one call. Fail-open: returns
 * [] on any Redis error or when redis / crewId is missing, so a snapshot request
 * never errors the join path.
 */
export async function readLiveSnapshot(
  redis: any,
  crewId: string,
  opts: AssembleSnapshotOptions,
): Promise<LocationPeerUpdatePayload[]> {
  if (!redis || !crewId) return [];
  try {
    const raw = (await redis.hgetall(positionsKey(crewId))) || {};
    const entries: SnapshotEntry[] = Object.entries(raw).map(([userId, value]) => ({
      userId,
      value: value as string,
    }));
    return assembleSnapshot(entries, opts);
  } catch {
    return [];
  }
}
