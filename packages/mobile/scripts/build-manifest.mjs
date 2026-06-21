#!/usr/bin/env node
/**
 * build-manifest.mjs — Write dist/manifest.webmanifest and patch dist/index.html.
 *
 * Usage (called by build:web):
 *   node scripts/build-manifest.mjs
 *
 * Override the export dir:
 *   EXPO_WEB_DIST=/path/to/dist node scripts/build-manifest.mjs
 *
 * What this does:
 *  1. Writes dist/manifest.webmanifest with the Festie brand config.
 *  2. Ensures dist/icons/icon-192.png, icon-512.png, icon-512-maskable.png
 *     exist by resizing packages/mobile/assets/icon.png via `sharp` (if
 *     available at the repo root) or copying the source PNG as a fallback.
 *  3. Injects <link rel="manifest"> and <meta name="theme-color"> into
 *     dist/index.html if those tags are not already present (idempotent).
 */

import { existsSync, mkdirSync, copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

// ── Paths ────────────────────────────────────────────────────────────────────
const mobileRoot = resolve(__dirname, '..');
const repoRoot   = resolve(mobileRoot, '..', '..');

const distDir = resolve(
  process.env.EXPO_WEB_DIST || resolve(mobileRoot, 'dist'),
);
const iconsDir     = resolve(distDir, 'icons');
const manifestPath = resolve(distDir, 'manifest.webmanifest');
const indexPath    = resolve(distDir, 'index.html');
const sourceIcon   = resolve(mobileRoot, 'assets', 'icon.png');

// ── Ensure dist exists ───────────────────────────────────────────────────────
if (!existsSync(distDir)) {
  console.error(
    `[build-manifest] ERROR: export dir not found: ${distDir}\n` +
    `Run 'expo export -p web' first (or set EXPO_WEB_DIST to the correct path).`,
  );
  process.exit(1);
}

// ── 1. Icons ─────────────────────────────────────────────────────────────────
mkdirSync(iconsDir, { recursive: true });

const iconTargets = [
  { file: 'icon-192.png',           size: 192,  purpose: 'any' },
  { file: 'icon-512.png',           size: 512,  purpose: 'any' },
  { file: 'icon-512-maskable.png',  size: 512,  purpose: 'maskable' },
];

// Try to load sharp from the repo root node_modules.
let sharp = null;
try {
  const require = createRequire(resolve(repoRoot, 'package.json'));
  sharp = require('sharp');
} catch {
  // sharp not available — fall through to copyFile fallback.
}

for (const { file, size } of iconTargets) {
  const dest = resolve(iconsDir, file);
  if (existsSync(dest)) {
    // idempotent — already produced by a previous run
    continue;
  }
  if (sharp) {
    await sharp(sourceIcon).resize(size, size).toFile(dest);
    console.log(`[build-manifest] Generated ${size}×${size} icon → dist/icons/${file}`);
  } else {
    copyFileSync(sourceIcon, dest);
    console.log(
      `[build-manifest] NOTE: sharp not found at repo root — copied source PNG as dist/icons/${file}.` +
      ` Install sharp in the repo root for correctly-sized icons.`,
    );
  }
}

// ── 2. manifest.webmanifest ──────────────────────────────────────────────────
const manifest = {
  name:             'Festie — Festival Planner',
  short_name:       'Festie',
  description:      'Real-time festival crew coordination.',
  start_url:        '/',
  display:          'standalone',
  orientation:      'portrait',
  theme_color:      '#080810',
  background_color: '#080810',
  icons: [
    {
      src:     'icons/icon-192.png',
      sizes:   '192x192',
      type:    'image/png',
      purpose: 'any',
    },
    {
      src:     'icons/icon-512.png',
      sizes:   '512x512',
      type:    'image/png',
      purpose: 'any',
    },
    {
      src:     'icons/icon-512-maskable.png',
      sizes:   '512x512',
      type:    'image/png',
      purpose: 'maskable',
    },
  ],
};

writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
console.log('[build-manifest] Wrote dist/manifest.webmanifest');

// ── 3. Patch dist/index.html (idempotent) ────────────────────────────────────
if (!existsSync(indexPath)) {
  console.warn(`[build-manifest] WARNING: dist/index.html not found — skipping HTML patch.`);
  process.exit(0);
}

let html = readFileSync(indexPath, 'utf8');
let patched = false;

// Inject <link rel="manifest"> before </head> if absent.
if (!html.includes('rel="manifest"') && !html.includes("rel='manifest'")) {
  html = html.replace(
    '</head>',
    '  <link rel="manifest" href="/manifest.webmanifest">\n</head>',
  );
  patched = true;
}

// Inject <meta name="theme-color"> before </head> if absent.
if (!html.includes('name="theme-color"') && !html.includes("name='theme-color'")) {
  html = html.replace(
    '</head>',
    '  <meta name="theme-color" content="#080810">\n</head>',
  );
  patched = true;
}

if (patched) {
  writeFileSync(indexPath, html, 'utf8');
  console.log('[build-manifest] Patched dist/index.html (manifest link + theme-color meta)');
} else {
  console.log('[build-manifest] dist/index.html already has manifest + theme-color — no change');
}
