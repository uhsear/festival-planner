import type { StorybookConfig } from 'storybook';
import type { PluginOption } from 'vite';
import { dirname } from 'path';
import { fileURLToPath } from 'url';

/**
 * Resolve the absolute path of a package.
 * Required for monorepo / pnpm workspace setups.
 */
function getAbsolutePath(value: string) {
  return dirname(fileURLToPath(import.meta.resolve(`${value}/package.json`)));
}

/** Plugin names to strip -- app-specific plugins that break the Storybook build. */
const EXCLUDED_PLUGINS = new Set([
  'vite-plugin-pwa',
  'vite-plugin-pwa:build',
  'vite-plugin-pwa:info',
  'vite-plugin-pwa:main',
  'vite-plugin-pwa:dev-sw',
  'visualizer',
]);

function stripPlugins(plugins: PluginOption[]): PluginOption[] {
  return plugins
    .flat(Infinity)
    .filter((p): p is Exclude<PluginOption, false | null | undefined> => {
      if (!p || typeof p !== 'object') return false;
      const name = 'name' in p ? String((p as { name: string }).name) : '';
      return !EXCLUDED_PLUGINS.has(name);
    });
}

const config: StorybookConfig = {
  stories: ['../src/**/*.mdx', '../src/**/*.stories.@(ts|tsx)'],
  addons: [
    getAbsolutePath('@chromatic-com/storybook'),
    getAbsolutePath('@storybook/addon-docs'),
    getAbsolutePath('@storybook/addon-a11y'),
  ],
  framework: getAbsolutePath('@storybook/react-vite'),
  viteFinal(config) {
    // Remove app-specific plugins that interfere with Storybook builds
    // (PWA service worker generation, bundle visualizer, etc.)
    config.plugins = stripPlugins(config.plugins ?? []);
    return config;
  },
};

export default config;
