#!/usr/bin/env node
// validate-imports.js — Pre-deploy check that all ES module imports resolve.
// Catches missing `export` keywords before they cause blank screens.

const fs = require('fs');
const path = require('path');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const IMPORT_RE = /import\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"]/g;
const EXPORT_NAMED_RE = /export\s+(?:async\s+)?(?:function\s*\*?|const|let|var|class)\s+([\w$]+)/g;
const EXPORT_LIST_RE = /export\s+\{([^}]+)\}/g;
const EXPORT_DEFAULT_RE = /export\s+default\s+/g;

let errors = 0;

function getExports(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const src = fs.readFileSync(filePath, 'utf8');
  const exports = new Set();
  let m;
  while ((m = EXPORT_NAMED_RE.exec(src)) !== null) exports.add(m[1]);
  while ((m = EXPORT_LIST_RE.exec(src)) !== null) {
    m[1].split(',').forEach(e => {
      const name = e.trim().split(/\s+as\s+/).pop().trim();
      if (name) exports.add(name);
    });
  }
  if (EXPORT_DEFAULT_RE.test(src)) exports.add('default');
  EXPORT_NAMED_RE.lastIndex = 0;
  EXPORT_LIST_RE.lastIndex = 0;
  EXPORT_DEFAULT_RE.lastIndex = 0;
  return exports;
}

function checkFile(filePath) {
  const src = fs.readFileSync(filePath, 'utf8');
  const dir = path.dirname(filePath);
  let m;
  while ((m = IMPORT_RE.exec(src)) !== null) {
    const names = m[1].split(',').map(n => n.trim().split(/\s+as\s+/)[0].trim()).filter(Boolean);
    const specifier = m[2].replace(/\?.*$/, '');
    if (!specifier.startsWith('.')) continue;
    const target = path.resolve(dir, specifier);
    const exports = getExports(target);
    if (exports === null) {
      console.error(`ERROR: ${path.relative(PUBLIC_DIR, filePath)} imports from '${specifier}' but file not found: ${target}`);
      errors++;
      continue;
    }
    for (const name of names) {
      if (!exports.has(name)) {
        console.error(`ERROR: ${path.relative(PUBLIC_DIR, filePath)} imports '${name}' from '${specifier}' but it is not exported`);
        errors++;
      }
    }
  }
  IMPORT_RE.lastIndex = 0;
}

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory() && entry.name !== 'node_modules' && entry.name !== 'static') walk(full);
    else if (entry.isFile() && entry.name.endsWith('.js') && entry.name !== 'sw.js' && entry.name !== 'loader.js') checkFile(full);
  }
}

walk(PUBLIC_DIR);
if (errors > 0) {
  console.error(`\n${errors} import error(s) found. Fix before deploying.`);
  process.exit(1);
} else {
  console.log('All ES module imports validated successfully.');
}
