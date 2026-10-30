// Lint for the code written to the new standard: packages/*, apps/* and the new server
// directories (src/http, src/modules). The legacy server files, the legacy portals, the
// tools and the tests are ignored for now and join as they are migrated — ignoring them is
// the starting point of the migration, not a verdict on them.
const js = require('@eslint/js');
const globals = require('globals');
const tseslint = require('typescript-eslint');
const reactHooks = require('eslint-plugin-react-hooks');

module.exports = [
  {
    ignores: [
      'node_modules/**',
      '**/dist/**',
      'coverage/**',
      'public/**',
      'tests/**',
      'tools/**',
      'scripts/**',
      'migrations/**',
      'index.js',
      // The legacy server: everything directly under src/ except the two directories that are new. It is the
      // CHILDREN of src/ that are ignored and two of them brought back: a pattern like `src/**` ignores the
      // directories themselves, and a negated `!src/http/**` cannot bring back a file whose parent directory is
      // ignored — which left src/http unlinted without a word until Run 2 noticed.
      'src/*',
      '!src/http',
      '!src/modules',
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
  // The web app: TypeScript and React.
  ...tseslint.configs.recommended.map(config => ({ ...config, files: ['apps/web/**/*.{ts,tsx}'] })),
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser } },
    plugins: reactHooks.configs.flat.recommended.plugins,
    rules: {
      ...reactHooks.configs.flat.recommended.rules,
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-var': 'error',
      'prefer-const': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
      ],
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },
];
