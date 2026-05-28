import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';

export default tseslint.config(
  // Base recommended rules
  js.configs.recommended,
  // TypeScript recommended rules (includes parser setup)
  ...tseslint.configs.recommended,
  // Ignore patterns
  {
    ignores: ['dist/**', 'node_modules/**', 'coverage/**', '*.config.ts'],
  },
  // Shared TypeScript/TSX source files (browser + node-compatible runtime)
  {
    files: ['src/**/*.{ts,tsx}'],
    plugins: {
      'react-hooks': reactHooks,
    },
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      parser: tseslint.parser,
      globals: {
        ...globals.browser,
        ...globals.node,
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
      'no-empty': 'warn',
    },
  },
  // Test files (vitest globals) and type declaration files
  {
    files: ['src/**/*.test.{ts,tsx}', 'src/test-setup.ts', 'src/**/*.d.ts'],
    languageOptions: {
      globals: {
        ...globals.vitest,
      },
    },
    rules: {
      'no-console': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-empty-object-type': 'off',
    },
  },
);
