import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', 'output/**', 'tmp/**', 'node_modules/**'] },
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.ts', 'scripts/**/*.ts', 'scripts/**/*.mjs', 'tests/**/*.ts', 'fixtures/**/*.ts'],
    rules: {
      // Checked by strict TypeScript; DOM queries intentionally use assertions.
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['src/frontend/**/*.ts', 'src/shared/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [
          { regex: '^(?!\\.)', message: 'Frontend/shared only import local presentation code and shared contracts.' },
          { group: ['**/backend/**'], message: 'Frontend/shared must not depend on backend implementation.' },
          { group: ['node:*', 'playwright', 'sharp', 'undici', 'cheerio', 'dotenv', '@supabase/**'], message: 'Keep Node.js and service dependencies in backend.' },
        ],
      }],
      'no-restricted-globals': ['error', 'process', 'Buffer', 'require', '__dirname', '__filename'],
    },
  },
  {
    files: ['src/shared/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [
          { regex: '^(?!\\.)', message: 'Shared contracts only import other local shared modules.' },
          { group: ['**/backend/**', '**/frontend/**'], message: 'Shared contracts must remain independent of runtime implementations.' },
        ],
      }],
      'no-restricted-globals': ['error', 'document', 'window', 'process', 'Buffer', 'require', '__dirname', '__filename'],
    },
  },
);
