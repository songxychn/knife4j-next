const js = require('@eslint/js');
const ts = require('@typescript-eslint/eslint-plugin');
const parser = require('@typescript-eslint/parser');

module.exports = [
  { ignores: ['**/.*', '**/*.cjs', '**/*.mjs', 'lib/**', '**/__tests__/**', 'src/debug_old/**'] },
  {
    files: ['**/*.{js,ts}'],
    languageOptions: {
      parser,
      sourceType: 'module',
      ecmaVersion: 2018,
      parserOptions: { project: './tsconfig.json', tsconfigRootDir: __dirname },
    },
    linterOptions: { reportUnusedDisableDirectives: 'off' },
    plugins: { '@typescript-eslint': ts },
    rules: {
      ...js.configs.recommended.rules,
      ...ts.configs['recommended-type-checked'].rules,
    },
  },
  { files: ['**/*.ts'], rules: ts.configs['eslint-recommended'].overrides[0].rules },
  // 保留迁移前的规则策略，不隐式启用新版 preset 的新增检查。
  {
    files: ['**/*.{js,ts}'],
    rules: {
      'no-constant-binary-expression': 'off',
      // ESLint 9 默认跳过 while (true)；原门禁仍检查所有循环。
      'no-constant-condition': [
        'error',
        {
          checkLoops: 'all',
        },
      ],
      'no-empty-static-block': 'off',
      'no-unused-private-class-members': 'off',
      'valid-typeof': 'off',
      '@typescript-eslint/no-array-delete': 'off',
      '@typescript-eslint/no-base-to-string': 'off',
      '@typescript-eslint/no-duplicate-enum-values': 'off',
      '@typescript-eslint/no-duplicate-type-constituents': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-redundant-type-constituents': 'off',
      '@typescript-eslint/no-unsafe-declaration-merging': 'off',
      '@typescript-eslint/no-unsafe-enum-comparison': 'off',
      '@typescript-eslint/no-unsafe-unary-minus': 'off',
      '@typescript-eslint/no-unused-expressions': 'off',
      '@typescript-eslint/no-unused-vars': 'warn',
      '@typescript-eslint/only-throw-error': 'off',
      '@typescript-eslint/prefer-promise-reject-errors': 'off',
      '@typescript-eslint/adjacent-overload-signatures': 'error',
      '@typescript-eslint/no-empty-function': 'error',
      '@typescript-eslint/no-inferrable-types': 'error',
      '@typescript-eslint/no-non-null-assertion': 'warn',
      eqeqeq: 'error',
      'no-extra-semi': 'error',
      'no-inner-declarations': [
        'error',
        'functions',
        {
          blockScopedFunctions: 'disallow',
        },
      ],
      'no-mixed-spaces-and-tabs': 'error',
    },
  },
  {
    files: ['**/*.js'],
    rules: {
      'no-new-native-nonconstructor': 'off',
      'no-new-symbol': 'error',
    },
  },
  {
    files: ['**/*.ts'],
    rules: {
      'no-class-assign': 'error',
      'no-with': 'error',
    },
  },
];
