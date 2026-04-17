'use strict';
/**
 * Thin re-export shim.
 *
 * The app-context factory was split into `lib/app-context/` on
 * 2026-04-14 (per docs/plans/refactor-large-files-2026-04.md). This
 * file remains so existing callers (`require('./lib/app-context')`)
 * keep working byte-identically.
 *
 * Do NOT add logic here — all code lives under `lib/app-context/`.
 */
module.exports = require('./app-context/index');
