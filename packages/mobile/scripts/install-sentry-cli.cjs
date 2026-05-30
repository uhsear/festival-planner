/**
 * Downloads the @sentry/cli native binary that the @sentry/react-native Gradle
 * integration shells out to for release source-map upload.
 *
 * pnpm v10 blocks dependency build scripts by default, so @sentry/cli's
 * postinstall (which fetches the platform binary) doesn't run during install.
 * pnpm-workspace.yaml `onlyBuiltDependencies` allowlists it, but this hook runs
 * the installer explicitly as a belt-and-suspenders fallback for CI/EAS. It
 * never fails the build — if the binary is already present (the allowlist did
 * its job) or the layout shifts, we log and move on.
 */
const path = require('path');
const fs = require('fs');
const cp = require('child_process');

try {
  const dir = path.dirname(require.resolve('@sentry/cli/package.json'));
  const installer = path.join(dir, 'scripts', 'install.js');
  if (!fs.existsSync(installer)) {
    console.log('[sentry-cli] no installer at', installer, '— skipping');
    process.exit(0);
  }
  cp.execFileSync(process.execPath, [installer], {
    stdio: 'inherit',
    cwd: dir,
  });
  console.log('[sentry-cli] binary install complete:', dir);
} catch (e) {
  console.error('[sentry-cli] manual install fallback failed:', e && e.message);
}
process.exit(0);
