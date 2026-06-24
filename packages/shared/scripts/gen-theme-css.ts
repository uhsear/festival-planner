/**
 * gen-theme-css — writes the generated Tailwind `@theme` block to
 * packages/web/src/styles/theme.generated.css from the @festie/shared TS tokens.
 *
 * Run: pnpm --filter @festie/shared gen:theme
 * (wired as `tsx scripts/gen-theme-css.ts`)
 *
 * The output file is committed and `@import`ed by theme.css, so a normal
 * `vite build` needs no codegen step. Re-run this only after editing the
 * tokens; the generateThemeCss.test.ts guard fails CI if the committed file
 * drifts from the tokens.
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { generateThemeCss } from '../src/tokens/generateThemeCss.js';

const here = dirname(fileURLToPath(import.meta.url));
// scripts/ -> packages/shared -> packages -> packages/web/src/styles
const outPath = resolve(here, '../../web/src/styles/theme.generated.css');

writeFileSync(outPath, generateThemeCss(), 'utf8');
// eslint-disable-next-line no-console
console.log(`[gen-theme-css] wrote ${outPath}`);
