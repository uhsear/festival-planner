// Flat ESLint config for the Expo app. Uses the Expo preset (RN + TS rules).
const expoConfig = require('eslint-config-expo/flat');

module.exports = [
  ...expoConfig,
  {
    rules: {
      // DOM-only rule: React Native <Text> renders raw apostrophes/quotes and
      // does NOT decode HTML entities (&apos; would show literally), so this
      // is inappropriate for RN.
      'react/no-unescaped-entities': 'off',
    },
  },
  {
    ignores: [
      'dist/*',
      '.expo/*',
      'node_modules/*',
      'android/*',
      'ios/*',
      'maestro/*',
      'scripts/*',
      'expo-env.d.ts',
    ],
  },
];
