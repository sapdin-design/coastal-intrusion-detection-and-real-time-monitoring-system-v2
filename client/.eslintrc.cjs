/**
 * ESLint configuration for the CIDRTM dashboard (React 18 + TypeScript, ESM).
 *
 * Scope note: non-type-aware `recommended` on purpose — `tsc --noEmit` already
 * covers type correctness in CI, and the type-aware ruleset is a large parser
 * cost for little extra signal here. Formatting belongs to Prettier, so the
 * stylistic rules Prettier owns are switched off.
 */
module.exports = {
  root: true,
  env: {
    browser: true,
    es2022: true,
  },
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
    ecmaFeatures: { jsx: true },
  },
  plugins: ['@typescript-eslint', 'react-hooks', 'react-refresh'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:react-hooks/recommended',
    'prettier',
  ],
  ignorePatterns: ['dist', 'node_modules', '*.config.js', '*.config.ts'],
  settings: {
    react: { version: 'detect' },
  },
  rules: {
    '@typescript-eslint/no-unused-vars': [
      'error',
      {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
        ignoreRestSiblings: true,
      },
    ],
    '@typescript-eslint/no-explicit-any': 'warn',
    '@typescript-eslint/no-non-null-assertion': 'off',
    '@typescript-eslint/no-empty-interface': 'off',

    // Vite fast-refresh: only components may be exported from a component file.
    // The design-system kit and chart modules intentionally export helpers too.
    'react-refresh/only-export-components': [
      'warn',
      { allowConstantExport: true },
    ],

    // React 17+ JSX transform — importing React is unnecessary.
    'react/react-in-jsx-scope': 'off',

    'no-console': ['warn', { allow: ['warn', 'error'] }],
    'prefer-const': ['error', { destructuring: 'all' }],
    'no-else-return': ['error', { allowElseIf: false }],
  },
};
