// Learn more https://docs.expo.dev/guides/monorepos/
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

// Find the project and workspace directories
const projectRoot = __dirname;
// This can be replaced with `find-yarn-workspace-root`
const monorepoRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

// 1. Watch all files within the monorepo (extend Expo's defaults, don't replace them)
config.watchFolders = [...(config.watchFolders ?? []), monorepoRoot];

// 2. Let Metro know where to resolve packages and in what order
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(monorepoRoot, 'packages', 'node_modules'),
  path.resolve(monorepoRoot, 'node_modules'),
];

// 3. NodeNext ESM .js-extension fallback.
// @festie/shared is authored in TypeScript but uses NodeNext-style explicit
// `.js` extensions in its relative imports (e.g. `from './colors.js'` where the
// real file is `colors.ts`). Vite (web) and tsx (backend) resolve this natively;
// Metro does not. Try the literal request first (real `.js` files still win),
// then fall back to the extensionless form so Metro's sourceExts resolve the
// matching `.ts`/`.tsx`.
const defaultResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  const resolve = defaultResolveRequest ?? context.resolveRequest;
  if (
    (moduleName.startsWith('./') || moduleName.startsWith('../')) &&
    moduleName.endsWith('.js')
  ) {
    try {
      return resolve(context, moduleName, platform);
    } catch {
      return resolve(context, moduleName.slice(0, -3), platform);
    }
  }
  return resolve(context, moduleName, platform);
};

module.exports = config;
