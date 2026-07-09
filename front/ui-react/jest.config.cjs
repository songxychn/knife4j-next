/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  transform: {
    '^.+\\.(t|j)sx?$': ['ts-jest', {
      tsconfig: {
        module: 'commonjs',
        moduleResolution: 'node',
        jsx: 'react-jsx',
        esModuleInterop: true,
        allowSyntheticDefaultImports: true,
        strict: false,
        noUnusedLocals: false,
        noUnusedParameters: false,
        skipLibCheck: true,
      },
    }],
  },
  testMatch: ['**/?(*.)+(spec|test).+(ts|tsx|js|jsx)'],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json'],
  moduleNameMapper: {
    '^antd$': '<rootDir>/src/__mocks__/antd.ts',
    '^@ant-design/icons$': '<rootDir>/src/__mocks__/@ant-design/icons.ts',
    '^knife4j-core$': '<rootDir>/src/__mocks__/knife4j-core.ts',
    '^react-i18next$': '<rootDir>/src/__mocks__/react-i18next.ts',
    '^docx$': '<rootDir>/src/__mocks__/docx.ts',
    '^../../context/GroupContext$': '<rootDir>/src/__mocks__/GroupContext.ts',
    '^react$': '<rootDir>/src/__mocks__/react.ts',
    '^react-dom$': '<rootDir>/src/__mocks__/react-dom.ts',
  },
  roots: ['<rootDir>/src'],
};
