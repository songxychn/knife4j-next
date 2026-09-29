import { defineConfig } from 'vitest/config';
import path from 'path';

const coreAlias = { 'knife4j-core': path.resolve(__dirname, '../core/lib') };

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          environment: 'node',
          include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
          exclude: ['src/**/*.integration.test.ts', 'src/**/*.integration.test.tsx'],
        },
        resolve: {
          alias: {
            // These lightweight mocks belong only to the existing pure-logic tests.
            antd: path.resolve(__dirname, 'src/__mocks__/antd.ts'),
            '@ant-design/icons': path.resolve(__dirname, 'src/__mocks__/@ant-design/icons.ts'),
            'react-i18next': path.resolve(__dirname, 'src/__mocks__/react-i18next.ts'),
            'react/jsx-dev-runtime': path.resolve(__dirname, 'src/__mocks__/react-jsx-runtime.ts'),
            'react/jsx-runtime': path.resolve(__dirname, 'src/__mocks__/react-jsx-runtime.ts'),
            react: path.resolve(__dirname, 'src/__mocks__/react.ts'),
            'react-dom': path.resolve(__dirname, 'src/__mocks__/react-dom.ts'),
            ...coreAlias,
          },
        },
      },
      {
        test: {
          name: 'integration',
          environment: 'jsdom',
          include: ['src/**/*.integration.test.ts', 'src/**/*.integration.test.tsx'],
          setupFiles: ['src/test/integrationSetup.ts'],
        },
        resolve: { alias: coreAlias },
      },
    ],
  },
});
