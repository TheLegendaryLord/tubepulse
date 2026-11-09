import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default [
  { ignores: ['**/dist/**', 'artifacts/**', '**/coverage/**'] },
  { files: ['**/*.ts'], rules: eslint.configs.recommended.rules },
  ...tseslint.configs.recommended,
];
