// Copyright (c) 2026 Asir Khan. All rights reserved.
// All Rights Reserved. See the LICENSE file.

import { describe, it, expect } from 'vitest';
import {
  extractSiteplan,
  hasSiteplan,
  siteplanImageSource,
  isHttpsUrl,
  clampOpacity,
  buildSiteplan,
  setSiteplan,
  removeSiteplan,
  SITEPLAN_DEFAULT_OPACITY,
  type SiteplanConfig,
} from './mapSiteplan';
import type { FestivalMapConfig } from '../types/domain';

const URL = 'https://cdn.example.com/site.png';
// Four corners (TL, TR, BR, BL) as GeoJSON [lng, lat].
const CORNERS: [number, number][] = [
  [-1, 1],
  [1, 1],
  [1, -1],
  [-1, -1],
];

function cfgWith(siteplan: SiteplanConfig): FestivalMapConfig {
  return { version: 1, siteplan };
}

describe('isHttpsUrl', () => {
  it('accepts https only, within length cap', () => {
    expect(isHttpsUrl('https://x.com/a.png')).toBe(true);
    expect(isHttpsUrl('http://x.com/a.png')).toBe(false);
    expect(isHttpsUrl('javascript:alert(1)')).toBe(false);
    expect(isHttpsUrl('data:image/png;base64,AAAA')).toBe(false);
    expect(isHttpsUrl('https://x.com/' + 'a'.repeat(3000))).toBe(false);
    expect(isHttpsUrl(null)).toBe(false);
    expect(isHttpsUrl(123 as unknown)).toBe(false);
  });
});

describe('clampOpacity', () => {
  it('clamps into [0,1] and defaults non-finite', () => {
    expect(clampOpacity(0.5)).toBe(0.5);
    expect(clampOpacity(-1)).toBe(0);
    expect(clampOpacity(2)).toBe(1);
    expect(clampOpacity(NaN)).toBe(SITEPLAN_DEFAULT_OPACITY);
    expect(clampOpacity('x' as unknown)).toBe(SITEPLAN_DEFAULT_OPACITY);
  });
});

describe('extractSiteplan', () => {
  it('returns null for null/absent config', () => {
    expect(extractSiteplan(null)).toBeNull();
    expect(extractSiteplan(undefined)).toBeNull();
    expect(extractSiteplan({ version: 1 })).toBeNull();
  });

  it('extracts a valid site plan with clamped opacity', () => {
    const sp = extractSiteplan(cfgWith({ imageUrl: URL, corners: CORNERS as SiteplanConfig['corners'], opacity: 0.4 }));
    expect(sp).toEqual({ imageUrl: URL, corners: CORNERS, opacity: 0.4 });
  });

  it('rejects a non-https image URL', () => {
    expect(
      extractSiteplan(
        cfgWith({ imageUrl: 'http://x/a.png', corners: CORNERS as SiteplanConfig['corners'], opacity: 0.5 }),
      ),
    ).toBeNull();
  });

  it('rejects fewer than four valid corners', () => {
    const bad = [
      [-1, 1],
      [1, 1],
      [999, 999], // out of range → dropped
      [-1, -1],
    ];
    expect(
      extractSiteplan(cfgWith({ imageUrl: URL, corners: bad as SiteplanConfig['corners'], opacity: 0.5 })),
    ).toBeNull();
  });

  it('clamps an out-of-range opacity', () => {
    const sp = extractSiteplan(cfgWith({ imageUrl: URL, corners: CORNERS as SiteplanConfig['corners'], opacity: 5 }));
    expect(sp?.opacity).toBe(1);
  });

  it('hasSiteplan mirrors extractSiteplan presence', () => {
    expect(hasSiteplan(cfgWith({ imageUrl: URL, corners: CORNERS as SiteplanConfig['corners'], opacity: 0.5 }))).toBe(
      true,
    );
    expect(hasSiteplan({ version: 1 })).toBe(false);
  });
});

describe('siteplanImageSource', () => {
  it('maps a site plan to a MapLibre image descriptor', () => {
    expect(siteplanImageSource({ imageUrl: URL, corners: CORNERS, opacity: 0.6 })).toEqual({
      url: URL,
      coordinates: CORNERS,
      opacity: 0.6,
    });
  });
  it('null in → null out', () => {
    expect(siteplanImageSource(null)).toBeNull();
  });
});

describe('buildSiteplan', () => {
  const taps = [
    { latitude: 1, longitude: -1 },
    { latitude: 1, longitude: 1 },
    { latitude: -1, longitude: 1 },
    { latitude: -1, longitude: -1 },
  ];

  it('builds a siteplan from four tapped corners (lat/lng → lng/lat)', () => {
    const sp = buildSiteplan(URL, taps, 0.5);
    expect(sp).toEqual({ imageUrl: URL, corners: CORNERS, opacity: 0.5 });
  });

  it('defaults opacity when omitted', () => {
    expect(buildSiteplan(URL, taps)?.opacity).toBe(SITEPLAN_DEFAULT_OPACITY);
  });

  it('returns null for a non-https URL', () => {
    expect(buildSiteplan('http://x/a.png', taps)).toBeNull();
  });

  it('returns null with fewer than four valid corners', () => {
    expect(buildSiteplan(URL, taps.slice(0, 3))).toBeNull();
    const withBad = [...taps.slice(0, 3), { latitude: 999, longitude: 0 }];
    expect(buildSiteplan(URL, withBad)).toBeNull();
  });

  it('uses only the first four valid corners', () => {
    const extra = [...taps, { latitude: 0, longitude: 0 }];
    expect(buildSiteplan(URL, extra)?.corners).toEqual(CORNERS);
  });
});

describe('setSiteplan / removeSiteplan', () => {
  const sp: SiteplanConfig = { imageUrl: URL, corners: CORNERS as SiteplanConfig['corners'], opacity: 0.6 };

  it('starts a config from null', () => {
    const out = setSiteplan(null, sp);
    expect(out).toEqual({ version: 1, siteplan: sp });
  });

  it('preserves amenities/zones/center when setting', () => {
    const base: FestivalMapConfig = {
      version: 1,
      center: [10, 20],
      amenities: { type: 'FeatureCollection', features: [] },
      zones: { type: 'FeatureCollection', features: [] },
    };
    const out = setSiteplan(base, sp);
    expect(out.center).toEqual([10, 20]);
    expect(out.amenities).toBe(base.amenities);
    expect(out.zones).toBe(base.zones);
    expect(out.siteplan).toEqual(sp);
    // Pure: input untouched.
    expect(base.siteplan).toBeUndefined();
  });

  it('removeSiteplan drops the key but keeps the rest', () => {
    const base = setSiteplan({ version: 1, center: [1, 2] }, sp);
    const out = removeSiteplan(base);
    expect(out.siteplan).toBeUndefined();
    expect(out.center).toEqual([1, 2]);
    // Original copy still has it (pure).
    expect(base.siteplan).toEqual(sp);
  });

  it('removeSiteplan on an absent siteplan is a no-op-safe config', () => {
    expect(removeSiteplan({ version: 1 }).siteplan).toBeUndefined();
    expect(removeSiteplan(null)).toEqual({ version: 1 });
  });
});
