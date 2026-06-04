// Copyright (c) 2026 Asir Khan. All rights reserved.
// Licensed under the Business Source License 1.1. See LICENSE file for details.

/**
 * planSnapshot.ts — versioned P2P codec for sharing a festival plan between two
 * OFFLINE phones (F3 / M5). Both the QR-render path and the SMS-handoff path
 * consume the SAME string this produces, so the format is defined once here.
 *
 * Threat model: `decodePlanSnapshot` receives a string SCANNED FROM ANOTHER
 * DEVICE (a QR code or pasted SMS body) — fully untrusted input. It must:
 *   - never throw on garbage,
 *   - reject oversized payloads BEFORE decoding (QR/SMS DoS + memory guard),
 *   - strictly Zod-validate the decoded shape, dropping anything malformed,
 *   - reject unknown envelope versions so a future format can't be
 *     mis-interpreted by an old client.
 *
 * The payload is deliberately minimal — festival id + name, a bounded list of
 * picks, and an optional meeting point — to stay inside a single scannable QR
 * and a short SMS. It is NOT a full plan sync; it is a "get my dead-battery
 * friend onto the same page" snapshot.
 *
 * Pure + platform-agnostic: the base64url codec below is hand-rolled so it works
 * identically on web and React Native without relying on `Buffer`, `btoa`, or
 * `atob` (none of which are guaranteed present in the RN/Hermes runtime).
 */

import { z } from 'zod';

/** Current envelope version. Bump when the payload shape changes incompatibly. */
export const PLAN_SNAPSHOT_VERSION = 1 as const;

/**
 * Hard cap on the ENCODED string length. A version-2 QR code at error
 * correction L tops out well under this; SMS segments are even smaller. We check
 * this on the raw input BEFORE base64-decoding so an attacker can't force us to
 * allocate a huge buffer from a tiny-looking trigger. ~4 KB of encoded text is
 * generous for the bounded payload below and still scans/sends reliably.
 */
export const MAX_ENCODED_LENGTH = 4096;

/** Max picks carried in a snapshot. Keeps the QR small and bounds parse work. */
export const MAX_PICKS = 50;

/** Priority a pick can carry. Mirrors the app's must/want/maybe model. */
export const PICK_PRIORITIES = ['must', 'want', 'maybe'] as const;
export type PickPriority = (typeof PICK_PRIORITIES)[number];

/**
 * Zod schema for ONE pick. Kept tiny: a set id + a priority. `.strict()` so an
 * attacker can't smuggle extra fields through.
 */
const pickSchema = z
  .object({
    setId: z.string().min(1).max(128),
    priority: z.enum(PICK_PRIORITIES),
  })
  .strict();

/** Optional meeting point: a human label + a coord. Lat/lng range-checked. */
const meetingPointSchema = z
  .object({
    label: z.string().min(1).max(120),
    lat: z.number().finite().min(-90).max(90),
    lng: z.number().finite().min(-180).max(180),
  })
  .strict();

/**
 * Full versioned envelope. `v` is validated FIRST (as a literal) so an unknown
 * version is reported as a clean version mismatch rather than a field error.
 */
const envelopeSchema = z
  .object({
    v: z.literal(PLAN_SNAPSHOT_VERSION),
    festivalId: z.string().min(1).max(128),
    festivalName: z.string().min(1).max(200),
    picks: z.array(pickSchema).max(MAX_PICKS),
    meetingPoint: meetingPointSchema.optional(),
  })
  .strict();

/** The validated, decoded snapshot a consumer receives. */
export type PlanSnapshot = z.infer<typeof envelopeSchema>;

/** Input accepted by {@link encodePlanSnapshot} (the version is added for you). */
export interface PlanSnapshotInput {
  festivalId: string;
  festivalName: string;
  picks: Array<{ setId: string; priority: PickPriority }>;
  meetingPoint?: { label: string; lat: number; lng: number };
}

/** Result of decoding untrusted input — a discriminated union, never a throw. */
export type DecodeResult = { ok: true; data: PlanSnapshot } | { ok: false; error: string };

// ---------------------------------------------------------------------------
// app <-> codec priority mapping
// ---------------------------------------------------------------------------
// The app's domain `Priority` is 'must' | 'want-to-see' | 'maybe'; the wire
// codec uses the shorter 'want' (saves QR bytes + keeps the snapshot terse).
// These two pure helpers are the single source of truth for the mapping so the
// QR-share and QR-scan paths (and any future consumer) never hand-roll it or
// drift. They live in shared, not in mobile, per the business-logic-in-shared
// rule. `appPriority` is typed loosely (string) because callers pass the app's
// `Priority` type which shared/utils can't import without a cycle; unknown
// inputs fall back to 'maybe'.

/** Map an app domain priority string to the compact wire {@link PickPriority}. */
export function toPickPriority(appPriority: string): PickPriority {
  if (appPriority === 'must') return 'must';
  if (appPriority === 'want-to-see' || appPriority === 'want') return 'want';
  return 'maybe';
}

/**
 * Map a wire {@link PickPriority} back to the app domain priority string
 * ('want' -> 'want-to-see'). Returned as a plain string so callers can assign
 * it to their `Priority` type without shared needing to import that type.
 */
export function fromPickPriority(priority: PickPriority): 'must' | 'want-to-see' | 'maybe' {
  if (priority === 'must') return 'must';
  if (priority === 'want') return 'want-to-see';
  return 'maybe';
}

// ---------------------------------------------------------------------------
// base64url codec (UTF-8 safe, no Buffer/btoa/atob dependency)
// ---------------------------------------------------------------------------

const B64URL_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

// Reverse lookup: char code -> 6-bit value, or -1 for non-alphabet chars.
const B64URL_LOOKUP: Int8Array = (() => {
  const table = new Int8Array(128).fill(-1);
  for (let i = 0; i < B64URL_ALPHABET.length; i++) {
    table[B64URL_ALPHABET.charCodeAt(i)] = i;
  }
  return table;
})();

/** UTF-8 encode a string to a byte array (works without TextEncoder on Hermes). */
function utf8Encode(str: string): number[] {
  const bytes: number[] = [];
  for (let i = 0; i < str.length; i++) {
    let code = str.charCodeAt(i);
    if (code < 0x80) {
      bytes.push(code);
    } else if (code < 0x800) {
      bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    } else if (code >= 0xd800 && code <= 0xdbff && i + 1 < str.length) {
      // High surrogate — combine with the following low surrogate.
      const next = str.charCodeAt(i + 1);
      code = 0x10000 + ((code & 0x3ff) << 10) + (next & 0x3ff);
      i++;
      bytes.push(0xf0 | (code >> 18), 0x80 | ((code >> 12) & 0x3f), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    } else {
      bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    }
  }
  return bytes;
}

/** UTF-8 decode a byte array back to a string. Throws on malformed sequences. */
function utf8Decode(bytes: number[]): string {
  let out = '';
  let i = 0;
  while (i < bytes.length) {
    const b0 = bytes[i++] ?? 0;
    if (b0 < 0x80) {
      out += String.fromCharCode(b0);
    } else if (b0 >= 0xc0 && b0 < 0xe0) {
      const b1 = bytes[i++] ?? 0;
      if ((b1 & 0xc0) !== 0x80) throw new Error('bad utf8');
      out += String.fromCharCode(((b0 & 0x1f) << 6) | (b1 & 0x3f));
    } else if (b0 >= 0xe0 && b0 < 0xf0) {
      const b1 = bytes[i++] ?? 0;
      const b2 = bytes[i++] ?? 0;
      if ((b1 & 0xc0) !== 0x80 || (b2 & 0xc0) !== 0x80) throw new Error('bad utf8');
      out += String.fromCharCode(((b0 & 0x0f) << 12) | ((b1 & 0x3f) << 6) | (b2 & 0x3f));
    } else if (b0 >= 0xf0) {
      const b1 = bytes[i++] ?? 0;
      const b2 = bytes[i++] ?? 0;
      const b3 = bytes[i++] ?? 0;
      if ((b1 & 0xc0) !== 0x80 || (b2 & 0xc0) !== 0x80 || (b3 & 0xc0) !== 0x80) throw new Error('bad utf8');
      const cp = ((b0 & 0x07) << 18) | ((b1 & 0x3f) << 12) | ((b2 & 0x3f) << 6) | (b3 & 0x3f);
      const off = cp - 0x10000;
      out += String.fromCharCode(0xd800 + (off >> 10), 0xdc00 + (off & 0x3ff));
    } else {
      throw new Error('bad utf8');
    }
  }
  return out;
}

/** Encode a UTF-8 string to base64url (no padding). */
function toBase64Url(str: string): string {
  const bytes = utf8Encode(str);
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i] ?? 0;
    const b1 = i + 1 < bytes.length ? (bytes[i + 1] ?? -1) : -1;
    const b2 = i + 2 < bytes.length ? (bytes[i + 2] ?? -1) : -1;
    out += B64URL_ALPHABET[b0 >> 2] ?? '';
    out += B64URL_ALPHABET[((b0 & 0x03) << 4) | (b1 >= 0 ? b1 >> 4 : 0)] ?? '';
    if (b1 >= 0) out += B64URL_ALPHABET[((b1 & 0x0f) << 2) | (b2 >= 0 ? b2 >> 6 : 0)] ?? '';
    if (b2 >= 0) out += B64URL_ALPHABET[b2 & 0x3f] ?? '';
  }
  return out;
}

/** Decode a base64url string back to UTF-8. Throws on any non-alphabet char. */
function fromBase64Url(str: string): string {
  const bytes: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);
    const val = code < 128 ? (B64URL_LOOKUP[code] ?? -1) : -1;
    if (val < 0) throw new Error('bad base64url');
    buffer = (buffer << 6) | val;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >> bits) & 0xff);
    }
  }
  return utf8Decode(bytes);
}

// ---------------------------------------------------------------------------
// public API
// ---------------------------------------------------------------------------

/**
 * Encode a plan snapshot into a compact, URL/QR-safe string. The payload is
 * minified JSON (the envelope schema, version-stamped) then base64url-encoded so
 * it carries cleanly inside a QR code or an SMS body with no escaping concerns.
 *
 * Picks are truncated to {@link MAX_PICKS} so an over-long plan still produces a
 * scannable code rather than an unscannable monster. The caller is responsible
 * for choosing WHICH picks matter most (e.g. must > want > maybe) before calling.
 */
export function encodePlanSnapshot(input: PlanSnapshotInput): string {
  const envelope: PlanSnapshot = {
    v: PLAN_SNAPSHOT_VERSION,
    festivalId: input.festivalId,
    festivalName: input.festivalName,
    picks: input.picks.slice(0, MAX_PICKS),
    ...(input.meetingPoint ? { meetingPoint: input.meetingPoint } : {}),
  };
  return toBase64Url(JSON.stringify(envelope));
}

/**
 * Decode + strictly validate an UNTRUSTED snapshot string (scanned QR / pasted
 * SMS). Never throws — every failure mode returns `{ ok: false, error }`:
 *   - empty / non-string input,
 *   - oversized input (checked before decode),
 *   - non-base64url / malformed-utf8 / non-JSON content,
 *   - unknown envelope version,
 *   - any field that fails the Zod schema (wrong type, out-of-range coord, too
 *     many picks, extra keys via `.strict()`).
 */
export function decodePlanSnapshot(text: unknown): DecodeResult {
  if (typeof text !== 'string' || text.length === 0) {
    return { ok: false, error: 'empty or non-string input' };
  }
  if (text.length > MAX_ENCODED_LENGTH) {
    return { ok: false, error: 'input exceeds maximum size' };
  }

  let json: string;
  try {
    json = fromBase64Url(text);
  } catch {
    return { ok: false, error: 'not valid base64url' };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return { ok: false, error: 'not valid JSON' };
  }

  // Distinguish a version mismatch from a generic shape error for clearer UX.
  if (parsed && typeof parsed === 'object' && 'v' in parsed && (parsed as { v: unknown }).v !== PLAN_SNAPSHOT_VERSION) {
    return { ok: false, error: 'unsupported snapshot version' };
  }

  const result = envelopeSchema.safeParse(parsed);
  if (!result.success) {
    return { ok: false, error: 'snapshot failed validation' };
  }
  return { ok: true, data: result.data };
}
