import { safeJsonForScript, isAllowedMapHost, isAuthoringMode, buildSetAuthoringScript } from './webviewBridge';

// The literal JS line terminators (built from char codes so this file stays
// plain-ASCII, matching the source). They are only ever used via these
// variables -- never pasted raw into source, or they would terminate a line.
const LS = String.fromCharCode(0x2028); // U+2028 LINE SEPARATOR
const PS = String.fromCharCode(0x2029); // U+2029 PARAGRAPH SEPARATOR

describe('safeJsonForScript', () => {
  it('produces output that round-trips back to the original value', () => {
    const value = { items: [{ label: 'Main Stage', n: 3, live: true }], center: null };
    expect(JSON.parse(safeJsonForScript(value))).toEqual(value);
  });

  it('escapes every "<" so a script-closing payload cannot break out of an inline script', () => {
    const evil = { label: '</scr' + 'ipt><img src=x onerror=alert(1)>' };
    const out = safeJsonForScript(evil);
    // No raw "<" may survive -- that is the whole point of the H3 transport fix.
    expect(out).not.toContain('<');
    // The "<" is rewritten to its < escape.
    expect(out).toContain('\\u003c');
    // And it still parses back to the exact original string.
    expect(JSON.parse(out)).toEqual(evil);
  });

  it('escapes a bare "<" even outside a script-tag payload', () => {
    const out = safeJsonForScript('a < b');
    expect(out).not.toContain('<');
    expect(out).toContain('\\u003c');
    expect(JSON.parse(out)).toBe('a < b');
  });

  it('escapes U+2028 (LINE SEPARATOR) so it cannot terminate the JS string literal', () => {
    const input = 'before' + LS + 'after';
    const out = safeJsonForScript(input);
    expect(out).not.toContain(LS);
    expect(out).toContain('\\u2028');
    expect(JSON.parse(out)).toBe(input);
  });

  it('escapes U+2029 (PARAGRAPH SEPARATOR) the same way', () => {
    const input = 'x' + PS + 'y';
    const out = safeJsonForScript(input);
    expect(out).not.toContain(PS);
    expect(out).toContain('\\u2029');
    expect(JSON.parse(out)).toBe(input);
  });

  it('escapes a combined <, U+2028 and U+2029 payload in one value', () => {
    const evil = '</scr' + 'ipt>' + LS + PS + '<b>';
    const out = safeJsonForScript(evil);
    expect(out).not.toContain('<');
    expect(out).not.toContain(LS);
    expect(out).not.toContain(PS);
    expect(JSON.parse(out)).toBe(evil);
  });

  it('leaves double quotes JSON-escaped and re-parseable (does not corrupt a quote payload)', () => {
    const out = safeJsonForScript('he said "hi"');
    // JSON.stringify already escapes the inner quotes as \"; safeJsonForScript
    // must not break that -- the string still parses back intact.
    expect(out).toContain('\\"');
    expect(JSON.parse(out)).toBe('he said "hi"');
  });

  it('handles the empty string and empty collections', () => {
    expect(JSON.parse(safeJsonForScript(''))).toBe('');
    expect(JSON.parse(safeJsonForScript([]))).toEqual([]);
    expect(JSON.parse(safeJsonForScript({}))).toEqual({});
    // Empty pin batch -- the common "no pins yet" injection.
    expect(JSON.parse(safeJsonForScript({ items: [] }))).toEqual({ items: [] });
  });

  it('serializes null / numeric center coords without escaping anything', () => {
    expect(safeJsonForScript(null)).toBe('null');
    expect(safeJsonForScript({ latitude: 0, longitude: 0 })).toBe('{"latitude":0,"longitude":0}');
  });

  it('produces a string that is safe to splice into an inline script tag as data', () => {
    // Simulate the real injection: `__festieSetPins(${json})`. The result must
    // not introduce a literal script-closing tag that an HTML parser would
    // close on.
    const json = safeJsonForScript([{ label: '</scr' + 'ipt>' }]);
    const inlineScript = '<scr' + 'ipt>window.__festieSetPins(' + json + ');</scr' + 'ipt>';
    // The ONLY script-closing substring is the closing tag we wrote ourselves.
    expect(inlineScript.match(/<\/script/g)).toHaveLength(1);
  });
});

describe('isAllowedMapHost', () => {
  it('allows unpkg.com (MapLibre JS/CSS CDN)', () => {
    expect(isAllowedMapHost('unpkg.com')).toBe(true);
  });

  it('allows the bare OSM tile host', () => {
    expect(isAllowedMapHost('tile.openstreetmap.org')).toBe(true);
  });

  it('allows OSM tile subdomains (a/b/c.tile.openstreetmap.org)', () => {
    expect(isAllowedMapHost('a.tile.openstreetmap.org')).toBe(true);
    expect(isAllowedMapHost('b.tile.openstreetmap.org')).toBe(true);
    expect(isAllowedMapHost('c.tile.openstreetmap.org')).toBe(true);
  });

  it('rejects a suffix-lookalike that appends an attacker domain', () => {
    // The classic bypass: legitimate domain as a left-label of an evil host.
    expect(isAllowedMapHost('evil.openstreetmap.org.attacker.com')).toBe(false);
    expect(isAllowedMapHost('tile.openstreetmap.org.evil.com')).toBe(false);
    expect(isAllowedMapHost('unpkg.com.evil.com')).toBe(false);
  });

  it('rejects a prefix-lookalike that prepends the legit host to a junk label', () => {
    // "...org" must be the END of the host -- a different TLD/label fails.
    expect(isAllowedMapHost('tile.openstreetmap.orgx')).toBe(false);
    expect(isAllowedMapHost('tileXopenstreetmapXorg')).toBe(false);
  });

  it('rejects a host that merely embeds the allowed host mid-string', () => {
    expect(isAllowedMapHost('nottile.openstreetmap.org.io')).toBe(false);
    expect(isAllowedMapHost('myunpkg.com')).toBe(false);
  });

  it('rejects bare openstreetmap.org (only the tile. zone is whitelisted)', () => {
    expect(isAllowedMapHost('openstreetmap.org')).toBe(false);
    expect(isAllowedMapHost('www.openstreetmap.org')).toBe(false);
  });

  it('rejects the empty host and obvious attacker hosts', () => {
    expect(isAllowedMapHost('')).toBe(false);
    expect(isAllowedMapHost('attacker.com')).toBe(false);
    expect(isAllowedMapHost('localhost')).toBe(false);
  });

  it('is case-sensitive: an upper/mixed-case host is NOT auto-allowed', () => {
    // hostname from `new URL()` is already lowercased on the RN side, so the
    // allowlist intentionally does not also lowercase -- assert that contract so
    // a future caller that forgets to normalize fails closed, not open.
    expect(isAllowedMapHost('UNPKG.COM')).toBe(false);
    expect(isAllowedMapHost('Tile.OpenStreetMap.org')).toBe(false);
  });
});

describe('isAuthoringMode', () => {
  it('accepts the three recognized modes', () => {
    expect(isAuthoringMode('off')).toBe(true);
    expect(isAuthoringMode('stage')).toBe(true);
    expect(isAuthoringMode('amenity')).toBe(true);
  });
  it('rejects anything else', () => {
    expect(isAuthoringMode('on')).toBe(false);
    expect(isAuthoringMode('')).toBe(false);
    expect(isAuthoringMode(null)).toBe(false);
    expect(isAuthoringMode(undefined)).toBe(false);
    expect(isAuthoringMode(1)).toBe(false);
  });
});

describe('buildSetAuthoringScript', () => {
  it('emits a guarded call that ends in true; for a known mode', () => {
    expect(buildSetAuthoringScript('stage')).toBe(
      'window.__festieSetAuthoring && window.__festieSetAuthoring("stage"); true;',
    );
    expect(buildSetAuthoringScript('amenity')).toBe(
      'window.__festieSetAuthoring && window.__festieSetAuthoring("amenity"); true;',
    );
    expect(buildSetAuthoringScript('off')).toBe(
      'window.__festieSetAuthoring && window.__festieSetAuthoring("off"); true;',
    );
  });
  it('coerces an unknown mode to "off" (never interpolates raw input)', () => {
    // Defends against a caller passing arbitrary text — the mode is whitelisted,
    // so nothing but a recognized literal can ever reach the injected script.
    expect(buildSetAuthoringScript('"); alert(1); ("' as unknown as 'off')).toBe(
      'window.__festieSetAuthoring && window.__festieSetAuthoring("off"); true;',
    );
  });
  it('the mode is always JSON-quoted, so no payload escapes the string literal', () => {
    const out = buildSetAuthoringScript('amenity');
    expect(out).toContain('"amenity"');
    // Only the guarded single statement; no stray semicolons from injected text.
    expect(out.match(/__festieSetAuthoring/g)).toHaveLength(2);
  });
});
