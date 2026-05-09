import type { KnipConfig } from 'knip';

const config: KnipConfig = {
  workspaces: {
    '.': {
      entry: ['lib/**/*.js', 'routes/**/*.js'],
      project: ['lib/**/*.js', 'routes/**/*.js'],
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
