#!/bin/bash
# Copyright (c) 2026 Asir Khan. All rights reserved.
# Licensed under the Business Source License 1.1. See LICENSE file for details.

# Festie Frontend Bundle Size Analyzer
# Measures file sizes and gzip compression for key frontend assets
# Usage: bash scripts/measure-bundle.sh

set -e

echo "📦 Festie Frontend Bundle Analysis"
echo "═══════════════════════════════════════════════════════════════"

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

cd "$(dirname "$0")/.."
public_dir="${PUBLIC_DIR:-public}"

if [ ! -d "$public_dir" ]; then
  echo "❌ Public directory not found: $public_dir"
  exit 1
fi

echo ""
echo "Key Frontend Assets:"
echo "───────────────────────────────────────────────────────────────"

total_raw=0
total_gzip=0

for file in "$public_dir/app.js" "$public_dir/app.css" "$public_dir/index.html"; do
  if [ -f "$file" ]; then
    filename=$(basename "$file")
    raw_size=$(wc -c < "$file")
    gzip_size=$(gzip -c "$file" | wc -c)
    ratio=$((gzip_size * 100 / raw_size))

    total_raw=$((total_raw + raw_size))
    total_gzip=$((total_gzip + gzip_size))

    printf "%-25s %10d bytes → %10d bytes (gzip, %3d%%)\n" \
      "$filename" "$raw_size" "$gzip_size" "$ratio"
  fi
done

echo ""
echo "Summary:"
echo "───────────────────────────────────────────────────────────────"

total_ratio=$((total_gzip * 100 / total_raw))
echo "Total raw:        $(printf '%10d' $total_raw) bytes"
echo "Total gzipped:    $(printf '%10d' $total_gzip) bytes"
echo "Compression:      $(printf '%3d' $total_ratio)%"

echo ""
echo "Recommendations:"
echo "───────────────────────────────────────────────────────────────"
if [ $total_gzip -gt 200000 ]; then
  echo -e "${YELLOW}⚠️  Gzipped total > 200KB. Consider code splitting:${NC}"
  echo "   • Extract admin view (lazy load)"
  echo "   • Extract export functionality (lazy load)"
  echo "   • Split crew conflict modal (lazy load)"
fi

echo ""
if [ $total_gzip -lt 150000 ]; then
  echo -e "${GREEN}✅ Bundle size is healthy (< 150KB gzipped)${NC}"
fi

echo ""
echo "Next Steps:"
echo "───────────────────────────────────────────────────────────────"
echo "1. Monitor with each release: bash scripts/measure-bundle.sh"
echo "2. Use relative imports: import(...) for code splitting"
echo "3. Defer non-critical CSS: media='print' or lazy-load"
echo "4. Consider CSS tree-shaking for unused utility classes"
echo ""
