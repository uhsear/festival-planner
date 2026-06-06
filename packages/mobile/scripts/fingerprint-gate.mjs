#!/usr/bin/env node
// fingerprint-gate.mjs — build-vs-OTA decision helper for mobile-release-gate.yml.
//
// Computes the current native fingerprint of packages/mobile and compares it to
// the committed baseline at packages/mobile/.fingerprint/baseline.json (the hash
// of the last EAS *build*). It DECIDES + REPORTS only — it never triggers a build
// or an `eas update` (keep the gate free and side-effect-free for v1).
//
//   native_changed=true   -> the native layer (deps/config/plugins/native dirs)
//                            changed since the last build -> a new EAS BUILD is
//                            required before the JS can ship.
//   native_changed=false  -> no native change -> ship JS via `eas update` (free),
//                            no build needed.
//
// Outputs (consumed by the workflow):
//   - GITHUB_OUTPUT:  native_changed, current_hash, baseline_hash, baseline_seeded
//   - GITHUB_STEP_SUMMARY: a human-readable decision block
//   - stdout: the same decision lines (also useful when run locally)
//
// Baseline self-seeding: if the baseline file is missing or still holds the
// placeholder sentinel hash, this script WRITES the current hash into it and
// reports baseline_seeded=true + native_changed=false (nothing to compare against
// yet, so there's nothing to rebuild). The workflow can surface that the seeded
// baseline needs to be committed. See packages/mobile/.fingerprint/README.md.

import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, '..'); // packages/mobile
const baselineDir = join(projectRoot, '.fingerprint');
const baselinePath = join(baselineDir, 'baseline.json');

// Sentinel used by a freshly-seeded placeholder baseline (see README). Any
// baseline whose hash equals this is treated as "no real baseline yet".
const PLACEHOLDER_HASH = 'PLACEHOLDER-REFRESH-AFTER-FIRST-BUILD';

// @expo/fingerprint is a transitive dep of `expo` (not a direct dep of
// @festie/mobile), so resolve it via expo's resolution paths. require.resolve's
// `paths` option walks the dependency's node_modules ancestry, which correctly
// follows the pnpm .pnpm/ store layout where it lives as a sibling of expo.
function loadFingerprint() {
  const require = createRequire(import.meta.url);
  // Anchor on the resolved expo/package.json so we search from inside expo's
  // own dependency tree (works under both npm-hoisted and pnpm layouts).
  const expoPkg = require.resolve('expo/package.json', { paths: [projectRoot] });
  const fpEntry = require.resolve('@expo/fingerprint', { paths: [expoPkg, projectRoot] });
  return require(fpEntry);
}

function readBaseline() {
  if (!existsSync(baselinePath)) return null;
  try {
    return JSON.parse(readFileSync(baselinePath, 'utf8'));
  } catch (e) {
    console.error(`Could not parse baseline at ${baselinePath}: ${e.message}`);
    return null;
  }
}

function writeBaseline(hash) {
  mkdirSync(baselineDir, { recursive: true });
  const payload = {
    hash,
    generatedAt: new Date().toISOString(),
    note:
      'Last-BUILT native fingerprint. Refresh this (and commit) after every EAS ' +
      'build. See README.md in this folder.',
  };
  writeFileSync(baselinePath, JSON.stringify(payload, null, 2) + '\n', 'utf8');
}

function emitOutput(key, value) {
  const out = process.env.GITHUB_OUTPUT;
  if (out) writeFileSync(out, `${key}=${value}\n`, { flag: 'a' });
}

function emitSummary(markdown) {
  const summary = process.env.GITHUB_STEP_SUMMARY;
  if (summary) writeFileSync(summary, markdown + '\n', { flag: 'a' });
}

async function main() {
  const Fingerprint = loadFingerprint();
  const fp = await Fingerprint.createFingerprintAsync(projectRoot);
  const currentHash = fp.hash;

  const baseline = readBaseline();
  const baselineHash = baseline?.hash ?? null;
  const hasRealBaseline = baselineHash != null && baselineHash !== PLACEHOLDER_HASH;

  emitOutput('current_hash', currentHash);
  emitOutput('baseline_hash', baselineHash ?? '(none)');

  // No usable baseline yet -> self-seed and treat as "no rebuild needed".
  if (!hasRealBaseline) {
    writeBaseline(currentHash);
    emitOutput('native_changed', 'false');
    emitOutput('baseline_seeded', 'true');
    const msg =
      'DECISION: no usable baseline found -> seeded baseline with the current ' +
      'fingerprint. No build needed. Commit packages/mobile/.fingerprint/baseline.json.';
    console.log(msg);
    emitSummary(
      [
        '## Mobile release gate',
        '',
        `- **current fingerprint:** \`${currentHash}\``,
        '- **baseline:** none (placeholder/missing) -> **seeded** with current hash',
        '- **decision:** :seedling: baseline seeded; no build needed.',
        '',
        '> Commit the updated `packages/mobile/.fingerprint/baseline.json`.',
      ].join('\n')
    );
    return;
  }

  const nativeChanged = currentHash !== baselineHash;
  emitOutput('native_changed', String(nativeChanged));
  emitOutput('baseline_seeded', 'false');

  if (nativeChanged) {
    const msg = 'DECISION: native changed -> a new EAS BUILD is required';
    console.log(msg);
    emitSummary(
      [
        '## Mobile release gate',
        '',
        `- **current fingerprint:** \`${currentHash}\``,
        `- **baseline fingerprint:** \`${baselineHash}\``,
        '- **decision:** :hammer_and_wrench: **native changed -> a new EAS BUILD is required**',
        '',
        '> After the build succeeds, refresh `packages/mobile/.fingerprint/baseline.json`',
        '> with the new hash and commit it (see the folder README).',
      ].join('\n')
    );
  } else {
    const msg = 'DECISION: no native change -> ship via `eas update` (free), NO build needed';
    console.log(msg);
    emitSummary(
      [
        '## Mobile release gate',
        '',
        `- **current fingerprint:** \`${currentHash}\``,
        `- **baseline fingerprint:** \`${baselineHash}\``,
        '- **decision:** :rocket: **no native change -> ship via `eas update` (free), NO build needed**',
      ].join('\n')
    );
  }
}

main().catch((e) => {
  console.error('fingerprint-gate failed:', e?.stack || e?.message || e);
  process.exit(1);
});
