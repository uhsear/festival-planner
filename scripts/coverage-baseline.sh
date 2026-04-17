#!/usr/bin/env bash
# coverage-baseline.sh
# Produces a c8 coverage baseline snapshot for festival-planner.
# Idempotent: re-running overwrites the day's baseline file.

set -euo pipefail

REPO="/home/asir/festival-planner"
cd "$REPO"

DATE="$(date +%Y-%m-%d)"
OUT_DIR="docs/audits"
OUT_FILE="${OUT_DIR}/coverage-baseline-${DATE}.md"
SUMMARY_JSON="coverage/coverage-summary.json"

mkdir -p "$OUT_DIR"

# Run tests under c8. Capture text output for the narrative section.
TEXT_OUT="$(mktemp)"
trap 'rm -f "$TEXT_OUT"' EXIT

npx c8 --reporter=text --reporter=json-summary npm test 2>&1 | tee "$TEXT_OUT"

if [ ! -f "$SUMMARY_JSON" ]; then
  echo "ERROR: $SUMMARY_JSON not found; c8 did not emit json-summary." >&2
  exit 1
fi

# Extract totals + per-file breakdown via node (already on the box).
node - "$SUMMARY_JSON" "$OUT_FILE" "$DATE" <<'NODE'
const fs = require('fs');
const [, , summaryPath, outPath, date] = process.argv;
const s = JSON.parse(fs.readFileSync(summaryPath, 'utf8'));
const t = s.total;
const files = Object.keys(s).filter(k => k !== 'total').sort();

let md = `# Coverage Baseline ${date}\n\n`;
md += `## Totals\n\n`;
md += `| Metric | Pct | Covered | Total |\n|---|---|---|---|\n`;
for (const k of ['lines', 'statements', 'functions', 'branches']) {
  md += `| ${k} | ${t[k].pct}% | ${t[k].covered} | ${t[k].total} |\n`;
}
md += `\n## Per-file\n\n| File | Lines % | Branches % | Funcs % |\n|---|---|---|---|\n`;
for (const f of files) {
  const r = s[f];
  md += `| ${f} | ${r.lines.pct}% | ${r.branches.pct}% | ${r.functions.pct}% |\n`;
}
fs.writeFileSync(outPath, md);

const line = `Coverage: ${t.lines.pct}% lines, ${t.branches.pct}% branches across ${files.length} files`;
console.log(line);
NODE

echo "Baseline written to ${OUT_FILE}"
