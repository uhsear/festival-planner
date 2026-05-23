// For more info, see https://github.com/storybookjs/eslint-plugin-storybook#configuration-flat-config-format
import storybook from "eslint-plugin-storybook";

import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';

export default tseslint.config(// Base recommended rules
js.configs.recommended, // TypeScript recommended rules (includes parser setup)
...tseslint.configs.recommended, // Ignore patterns
{
  ignores: ['dist/**', 'node_modules/**', 'vite.config.ts'],
}, // Frontend TypeScript/TSX files
{
  files: ['src/**/*.{ts,tsx}'],
  plugins: {
    'react-hooks': reactHooks,
  },
  languageOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
    globals: {
      ...globals.browser,
    },
  },
  rules: {
    // React Hooks rules
    'react-hooks/rules-of-hooks': 'error',
    'react-hooks/exhaustive-deps': 'warn',
    // Match the project's existing rule style from the root config
    'no-unused-vars': 'off',
    '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }],
    'no-console': ['warn', { allow: ['debug', 'error', 'warn'] }],
    'no-var': 'error',
    'prefer-const': 'warn',
    'eqeqeq': ['error', 'always', { null: 'ignore' }],
    'no-throw-literal': 'error',
    'no-shadow': 'off',
    '@typescript-eslint/no-shadow': 'warn',
    'no-redeclare': 'off',
    '@typescript-eslint/no-redeclare': 'error',
    'no-eval': 'error',
    'no-implied-eval': 'error',
    'no-new-func': 'error',
    'no-new-wrappers': 'error',
    'no-async-promise-executor': 'error',
    'no-return-await': 'warn',
    'no-template-curly-in-string': 'warn',
    'require-atomic-updates': 'warn',
    // Match root config: pre-existing empty blocks as warnings, not blockers
    'no-empty': 'warn',
  },
}, storybook.configs["flat/recommended"]);
