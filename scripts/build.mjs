// Copyright (c) 2026 Asir Khan. All rights reserved.
// All Rights Reserved. See the LICENSE file.

/**
 * Production bundle build.
 *
 * Bundles the server entrypoint AND the two worker-thread entrypoints so the
 * dist/ artifact is fully runnable. The workers are spawned at runtime via
 * `new Worker(new URL('./avatar-worker.<ext>', import.meta.url))` etc.; in the
 * bundled output `import.meta.url` ends in `.js`, so the workers must exist as
 * dist/avatar-worker.js and dist/export-worker.js next to dist/server.js.
 *
 * All three entrypoints use identical esbuild flags:
 *   --bundle --platform=node --format=esm --target=node22 --packages=external --sourcemap
 */
import { build } from 'esbuild';

const entryPoints = ['server.ts', 'lib/avatar-worker.ts', 'lib/export-worker.ts'];

await build({
  entryPoints,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  packages: 'external',
  sourcemap: true,
  outdir: 'dist',
  // Flatten lib/*-worker.ts -> dist/*-worker.js (sibling of dist/server.js)
  // instead of dist/lib/*-worker.js, so the runtime extension-swap resolves them.
  entryNames: '[name]',
});

console.log('build ok: dist/server.js, dist/avatar-worker.js, dist/export-worker.js');
