import { defineConfig } from 'vitest/config';
import path from 'path';

// Keep each independent project within the same bounded worker budget.
const maxWorkers = 2;
const coreAlias = { find: /^knife4j-core$/, replacement: path.resolve(__dirname, '../core/lib') };

export default defineConfig({
  test: {
    projects: [
      {
        extends: false,
        test: {
          clearMocks: false,
          maxWorkers,
          name: 'unit',
          environment: 'node',
          setupFiles: ['src/test/webPlatformSetup.ts'],
          include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
          exclude: ['src/**/*.integration.test.ts', 'src/**/*.integration.test.tsx'],
        },
        resolve: {
          alias: [
            // These lightweight mocks belong only to the existing pure-logic tests.
            { find: 'antd', replacement: path.resolve(__dirname, 'src/__mocks__/antd.ts') },
            { find: '@ant-design/icons', replacement: path.resolve(__dirname, 'src/__mocks__/@ant-design/icons.ts') },
            { find: 'react-i18next', replacement: path.resolve(__dirname, 'src/__mocks__/react-i18next.ts') },
            coreAlias,
          ],
        },
      },
      {
        extends: false,
        test: {
          clearMocks: false,
          maxWorkers,
          name: 'integration',
          environment: 'jsdom',
          include: ['src/**/*.integration.test.ts', 'src/**/*.integration.test.tsx'],
          setupFiles: ['src/test/integrationSetup.ts'],
        },
        resolve: { alias: [coreAlias] },
      },
    ],
  },
});
