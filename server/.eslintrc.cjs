/**
 * ESLint configuration for the CIDRTM API (Node + TypeScript, CommonJS).
 *
 * Scope note: this uses the non-type-aware `recommended` rule set on purpose.
 * The type-aware set duplicates what `tsc --noEmit` already catches in CI and
 * adds a large parser cost for very little extra signal on a codebase this size.
 * Formatting is Prettier's job (see the root `.prettierrc.json`), so every
 * stylistic rule that Prettier would fight over is disabled.
 */
module.exports = {
  root: true,
  env: {
    node: true,
    es2022: true,
  },
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'script',
  },
  plugins: ['@typescript-eslint'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'prettier',
  ],
  ignorePatterns: ['dist', 'node_modules', 'data', '*.js'],
  rules: {
    // Unused vars: allow intentional discards (`_next`, `_req`) and rest siblings.
    '@typescript-eslint/no-unused-vars': [
      'error',
      {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
        ignoreRestSiblings: true,
      },
    ],

    // The domain layer leans on enums and string-literal unions; either is fine.
    '@typescript-eslint/no-explicit-any': 'warn',

    // Express handlers and Mongoose hooks legitimately use `this` and non-null
    // assertions after validation has already run.
    '@typescript-eslint/no-non-null-assertion': 'off',

    // Empty interfaces are used to extend Express's Request type.
    '@typescript-eslint/no-empty-interface': 'off',

    // Console output is centralised in the Winston logger, but a bare `console`
    // during bootstrap is acceptable; surface it as a warning, not an error.
    'no-console': 'warn',

    // Prefer const, but allow `let` where a value is genuinely reassigned.
    'prefer-const': ['error', { destructuring: 'all' }],

    // Catch accidental fall-through in switch statements over domain enums.
    'no-fallthrough': 'error',

    // Services return early; an `else` after a `return` is just noise.
    'no-else-return': ['error', { allowElseIf: false }],

    // Object key order in the seeded data and config maps is intentional.
    'sort-keys': 'off',
  },
};
