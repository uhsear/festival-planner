import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildMapHtml } from './mapDocument';
import {
  MAPLIBRE_CSS_SRC,
  MAPLIBRE_JS_SRC,
  MAPLIBRE_SHARED_SRC,
  MAPLIBRE_WORKER_SRC,
  PMTILES_JS_SRC,
} from '../vendor/mapRuntime';

// The mobile test harness is node-only and cannot render a WebView, so these
// assert on the exact strings the WebView is handed: the generated document and
// the CSP inside it. That is the level at which "the map no longer fetches
// anything from a CDN" is actually decidable here.

const CENTER = { latitude: 28.5, longitude: -81.4 };
const RASTER_STYLE = { version: 8, sources: {}, layers: [] };

/** Pull the CSP out of the document's <meta http-equiv> and split it by directive. */
function cspOf(html: string): Record<string, string> {
  const m = html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]*)"/);
  if (!m || !m[1]) throw new Error('no CSP meta in document');
  const out: Record<string, string> = {};
  for (const part of m[1].split('; ')) {
    const sp = part.indexOf(' ');
    if (sp === -1) out[part] = '';
    else out[part.slice(0, sp)] = part.slice(sp + 1);
  }
  return out;
}

/** The four shapes buildMapHtml can produce, by basemap/site-plan configuration. */
const VARIANTS: [string, string][] = [
  ['no offline basemap (online OSM raster)', buildMapHtml(CENTER, RASTER_STYLE, null, false, null)],
  ['remote PMTiles basemap', buildMapHtml(CENTER, RASTER_STYLE, 'festie.us', false, null)],
  ['local cached PMTiles archive', buildMapHtml(CENTER, RASTER_STYLE, null, true, null)],
  ['site-plan overlay', buildMapHtml(CENTER, RASTER_STYLE, null, false, 'cdn.example.org')],
];

describe('map document — no CDN runtime', () => {
  for (const [name, html] of VARIANTS) {
    it(`mentions no unpkg URL at all (${name})`, () => {
      expect(html.includes('unpkg')).toBe(false);
    });

    it(`fetches no external subresource to boot the map (${name})`, () => {
      // Every <script>/<link> that could pull code or styles over the network.
      expect(/<script[^>]+src=/i.test(html)).toBe(false);
      expect(/<link\b/i.test(html)).toBe(false);
    });
  }

  it('inlines the vendored MapLibre runtime and stylesheet', () => {
    const [, html] = VARIANTS[0]!;
    // MapLibre 6 is ESM-only, so all three chunks ride along as non-executing
    // text blocks that the bootstrap turns into blob: modules.
    expect(html.includes(`<script id="mlgl-main" type="text/plain">${MAPLIBRE_JS_SRC}</script>`)).toBe(true);
    expect(html.includes(`<script id="mlgl-shared" type="text/plain">${MAPLIBRE_SHARED_SRC}</script>`)).toBe(
      true,
    );
    expect(html.includes(`<script id="mlgl-worker" type="text/plain">${MAPLIBRE_WORKER_SRC}</script>`)).toBe(
      true,
    );
    expect(html.includes(`<style>${MAPLIBRE_CSS_SRC}</style>`)).toBe(true);
  });

  it('inlines the PMTiles UMD only when a vector basemap is configured', () => {
    const raster = buildMapHtml(CENTER, RASTER_STYLE, null, false, null);
    const remote = buildMapHtml(CENTER, RASTER_STYLE, 'festie.us', false, null);
    const local = buildMapHtml(CENTER, RASTER_STYLE, null, true, null);
    expect(raster.includes(PMTILES_JS_SRC)).toBe(false);
    expect(remote.includes(`<script>${PMTILES_JS_SRC}</script>`)).toBe(true);
    expect(local.includes(`<script>${PMTILES_JS_SRC}</script>`)).toBe(true);
  });
});

describe('map document CSP', () => {
  for (const [name, html] of VARIANTS) {
    it(`allows no unpkg.com origin in any directive (${name})`, () => {
      for (const value of Object.values(cspOf(html))) expect(value).not.toContain('unpkg');
    });

    it(`grants script-src and style-src no remote origin (${name})`, () => {
      const csp = cspOf(html);
      // 'unsafe-inline' covers the vendored blobs; blob: is MapLibre's workers.
      expect(csp['script-src']).toBe("'unsafe-inline' blob:");
      expect(csp['style-src']).toBe("'unsafe-inline'");
      expect(csp['default-src']).toBe("'none'");
    });
  }

  it('still permits exactly what TILES need', () => {
    const raster = cspOf(VARIANTS[0]![1]);
    // The online OSM raster basemap is still a network dependency.
    expect(raster['img-src']).toContain('https://*.tile.openstreetmap.org');
    expect(raster['connect-src']).toContain('https://*.tile.openstreetmap.org');

    // A festival's own remote PMTiles archive is byte-range fetched.
    const remote = cspOf(VARIANTS[1]![1]);
    expect(remote['connect-src']).toContain('https://festie.us');
    expect(remote['img-src']).toContain('https://festie.us');

    // A cached archive is read over file:, and adds no remote origin.
    const local = cspOf(VARIANTS[2]![1]);
    expect(local['connect-src']).toContain('file:');
    expect(local['img-src']).toContain('file:');
    expect(local['connect-src']).not.toContain('https://festie.us');

    // The site-plan raster is image-only — never connect-src.
    const siteplan = cspOf(VARIANTS[3]![1]);
    expect(siteplan['img-src']).toContain('https://cdn.example.org');
    expect(siteplan['connect-src']).not.toContain('cdn.example.org');
  });
});

describe('vendored runtime', () => {
  const dist = (p: string) => join(dirname(fileURLToPath(import.meta.url)), '..', 'node_modules', p);

  // vendor/mapRuntime.ts is generated by scripts/vendor-map-runtime.mjs. Bumping
  // maplibre-gl or pmtiles without re-running it would ship a stale runtime, so
  // fail here rather than in the field.
  it('matches the installed packages byte for byte', () => {
    const fresh: [string, string, string][] = [
      ['maplibre-gl.mjs', MAPLIBRE_JS_SRC, 'maplibre-gl/dist/maplibre-gl.mjs'],
      ['maplibre-gl-shared.mjs', MAPLIBRE_SHARED_SRC, 'maplibre-gl/dist/maplibre-gl-shared.mjs'],
      ['maplibre-gl-worker.mjs', MAPLIBRE_WORKER_SRC, 'maplibre-gl/dist/maplibre-gl-worker.mjs'],
      ['maplibre-gl.css', MAPLIBRE_CSS_SRC, 'maplibre-gl/dist/maplibre-gl.css'],
      ['pmtiles.js', PMTILES_JS_SRC, 'pmtiles/dist/pmtiles.js'],
    ];
    for (const [name, vendored, rel] of fresh) {
      expect(
        vendored === readFileSync(dist(rel), 'utf8'),
        `vendor/mapRuntime.ts is stale for ${name} — run: node scripts/vendor-map-runtime.mjs`,
      ).toBe(true);
    }
  });

  it('carries no closing script/style tag that would break out of the inline host', () => {
    for (const src of [
      MAPLIBRE_JS_SRC,
      MAPLIBRE_SHARED_SRC,
      MAPLIBRE_WORKER_SRC,
      MAPLIBRE_CSS_SRC,
      PMTILES_JS_SRC,
    ]) {
      expect(/<\/(script|style)/i.test(src)).toBe(false);
    }
  });

  // The worker shim re-serializes these chunks at RUNTIME with JSON.stringify,
  // which leaves U+2028/U+2029 literal. Inside the JS string literal that shim
  // builds, either one is a line terminator and the worker dies on a SyntaxError.
  // The byte-for-byte drift test above cannot catch it: a future dist carrying
  // one would be vendored faithfully and still match node_modules.
  it('carries no U+2028/U+2029 in a blob that is re-serialized at runtime', () => {
    for (const src of [MAPLIBRE_JS_SRC, MAPLIBRE_SHARED_SRC, MAPLIBRE_WORKER_SRC, PMTILES_JS_SRC]) {
      expect(/[\u2028\u2029]/.test(src)).toBe(false);
    }
  });

  // The bootstrap rewrites this specifier to the shared chunk's blob: URL with a
  // single-occurrence String.replace. More than one hit (or none) would leave a
  // module MapLibre cannot resolve, and the map would never boot.
  it('references the shared chunk exactly once per importing bundle', () => {
    for (const src of [MAPLIBRE_JS_SRC, MAPLIBRE_WORKER_SRC]) {
      expect(src.split('./maplibre-gl-shared.mjs').length - 1).toBe(1);
    }
  });
});
