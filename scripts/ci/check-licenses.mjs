#!/usr/bin/env node
// Copyleft gate for CI. Fails on AGPL/SSPL (poison for proprietary SaaS); warns
// on GPL/LGPL/MPL/EPL/CDDL (review — usually fine for build-only or dynamically
// linked, unmodified deps like sharp's libvips or lightningcss).
//
// ponytail: lenient gate (fail only on the true poisons), not a strict allowlist.
// A new benign-but-unusual license should not wedge the push path. Upgrade to an
// allowlist if license drift ever sneaks real copyleft past the WARN tier.
//
// Input on stdin, either shape:
//   license-checker JSON:  { "pkg@ver": { "licenses": "MIT", ... }, ... }
//   pnpm licenses --json:  { "MIT": [ { name, version }, ... ], ... }

const FAIL = /AGPL|SSPL/i;
const WARN = /\bGPL\b|LGPL|\bMPL\b|\bEPL\b|CDDL/i;

function normalize(data) {
  const out = [];
  for (const [key, val] of Object.entries(data)) {
    if (Array.isArray(val)) {
      for (const p of val) out.push({ id: `${p.name}@${p.version}`, license: String(key) });
    } else if (val && typeof val === 'object' && 'licenses' in val) {
      out.push({ id: key, license: String(val.licenses) });
    }
  }
  return out;
}

function classify(items) {
  const fails = [], warns = [];
  for (const it of items) {
    if (FAIL.test(it.license)) fails.push(it);
    else if (WARN.test(it.license)) warns.push(it);
  }
  return { fails, warns };
}

if (process.argv.includes('--selftest')) {
  const lc = normalize({ 'a@1': { licenses: 'MIT' }, 'bad@2': { licenses: 'AGPL-3.0' } });
  const pn = normalize({ 'MIT': [{ name: 'x', version: '1' }], 'MPL-2.0': [{ name: 'w', version: '3' }] });
  const r1 = classify(lc), r2 = classify(pn);
  console.assert(r1.fails.length === 1 && r1.fails[0].id === 'bad@2', 'license-checker shape fail-detect');
  console.assert(r2.warns.length === 1 && r2.fails.length === 0, 'pnpm shape warn-only');
  console.assert(classify(normalize({ 'd@1': { licenses: 'SSPL-1.0' } })).fails.length === 1, 'SSPL poison');
  console.log('check-licenses selftest ok');
  process.exit(0);
}

let buf = '';
process.stdin.on('data', (c) => (buf += c)).on('end', () => {
  let data;
  try { data = JSON.parse(buf || '{}'); } catch { console.error('check-licenses: invalid JSON on stdin'); process.exit(2); }
  const { fails, warns } = classify(normalize(data));
  for (const w of warns) console.warn(`::warning::copyleft (review): ${w.license} — ${w.id}`);
  if (fails.length) {
    for (const f of fails) console.error(`::error::disallowed license ${f.license} — ${f.id}`);
    console.error(`check-licenses: ${fails.length} disallowed (AGPL/SSPL) license(s)`);
    process.exit(1);
  }
  console.log(`check-licenses: OK — ${normalize(data).length} pkgs, ${warns.length} warn(s), 0 poison`);
});
