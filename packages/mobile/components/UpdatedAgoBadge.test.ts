// Source-level regression guard: packages/mobile/vitest.config.ts deliberately
// runs mobile tests in a plain node environment with no RN render harness (see
// its header comment), so this proves in source that the Android rounded-pill
// clip fix — bg painted on an absolutely-positioned sibling of the label, plus
// a sacrificial trailing space for Fabric's residual self-under-measure (see
// FreshnessChip.tsx, the reference pill fixed in PR#87) — is applied here too,
// rather than rendering the component.
describe('UpdatedAgoBadge — Android rounded-pill clip fix (source-level regression guard)', () => {
  it('paints the pill background on a sibling View behind the label, not on its parent', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const source = fs.readFileSync(path.join(__dirname, 'UpdatedAgoBadge.tsx'), 'utf8');

    // The `badge` View wraps the dot + label as children; if it also carries
    // the rounded background, Fabric clips the Text to those rounded bounds
    // on Android (the exact bug FreshnessChip.tsx's chip/chipBg split fixed).
    const badgeStyle = source.match(/\bbadge:\s*\{([^}]*)\}/s);
    expect(badgeStyle).not.toBeNull();
    expect(badgeStyle![1]).not.toMatch(/backgroundColor/);

    const bgSibling = source.match(/\bbadgeBg:\s*\{([^}]*)\}/s);
    expect(bgSibling).not.toBeNull();
    expect(bgSibling![1]).toMatch(/position:\s*'absolute'/);
    expect(bgSibling![1]).toMatch(/backgroundColor/);

    // The sibling must actually render ahead of the Text in JSX so it paints
    // behind it.
    const bgIndex = source.indexOf('styles.badgeBg');
    const textIndex = source.indexOf('<Text');
    expect(bgIndex).toBeGreaterThan(-1);
    expect(bgIndex).toBeLessThan(textIndex);

    // Sacrificial trailing space absorbs the residual single-line
    // self-under-measure (same device as FreshnessChip's `label + ' '`).
    expect(source).toMatch(/\{label \+ ' '\}/);
  });
});
