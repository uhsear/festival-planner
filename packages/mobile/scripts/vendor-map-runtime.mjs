#!/usr/bin/env node
// Regenerate vendor/mapRuntime.ts from the INSTALLED maplibre-gl / pmtiles
// packages, so the WebView map document can inline its runtime instead of
// fetching it from a third-party CDN at runtime.
//
// Run from packages/mobile after changing either dependency:
//   node scripts/vendor-map-runtime.mjs
//
// lib/mapDocument.test.ts fails if the committed copy drifts from node_modules,
// so a forgotten regen is caught by the test gate, not in the field.
//
// It also emits vendor/LICENSES.md. Both libraries are BSD-3-Clause, which
// requires the copyright notice to travel with any redistribution of source —
// and inlining these bytes into the app bundle is a redistribution. maplibre-gl
// keeps its own @license banner in its dist; the pmtiles dist carries none, so
// the notice file is the only place that attribution exists.
//
// maplibre-gl's tarball ships its LICENSE, so that text is read straight from
// node_modules. The pmtiles tarball ships none, so its upstream text is checked
// in under vendor/licenses/ and read from there — this script never touches the
// network. Refresh that copy from the upstream repository when the dependency
// is bumped; vendor/licenses/README.md records where each file came from.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const req = (p) => join(root, 'node_modules', p);

/**
 * Serialize `src` as a plain-ASCII TypeScript string literal. JSON.stringify
 * handles quotes/backslashes/control chars; the extra pass escapes every
 * non-ASCII code unit (and U+2028/U+2029, which JSON leaves literal but are
 * line terminators inside a JS string) so the generated source file stays
 * ASCII-only, like the rest of this package.
 */
const asciiLiteral = (src) =>
  JSON.stringify(src).replace(/[^\x20-\x7e]/g, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));

const version = (pkg) => JSON.parse(readFileSync(req(`${pkg}/package.json`), 'utf8')).version;

// Copied VERBATIM, so the drift guard in lib/mapDocument.test.ts can compare
// them byte for byte against node_modules. The trailing `//# sourceMappingURL=`
// each build carries is left alone: the .map files are dev-only and not
// vendored, and the CSP's `default-src 'none'` blocks the lookup anyway, so the
// reference is inert outside devtools.
//
// MapLibre 6 dropped the UMD bundle (`dist/maplibre-gl.js`) and ships ESM only,
// split across three files: the entry module, the shared chunk both the entry
// and the worker import, and the worker itself. All three are vendored, because
// the WebView document has no origin to fetch the other two from — see
// lib/mapDocument.ts for how it stitches them back together with blob: URLs.
const maplibreJs = readFileSync(req('maplibre-gl/dist/maplibre-gl.mjs'), 'utf8');
const maplibreShared = readFileSync(req('maplibre-gl/dist/maplibre-gl-shared.mjs'), 'utf8');
const maplibreWorker = readFileSync(req('maplibre-gl/dist/maplibre-gl-worker.mjs'), 'utf8');
const maplibreCss = readFileSync(req('maplibre-gl/dist/maplibre-gl.css'), 'utf8');
const pmtilesJs = readFileSync(req('pmtiles/dist/pmtiles.js'), 'utf8');

// mapDocument.ts rewrites this ONE relative specifier in each bundle to the
// blob: URL of the shared chunk. Exactly one occurrence per file is the whole
// assumption; fail here rather than ship a document whose runtime cannot load.
const SHARED_SPECIFIER = './maplibre-gl-shared.mjs';
for (const [name, src] of [
  ['maplibre-gl.mjs', maplibreJs],
  ['maplibre-gl-worker.mjs', maplibreWorker],
]) {
  const hits = src.split(SHARED_SPECIFIER).length - 1;
  if (hits !== 1) throw new Error(`${name} references ${SHARED_SPECIFIER} ${hits} times; expected exactly 1`);
}

// mapDocument.ts re-serializes the shared + worker chunks at RUNTIME with
// JSON.stringify, to embed them in the classic worker shim. JSON.stringify
// leaves U+2028/U+2029 literal, and inside the JS string literal that shim
// builds either one is a line terminator, so the worker would fail to parse.
// Neither library contains one today; fail here rather than ship that.
for (const [name, src] of [
  ['maplibre-gl.mjs', maplibreJs],
  ['maplibre-gl-shared.mjs', maplibreShared],
  ['maplibre-gl-worker.mjs', maplibreWorker],
  ['pmtiles.js', pmtilesJs],
]) {
  if (/[\u2028\u2029]/.test(src)) throw new Error(`${name} contains U+2028/U+2029; cannot re-serialize at runtime`);
}

// A `</script` anywhere in a vendored blob would close the inline <script> that
// hosts it and break the document (and open an injection seam). Neither library
// contains one today; fail loudly rather than emit a broken document if that
// ever changes.
for (const [name, src] of [
  ['maplibre-gl.mjs', maplibreJs],
  ['maplibre-gl-shared.mjs', maplibreShared],
  ['maplibre-gl-worker.mjs', maplibreWorker],
  ['maplibre-gl.css', maplibreCss],
  ['pmtiles.js', pmtilesJs],
]) {
  if (/<\/(script|style)/i.test(src)) throw new Error(`${name} contains a closing script/style tag; cannot inline`);
}

const out = `// GENERATED FILE - DO NOT EDIT BY HAND.
// Produced by scripts/vendor-map-runtime.mjs from maplibre-gl@${version('maplibre-gl')} and
// pmtiles@${version('pmtiles')}, the versions installed in packages/mobile. See
// lib/mapDocument.ts for why the WebView map inlines its runtime rather than
// fetching it from a CDN, and lib/mapDocument.test.ts for the drift guard that
// fails if these bytes stop matching node_modules.

/** maplibre-gl/dist/maplibre-gl.mjs (ESM entry), verbatim. */
export const MAPLIBRE_JS_SRC = ${asciiLiteral(maplibreJs)};

/** maplibre-gl/dist/maplibre-gl-shared.mjs (chunk the entry + worker import), verbatim. */
export const MAPLIBRE_SHARED_SRC = ${asciiLiteral(maplibreShared)};

/** maplibre-gl/dist/maplibre-gl-worker.mjs, verbatim. */
export const MAPLIBRE_WORKER_SRC = ${asciiLiteral(maplibreWorker)};

/** maplibre-gl/dist/maplibre-gl.css, verbatim. */
export const MAPLIBRE_CSS_SRC = ${asciiLiteral(maplibreCss)};

/** pmtiles/dist/pmtiles.js (IIFE exposing the \`pmtiles\` global), verbatim. */
export const PMTILES_JS_SRC = ${asciiLiteral(pmtilesJs)};
`;

const licenseFor = (pkg) => {
  const candidates = [
    ...['LICENSE', 'LICENSE.txt', 'LICENSE.md', 'LICENCE'].map((n) => join(req(pkg), n)),
    // Checked-in upstream text, for packages whose tarball ships no license
    // file. Reproducing the copyright notice is a BSD-3-Clause condition, so a
    // missing tarball file must not silently downgrade the notice to a link.
    join(root, 'vendor', 'licenses', `${pkg}-LICENSE.txt`),
  ];
  for (const path of candidates) {
    try {
      return readFileSync(path, 'utf8').trim();
    } catch {
      // try the next candidate
    }
  }
  // Nothing available anywhere: fall back to the declared SPDX id plus the
  // homepage, so attribution still names the project and its terms. This is a
  // pointer, not a notice — vendor the real text instead when you hit it.
  const meta = JSON.parse(readFileSync(req(`${pkg}/package.json`), 'utf8'));
  return `${meta.license} — see ${meta.homepage || meta.repository?.url || `https://www.npmjs.com/package/${pkg}`}`;
};

const notice = `# Third-party licenses

GENERATED FILE - DO NOT EDIT BY HAND. Produced by scripts/vendor-map-runtime.mjs.

vendor/mapRuntime.ts inlines the source of the packages below into the WebView
map document, which redistributes them. Both are BSD-3-Clause and require this
notice to accompany the redistribution.

## maplibre-gl@${version('maplibre-gl')}

${licenseFor('maplibre-gl')}

## pmtiles@${version('pmtiles')}

The pmtiles npm tarball ships no license file. The text below is the LICENSE of
the upstream repository (protomaps/PMTiles), checked in at
vendor/licenses/pmtiles-LICENSE.txt.

${licenseFor('pmtiles')}
`;

mkdirSync(join(root, 'vendor'), { recursive: true });
writeFileSync(join(root, 'vendor', 'mapRuntime.ts'), out);
writeFileSync(join(root, 'vendor', 'LICENSES.md'), notice);
console.log(
  `vendored maplibre-gl@${version('maplibre-gl')} + pmtiles@${version('pmtiles')} -> vendor/mapRuntime.ts (${out.length} bytes)`,
);
