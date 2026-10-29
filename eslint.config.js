// Lint for the code written to the new standard: packages/*, apps/* and the new server
// directories (src/http, src/modules). The legacy server files, the legacy portals, the
// tools and the tests are ignored for now and join as they are migrated — ignoring them is
// the starting point of the migration, not a verdict on them.
const js = require('@eslint/js');
const globals = require('globals');

module.exports = [
  {
    ignores: [
      'node_modules/**',
      'dist/**',
      'coverage/**',
      'public/**',
      'tests/**',
      'tools/**',
      'scripts/**',
      'migrations/**',
      'index.js',
      // the legacy server: everything under src/ except the two directories that are new
      'src/**',
      '!src/http/**',
      '!src/modules/**',
    ],
  },
  js.configs.recommended,
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'commonjs',
      globals: { ...globals.node },
    },
    rules: {
      'no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
      ],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-var': 'error',
      'prefer-const': 'error',
      'no-empty': ['error', { allowEmptyCatch: false }],
    },
  },
];
