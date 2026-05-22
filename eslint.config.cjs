// @ts-check
'use strict';

const js = require('@eslint/js');
const globals = require('globals');
const tseslint = require('typescript-eslint');
const sqlPlugin = require('eslint-plugin-sql').default;

module.exports = [
  // Base recommended rules
  js.configs.recommended,

  // Ignore patterns (replaces .eslintignore)
  {
    ignores: ['node_modules/**', 'public/**', 'tests/**', 'scripts/**', 'ecosystem.config.js', 'playwright.config.js', 'db-schema.js', 'db-schema2.js', 'check_*.js'],
  },

  // Server-side TypeScript (lib/, routes/, server.ts)
  {
    files: ['lib/**/*.ts', 'routes/**/*.ts', 'server.ts'],
    plugins: {
      sql: sqlPlugin,
      '@typescript-eslint': tseslint.plugin,
    },
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      parser: tseslint.parser,
      globals: {
        ...globals.node,
      },
    },
    rules: {
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
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
      'no-control-regex': 'warn',
      'no-undef': 'off',
      'no-dupe-keys': 'warn',
      'sql/format': ['warn', {
        ignoreExpressions: true,
        ignoreInline: true,
        ignoreTagless: false,
        ignoreStartWithNewLine: true,
        retainBaseIndent: true,
      }, {
        language: 'postgresql',
        keywordCase: 'preserve',
        dataTypeCase: 'preserve',
        functionCase: 'preserve',
        identifierCase: 'preserve',
        paramTypes: { numbered: ['$'] },
        tabWidth: 2,
      }],
      'sql/no-unsafe-query': 'off',
    },
  },

  // Browser-side JS (public/)
  {
    files: ['public/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.browser,
      },
    },
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-var': 'error',
      'prefer-const': 'warn',
      'eqeqeq': ['error', 'always', { null: 'ignore' }],
      'no-throw-literal': 'error',
      'no-shadow': 'warn',
      'no-redeclare': 'error',
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
      'no-new-wrappers': 'error',
      'no-async-promise-executor': 'error',
      'no-return-await': 'warn',
      'no-template-curly-in-string': 'warn',
      'require-atomic-updates': 'warn',
      'no-console': 'off',
    },
  },

  // Test files
  {
    files: ['tests/**/*.ts'],
    plugins: {
      '@typescript-eslint': tseslint.plugin,
    },
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      parser: tseslint.parser,
      globals: {
        ...globals.node,
      },
    },
    rules: {
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-var': 'error',
      'prefer-const': 'warn',
      'eqeqeq': ['error', 'always', { null: 'ignore' }],
      'no-console': 'off',
      'no-undef': 'off',
    },
  },

  // Script files
  {
    files: ['scripts/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: {
        ...globals.node,
      },
    },
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-var': 'error',
      'prefer-const': 'warn',
      'eqeqeq': ['error', 'always', { null: 'ignore' }],
      'no-console': 'off',
    },
  },
];
