// @ts-check
'use strict';

const js = require('@eslint/js');
const globals = require('globals');
const sqlPlugin = require('eslint-plugin-sql').default;

module.exports = [
  // Base recommended rules
  js.configs.recommended,

  // Ignore patterns (replaces .eslintignore)
  {
    ignores: ['node_modules/**', 'public/**', 'tests/**', 'scripts/**', 'ecosystem.config.js', 'playwright.config.js', 'db-schema.js', 'db-schema2.js', 'check_*.js'],
  },

  // Server-side JS (lib/, routes/, server.js)
  {
    files: ['lib/**/*.js', 'routes/**/*.js', 'server.js', 'eslint.config.js'],
    plugins: {
      sql: sqlPlugin,
    },
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: {
        ...globals.node,
      },
    },
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-console': ['warn', { allow: ['debug', 'error', 'warn'] }],
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
      // Pre-existing issues from recommended — tracked as warnings, not blockers
      'no-empty': 'warn',
      'no-control-regex': 'warn',
      'no-undef': 'warn',
      'no-dupe-keys': 'warn',
      // SQL linting — format check for SQL in template literals
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
      // no-unsafe-query is off — the codebase uses raw parameterized queries,
      // not tagged template literals, so requiring a `sql` tag is not applicable.
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
    files: ['tests/**/*.js'],
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
