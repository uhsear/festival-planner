#!/usr/bin/env node
// Copyright (c) 2026 Asir Khan. All rights reserved.
// All Rights Reserved. See the LICENSE file.
//
// gen-festival-pmtiles.mjs — OPS tool (Phase 3B). Produce a per-festival offline
// PMTiles vector basemap by clipping a SOURCE planet/region archive down to the
// festival's bounding box, then place it where the app can serve it.
//
// ┌──────────────────────────────────────────────────────────────────────────┐
// │ PREREQUISITE — the code CANNOT self-provide this.                          │
// │                                                                            │
// │ This script needs a SOURCE vector basemap to clip from. Festie does not    │
// │ (and should not) bundle a planet/region tileset — it is gigabytes and is   │
// │ an OPS asset, not source. You must obtain ONE of:                          │
// │                                                                            │
// │   • A Protomaps "basemap" build  — https://docs.protomaps.com/basemaps/    │
// │     (download a region/planet .pmtiles, or build your own with planetiler) │
// │   • An OSM extract (.osm.pbf) for the region, then build a .pmtiles/.mbtiles│
// │     with tippecanoe / planetiler.                                          │
// │                                                                            │
// │ The source's vector SCHEMA must expose the source-layers our style reads   │
// │ (see packages/shared/src/utils/mapStyle.ts → pmtilesVectorStyle):          │
// │   earth, landuse, water, roads, buildings                                  │
// │ The Protomaps basemap schema matches these names out of the box. Missing   │
// │ layers simply draw nothing (graceful) — but you get an empty map.          │
// └──────────────────────────────────────────────────────────────────────────┘
//
// TOOLS (install separately; not Festie deps):
//   • pmtiles CLI    — `go install github.com/protomaps/go-pmtiles@latest`
//                       (the `pmtiles extract` subcommand clips by bbox)
//   • OR tippecanoe  — for building a .pmtiles from GeoJSON/OSM (region build)
//
// USAGE:
//   node scripts/gen-festival-pmtiles.mjs \
//     --festival <festivalId> \
//     --source <region.pmtiles | https://example.com/region.pmtiles> \
//     [--bbox <west,south,east,north>]   # else derived from the festival mapConfig
//     [--maxzoom 16] [--minzoom 0] \
//     [--out public/uploads/basemaps/<festivalId>.pmtiles] \
//     [--db <FP_POSTGRES_URI>]           # to read the festival's bounds + write back the URL
//     [--public-origin https://festie.us]
//
// The festival's bbox is derived EXACTLY as the app frames the map
// (pickFestivalCamera): from map_config.bounds ([[west,south],[east,north]]),
// falling back to map_config.center ± a small pad. Pass --bbox to override.
//
// OUTPUT + WIRING:
//   1. Writes the clipped archive to --out (default public/uploads/basemaps/).
//      The Express static handler at /uploads/basemaps (lib/middleware.ts) serves
//      it with byte-range support + immutable caching.
//   2. The persisted pointer is map_config.offlineBasemap.pmtilesUrl (Phase 3A
//      schema). Set it (admin festival editor, or --db here) to:
//        https://<public-origin>/uploads/basemaps/<festivalId>.pmtiles
//      The mobile app GET /api/v1/festivals/:id/basemap 302-redirects to it; the
//      client caches it locally (packages/mobile/lib/basemapCache.ts).
//
// IDEMPOTENT + SAFE: this script only READS the source and WRITES the output (and
// optionally updates the one map_config row). It never deletes source data. If
// the festival has no bounds AND no --bbox, it exits non-zero with guidance
// rather than guessing — an over-wide extract would defeat the point.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) {
        args[key] = next;
        i++;
      } else {
        args[key] = true;
      }
    }
  }
  return args;
}

function die(msg, code = 1) {
  console.error(`\n[gen-festival-pmtiles] ${msg}\n`);
  process.exit(code);
}

/**
 * Derive a [west,south,east,north] bbox from a festival map_config the SAME way
 * the app frames the camera (pickFestivalCamera): explicit bounds win; else pad
 * an explicit center; else null (caller must supply --bbox).
 */
function bboxFromMapConfig(mapConfig) {
  if (!mapConfig || typeof mapConfig !== 'object') return null;
  const b = mapConfig.bounds;
  // bounds: [[west, south], [east, north]]
  if (
    Array.isArray(b) &&
    b.length === 2 &&
    Array.isArray(b[0]) &&
    Array.isArray(b[1]) &&
    b[0].length === 2 &&
    b[1].length === 2 &&
    b.flat().every((n) => Number.isFinite(n))
  ) {
    const [[west, south], [east, north]] = b;
    return [west, south, east, north];
  }
  // center: [lng, lat] → pad ~1.5km box (0.012° lat ≈ 1.3km; lng scaled by cos).
  const c = mapConfig.center;
  if (Array.isArray(c) && c.length === 2 && c.every((n) => Number.isFinite(n))) {
    const [lng, lat] = c;
    const padLat = 0.012;
    const padLng = padLat / Math.max(0.1, Math.cos((lat * Math.PI) / 180));
    return [lng - padLng, lat - padLat, lng + padLng, lat + padLat];
  }
  return null;
}

async function readFestivalMapConfig(dbUrl, festivalId) {
  // Lazy import so the script runs (for --bbox flows) without `pg` present.
  let Pg;
  try {
    Pg = (await import('pg')).default;
  } catch {
    die('--db given but `pg` is not installed in this environment. Run from the repo root (npm i) or pass --bbox.');
  }
  const pool = new Pg.Pool({ connectionString: dbUrl });
  try {
    const { rows } = await pool.query('SELECT map_config FROM festivals WHERE id = $1 LIMIT 1', [festivalId]);
    if (!rows.length) die(`festival "${festivalId}" not found in the database.`);
    return rows[0].map_config || null;
  } finally {
    await pool.end();
  }
}

async function writeBasemapUrl(dbUrl, festivalId, url) {
  const Pg = (await import('pg')).default;
  const pool = new Pg.Pool({ connectionString: dbUrl });
  try {
    // Merge offlineBasemap into the existing map_config jsonb (don't clobber
    // amenities/zones/siteplan). version is required by the schema → default to 1.
    await pool.query(
      `UPDATE festivals
         SET map_config = jsonb_set(
               jsonb_set(
                 COALESCE(map_config, '{"version":1}'::jsonb),
                 '{version}', '1'::jsonb, true),
               '{offlineBasemap}',
               jsonb_build_object('pmtilesUrl', $2::text),
               true)
       WHERE id = $1`,
      [festivalId, url],
    );
    console.log(`[gen-festival-pmtiles] wrote offlineBasemap.pmtilesUrl for "${festivalId}".`);
  } finally {
    await pool.end();
  }
}

function runPmtilesExtract({ source, out, bbox, minzoom, maxzoom }) {
  // go-pmtiles: `pmtiles extract SOURCE OUT --bbox=w,s,e,n [--minzoom --maxzoom]`
  // SOURCE may be a local path or an https URL (go-pmtiles range-reads remotely).
  const bboxArg = `${bbox[0]},${bbox[1]},${bbox[2]},${bbox[3]}`;
  const cmdArgs = ['extract', source, out, `--bbox=${bboxArg}`];
  if (minzoom != null) cmdArgs.push(`--minzoom=${minzoom}`);
  if (maxzoom != null) cmdArgs.push(`--maxzoom=${maxzoom}`);
  console.log(`[gen-festival-pmtiles] pmtiles ${cmdArgs.join(' ')}`);
  const res = spawnSync('pmtiles', cmdArgs, { stdio: 'inherit' });
  if (res.error && res.error.code === 'ENOENT') {
    die(
      'the `pmtiles` CLI was not found on PATH. Install go-pmtiles:\n' +
        '  go install github.com/protomaps/go-pmtiles@latest\n' +
        'or see https://docs.protomaps.com/pmtiles/cli',
    );
  }
  if (res.status !== 0) die(`pmtiles extract exited with code ${res.status}.`, res.status || 1);
}

async function main() {
  const args = parseArgs(process.argv);
  const festivalId = args.festival;
  const source = args.source;

  if (!festivalId) die('missing --festival <festivalId>. See the header of this file for usage.');
  if (!source) die('missing --source <region.pmtiles | https url>. See the PREREQUISITE block at the top.');

  // Resolve the bbox: explicit --bbox wins; else derive from the festival's
  // map_config (requires --db or a local --map-config json — here we use --db).
  let bbox = null;
  if (typeof args.bbox === 'string') {
    const parts = args.bbox.split(',').map((s) => Number(s.trim()));
    if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) {
      die('--bbox must be "west,south,east,north" with four finite numbers.');
    }
    bbox = parts;
  } else if (args.db) {
    const mapConfig = await readFestivalMapConfig(String(args.db), festivalId);
    bbox = bboxFromMapConfig(mapConfig);
    if (!bbox) {
      die(
        `festival "${festivalId}" has no map_config.bounds or .center to derive a bbox from.\n` +
          'Set the festival bounds in the admin map editor first, or pass --bbox explicitly.',
      );
    }
  } else {
    die('provide either --bbox "w,s,e,n" OR --db <postgres-uri> (to derive the bbox from the festival bounds).');
  }

  const out =
    typeof args.out === 'string'
      ? args.out
      : path.join('public', 'uploads', 'basemaps', `${festivalId}.pmtiles`);
  const outDir = path.dirname(out);
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

  const minzoom = args.minzoom != null ? Number(args.minzoom) : undefined;
  const maxzoom = args.maxzoom != null ? Number(args.maxzoom) : 16;

  console.log(`[gen-festival-pmtiles] festival=${festivalId} bbox=[${bbox.join(', ')}] out=${out}`);
  runPmtilesExtract({ source, out, bbox, minzoom, maxzoom });
  console.log(`[gen-festival-pmtiles] wrote ${out}`);

  // Optionally write the public URL back into the festival's map_config.
  if (args.db && (args['public-origin'] || args.publicOrigin)) {
    const origin = String(args['public-origin'] || args.publicOrigin).replace(/\/+$/, '');
    const fileName = path.basename(out);
    const url = `${origin}/uploads/basemaps/${fileName}`;
    if (!/^https:\/\//i.test(url)) {
      die(`refusing to write a non-https basemap URL: ${url}. --public-origin must be https.`);
    }
    await writeBasemapUrl(String(args.db), festivalId, url);
    console.log(`[gen-festival-pmtiles] offlineBasemap.pmtilesUrl = ${url}`);
  } else {
    console.log(
      '\n[gen-festival-pmtiles] NEXT STEP — set the festival pointer:\n' +
        '  map_config.offlineBasemap.pmtilesUrl =\n' +
        `    https://<your-origin>/uploads/basemaps/${path.basename(out)}\n` +
        '  (admin festival map editor, or re-run with --db and --public-origin).',
    );
  }
}

main().catch((err) => die(err?.stack || String(err)));
