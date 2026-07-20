// Harness smoke test: proves the vitest bring-up runs green. Real mobile-local
// tests live alongside their targets; this only verifies that the test runner
// loads and executes without error.
describe('vitest harness', () => {
  it('runs', () => {
    expect(1 + 1).toBe(2);
  });
});

// useMobilePush.ts calls Notifications.setNotificationHandler(...) at module
// scope, so importing it at all requires mocking react-native/expo-notifications
// /expo-device/async-storage/@sentry/react-native first — a pattern with zero
// precedent in this harness, which vitest.config.ts deliberately restricts to
// pure, framework-free modules. Parked here (rather than a colocated
// hooks/useMobilePush.test.ts) as a source-level regression guard instead of a
// behavioral one until that native-module test harness exists.
describe('useMobilePush — ensureAndroidChannels (source-level regression guard)', () => {
  it('creates a dedicated MAX-importance, DND-bypassing "sos" channel for crew_sos pushes', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const source = fs.readFileSync(
      path.join(__dirname, '..', 'hooks', 'useMobilePush.ts'),
      'utf8'
    );
    // lib/notifications/send.ts's CRITICAL_CHANNEL map routes type 'crew_sos'
    // to channelId 'sos' — the Android channel must exist client-side or the
    // push silently fails to display.
    const sosCall = source.match(/setNotificationChannelAsync\('sos',\s*\{([^}]*)\}/s);
    expect(sosCall).not.toBeNull();
    const body = sosCall![1];
    expect(body).toMatch(/importance:\s*Notifications\.AndroidImportance\.MAX/);
    expect(body).toMatch(/bypassDnd:\s*true/);
  });
});
