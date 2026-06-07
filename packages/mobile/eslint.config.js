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
      // React Compiler readiness rules (new in eslint-plugin-react-hooks 7.x,
      // flipped to "error" by SDK 56's eslint-config-expo). Festie does NOT
      // enable the React Compiler, and this existing code shipped fine on SDK
      // 54, so these are advisory here: keep them as warnings (still surfaced
      // for incremental cleanup) rather than hard-failing the upgraded build.
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/refs': 'warn',
      'react-hooks/purity': 'warn',
      'react-hooks/immutability': 'warn',
      'react-hooks/preserve-manual-memoization': 'warn',
    },
  },
  {
    ignores: ['dist/*', '.expo/*', 'node_modules/*', 'android/*', 'ios/*', 'maestro/*', 'scripts/*', 'expo-env.d.ts'],
  },
];
