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
const maplibreJs = readFileSync(req('maplibre-gl/dist/maplibre-gl.js'), 'utf8');
const maplibreCss = readFileSync(req('maplibre-gl/dist/maplibre-gl.css'), 'utf8');
const pmtilesJs = readFileSync(req('pmtiles/dist/pmtiles.js'), 'utf8');

// A `</script` anywhere in a vendored blob would close the inline <script> that
// hosts it and break the document (and open an injection seam). Neither library
// contains one today; fail loudly rather than emit a broken document if that
// ever changes.
for (const [name, src] of [
  ['maplibre-gl.js', maplibreJs],
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

/** maplibre-gl/dist/maplibre-gl.js, verbatim. */
export const MAPLIBRE_JS_SRC = ${asciiLiteral(maplibreJs)};

/** maplibre-gl/dist/maplibre-gl.css, verbatim. */
export const MAPLIBRE_CSS_SRC = ${asciiLiteral(maplibreCss)};

/** pmtiles/dist/pmtiles.js (IIFE exposing the \`pmtiles\` global), verbatim. */
export const PMTILES_JS_SRC = ${asciiLiteral(pmtilesJs)};
`;

const licenseFor = (pkg) => {
  const dir = req(pkg);
  for (const name of ['LICENSE', 'LICENSE.txt', 'LICENSE.md', 'LICENCE']) {
    try {
      return readFileSync(join(dir, name), 'utf8').trim();
    } catch {
      // try the next conventional filename
    }
  }
  // No license file shipped in the tarball: fall back to the declared SPDX id
  // plus the homepage, so attribution still names the project and its terms.
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

${licenseFor('pmtiles')}
`;

mkdirSync(join(root, 'vendor'), { recursive: true });
writeFileSync(join(root, 'vendor', 'mapRuntime.ts'), out);
writeFileSync(join(root, 'vendor', 'LICENSES.md'), notice);
console.log(
  `vendored maplibre-gl@${version('maplibre-gl')} + pmtiles@${version('pmtiles')} -> vendor/mapRuntime.ts (${out.length} bytes)`,
);
