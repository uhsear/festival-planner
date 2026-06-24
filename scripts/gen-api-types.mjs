// Copyright (c) 2026 Asir Khan. All rights reserved.
// All Rights Reserved. See the LICENSE file.

/**
 * Generate shared request/response TYPES from the OpenAPI spec.
 *
 * Pipeline:
 *   1. Call generateOpenAPISpec() — the same hand-maintained doc whose REQUEST
 *      contracts are now derived from the authoritative Zod schemas (Phase A).
 *   2. Serialize it to lib/openapi.generated.json (a build artifact / snapshot).
 *   3. Run openapi-typescript on that JSON to emit a PURE TYPE module at
 *      packages/shared/src/types/api.gen.ts.
 *
 * Why a pure type module: the output is consumed by BOTH the web SPA and the
 * React Native (mobile) app via @festie/shared. openapi-typescript emits only
 * `interface`/`type` declarations with ZERO runtime imports, so it adds no
 * server runtime dependency to mobile (the CI mobile-typecheck TS2307 trap).
 * Consumers MUST `import type` from it (isolatedModules is on repo-wide).
 *
 * Run: `npm run gen:api-types`. CI re-runs this and `git diff --exit-code`s the
 * two generated files so the spec, the Zod schemas, and the shared types can
 * never silently drift apart (the CI wiring itself is Phase C).
 */

import { writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';

import { register } from 'tsx/esm/api';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');

// The spec generator is TypeScript (lib/openapi.ts) and pulls in the Zod
// schemas, so load it through tsx's ESM loader exactly like the server does.
const unregister = register();
let generateOpenAPISpec;
let astToString;
let openapiTS;
try {
  ({ generateOpenAPISpec } = await import(pathToFileURL(resolve(repoRoot, 'lib/openapi.ts')).href));
  const ots = await import('openapi-typescript');
  openapiTS = ots.default;
  astToString = ots.astToString;
} finally {
  unregister();
}

// Use empty config so the snapshot is deterministic (no env-dependent server
// URL / version baked into the committed artifact).
const spec = generateOpenAPISpec({});

const jsonPath = resolve(repoRoot, 'lib/openapi.generated.json');
writeFileSync(jsonPath, `${JSON.stringify(spec, null, 2)}\n`, 'utf8');

const ast = await openapiTS(spec, {
  // No runtime helpers — keep the module pure types so mobile can import it.
  exportType: true,
  // Make the produced types easy to consume from hand-written aliases.
  alphabetize: true,
});

const header = [
  '// Copyright (c) 2026 Asir Khan. All rights reserved.',
  '// All Rights Reserved. See the LICENSE file.',
  '//',
  '// GENERATED FILE — do not edit by hand.',
  '// Source: lib/openapi.ts (request contracts derived from lib/schemas.ts Zod).',
  '// Regenerate: `npm run gen:api-types`. CI git-diffs this file to catch drift.',
  '//',
  '// Pure type module (zero runtime imports) so @festie/shared can re-export these',
  '// to BOTH web and React Native without dragging in any server runtime dep.',
  '',
  '',
].join('\n');

const tsPath = resolve(repoRoot, 'packages/shared/src/types/api.gen.ts');
writeFileSync(tsPath, header + astToString(ast), 'utf8');

console.log(`Wrote ${jsonPath}`);
console.log(`Wrote ${tsPath}`);
