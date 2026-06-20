// Copyright (c) 2026 Asir Khan. All rights reserved.
// All Rights Reserved. See the LICENSE file.

/**
 * SVG picks-card builder for shareable PNG export.
 * Generates a 1080x1920 story-format card with must-see and want-to-see picks.
 */

function getArtistName(set: any) {
  if (set.artists?.length > 0) return set.artists.map((a: any) => a.name).join(' b2b ');
  return set.artist || 'Unknown';
}

function esc(str: any) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Build an SVG string for the picks card.
 */
export function buildPicksCardSvg(festival: any, profile: any, opts: any = {}) {
  const picks = profile.picks || {};
  const days = festival.days || [];
  const allSets = days.flatMap((d: any) => (d.sets || []).map((s: any) => ({ ...s, dayLabel: d.label })));

  const mustSets = allSets.filter((s: any) => picks[s.id] === 'must').slice(0, 8);
  const wantSets = allSets.filter((s: any) => picks[s.id] === 'want-to-see').slice(0, 5);

  const W = 1080;
  const H = 1920;
  let y = 80;
  const lines: string[] = [];

  // Background
  lines.push('<rect width="' + W + '" height="' + H + '" fill="#0a0a1a"/>');

  // Festival name
  lines.push('<text x="60" y="' + y + '" font-family="sans-serif" font-weight="700" font-size="42" fill="#ffffff" letter-spacing="2">' + esc(festival.name).toUpperCase() + '</text>');
  y += 40;

  // Date range
  const dateRange = days.length > 0
    ? (days[0].label || '') + (days.length > 1 ? ' - ' + (days[days.length - 1].label || '') : '')
    : '';
  if (dateRange) {
    lines.push('<text x="60" y="' + y + '" font-family="sans-serif" font-size="20" fill="#8888aa">' + esc(dateRange) + '</text>');
    y += 20;
  }

  // Separator
  y += 20;
  lines.push('<line x1="60" y1="' + y + '" x2="' + (W - 60) + '" y2="' + y + '" stroke="#ffffff20" stroke-width="1"/>');
  y += 40;

  // Must See section
  if (mustSets.length > 0) {
    lines.push('<text x="60" y="' + y + '" font-family="sans-serif" font-weight="700" font-size="18" fill="#ff6b6b" letter-spacing="3">★ MUST SEE</text>');
    y += 35;
    for (const set of mustSets) {
      const name = getArtistName(set);
      lines.push('<text x="80" y="' + y + '" font-family="sans-serif" font-size="32" fill="#ffffff">' + esc(name) + '</text>');
      y += 48;
    }
    y += 10;
  }

  // Separator
  lines.push('<line x1="60" y1="' + y + '" x2="' + (W - 60) + '" y2="' + y + '" stroke="#ffffff15" stroke-width="1"/>');
  y += 30;

  // Want to See section
  if (wantSets.length > 0) {
    lines.push('<text x="60" y="' + y + '" font-family="sans-serif" font-weight="700" font-size="18" fill="#4ecdc4" letter-spacing="3">◆ WANT TO SEE</text>');
    y += 35;
    for (const set of wantSets) {
      const name = getArtistName(set);
      lines.push('<text x="80" y="' + y + '" font-family="sans-serif" font-size="28" fill="#ccccdd">' + esc(name) + '</text>');
      y += 42;
    }
  }

  // Branding footer
  const footerY = H - 60;
  lines.push('<line x1="60" y1="' + (footerY - 30) + '" x2="' + (W - 60) + '" y2="' + (footerY - 30) + '" stroke="#ffffff20" stroke-width="1"/>');
  const brandDomain = opts.brandDomain || 'festie.us';
  lines.push('<text x="60" y="' + footerY + '" font-family="sans-serif" font-size="20" fill="#8888aa">@' + esc(profile.name) + ' · ' + esc(brandDomain) + '</text>');

  return '<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '">' + lines.join('') + '</svg>';
}
