import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
  resolve: {
    alias: {
      // Mock heavy runtime deps that are not needed for pure-logic tests
      'docx': path.resolve(__dirname, 'src/__mocks__/docx.ts'),
      'antd': path.resolve(__dirname, 'src/__mocks__/antd.ts'),
      '@ant-design/icons': path.resolve(__dirname, 'src/__mocks__/@ant-design/icons.ts'),
      'react-i18next': path.resolve(__dirname, 'src/__mocks__/react-i18next.ts'),
      'react': path.resolve(__dirname, 'src/__mocks__/react.ts'),
      'react/jsx-dev-runtime': path.resolve(__dirname, 'src/__mocks__/react-jsx-runtime.ts'),
      'react/jsx-runtime': path.resolve(__dirname, 'src/__mocks__/react-jsx-runtime.ts'),
      'react-dom': path.resolve(__dirname, 'src/__mocks__/react-dom.ts'),
      // knife4j-core: use the built lib (same as vite.config.ts)
      'knife4j-core': path.resolve(__dirname, '../knife4j-core/lib'),
    },
  },
});
