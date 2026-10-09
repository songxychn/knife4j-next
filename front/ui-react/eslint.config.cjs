const js = require('@eslint/js');
const ts = require('@typescript-eslint/eslint-plugin');
const parser = require('@typescript-eslint/parser');
const globals = require('globals');
const hooks = require('eslint-plugin-react-hooks');
const refresh = require('eslint-plugin-react-refresh');

module.exports = [
  { ignores: ['**/.*', '**/*.js', '**/*.cjs', '**/*.mjs', '**/dist/**'] },
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parser,
      sourceType: 'module',
      ecmaVersion: 2020,
      globals: { ...globals.browser, ...globals.es2020 },
    },
    linterOptions: { reportUnusedDisableDirectives: 'error' },
    plugins: { '@typescript-eslint': ts, 'react-hooks': hooks, 'react-refresh': refresh },
    rules: {
      ...js.configs.recommended.rules,
      ...ts.configs['recommended'].rules,
      ...hooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    },
  },
  { files: ['**/*.{ts,tsx}'], rules: ts.configs['eslint-recommended'].overrides[0].rules },
  // 保留迁移前的规则策略，不隐式启用新版 preset 的新增检查。
  {
    files: ['**/*.{ts,tsx}'],
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
      'no-loss-of-precision': 'off',
      'no-unused-private-class-members': 'off',
      '@typescript-eslint/no-empty-object-type': 'off',
      '@typescript-eslint/no-require-imports': 'off',
      '@typescript-eslint/no-unsafe-function-type': 'off',
      '@typescript-eslint/no-unused-expressions': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          caughtErrors: 'none',
        },
      ],
      '@typescript-eslint/no-wrapper-object-types': 'off',
      '@typescript-eslint/prefer-namespace-keyword': 'off',
      '@typescript-eslint/no-loss-of-precision': 'error',
      '@typescript-eslint/no-var-requires': 'error',
      'no-extra-semi': 'error',
      'no-inner-declarations': [
        'error',
        'functions',
        {
          blockScopedFunctions: 'disallow',
        },
      ],
      'no-mixed-spaces-and-tabs': 'error',
      // v7 ban-types 已移除：保留原禁用类型及空类型字面量检查。
      '@typescript-eslint/no-restricted-types': [
        'error',
        {
          types: {
            String: {
              message: 'Use string instead',
              fixWith: 'string',
            },
            Boolean: {
              message: 'Use boolean instead',
              fixWith: 'boolean',
            },
            Number: {
              message: 'Use number instead',
              fixWith: 'number',
            },
            Symbol: {
              message: 'Use symbol instead',
              fixWith: 'symbol',
            },
            BigInt: {
              message: 'Use bigint instead',
              fixWith: 'bigint',
            },
            Function: 'Use an explicit function signature instead.',
            Object: {
              message: 'Use object, unknown or NonNullable<unknown> instead.',
              suggest: ['object', 'unknown', 'NonNullable<unknown>'],
            },
          },
        },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: 'TSTypeLiteral[members.length=0]',
          message:
            'Do not use {} as a type. Use object, unknown, Record<string, never> or NonNullable<unknown> instead.',
        },
      ],
    },
  },
  {
    files: ['**/*.{ts,tsx}'],
    rules: {
      'no-class-assign': 'error',
      'no-with': 'error',
    },
  },
];
