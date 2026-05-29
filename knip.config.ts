import type { KnipConfig } from 'knip';

const config: KnipConfig = {
  workspaces: {
    '.': {
      entry: ['lib/**/*.ts', 'routes/**/*.ts'],
      project: ['lib/**/*.ts', 'routes/**/*.ts'],
      ignore: ['tests/**'],
    },
    'packages/web': {
      project: ['src/**/*.{ts,tsx}'],
    },
    'packages/shared': {
      entry: ['src/**/*.ts'],
      project: ['src/**/*.ts'],
    },
  },
};

export default config;
