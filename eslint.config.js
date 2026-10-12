import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', 'output/**', 'tmp/**', 'node_modules/**'] },
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.ts', 'scripts/**/*.ts', 'tests/**/*.ts'],
    rules: {
      // Checked by strict TypeScript; DOM queries intentionally use assertions.
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }],
    },
  },
);
