module.exports = {
  extends: ['eslint:recommended', 'plugin:@typescript-eslint/recommended', 'plugin:@typescript-eslint/recommended-requiring-type-checking'],
  parser: '@typescript-eslint/parser',
  plugins: ['@typescript-eslint'],
  parserOptions: {
    //project: true,
    //tsconfigRootDir: __dirname,
    project: './tsconfig.json'
  },
  root: true,
  rules: {
    // 本轮只迁移工具链，保留 v5 preset 的检查范围和级别。
    // v8 拆分 ban-types / no-empty-interface / no-var-requires 后的替代规则由 preset 提供。
    '@typescript-eslint/adjacent-overload-signatures': 'error',
    '@typescript-eslint/no-empty-function': 'error',
    '@typescript-eslint/no-inferrable-types': 'error',
    '@typescript-eslint/no-non-null-assertion': 'warn',
    '@typescript-eslint/no-unused-vars': 'warn',
    'no-empty-function': 'off',
    'no-class-assign': 'error',
    'no-with': 'error',
    'valid-typeof': 'off',
    // 以下检查是 v8 preset 新增的策略，不在本次依赖兼容更新中引入。
    '@typescript-eslint/no-array-delete': 'off',
    '@typescript-eslint/no-base-to-string': 'off',
    '@typescript-eslint/no-duplicate-enum-values': 'off',
    '@typescript-eslint/no-duplicate-type-constituents': 'off',
    '@typescript-eslint/no-redundant-type-constituents': 'off',
    '@typescript-eslint/no-unsafe-declaration-merging': 'off',
    '@typescript-eslint/no-unsafe-enum-comparison': 'off',
    '@typescript-eslint/no-unsafe-unary-minus': 'off',
    '@typescript-eslint/no-unused-expressions': 'off',
    '@typescript-eslint/only-throw-error': 'off',
    '@typescript-eslint/prefer-promise-reject-errors': 'off',
    // 允许使用any
    "@typescript-eslint/no-explicit-any": "off",
    // 强制使用===和!==
    "eqeqeq": "error",
  }
};
