import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react-swc';
import path from 'path';

const BACKEND = process.env.VITE_BACKEND ?? 'http://localhost:8080';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  base: './',
  resolve: {
    alias: {
      'knife4j-core': path.resolve(__dirname, '../knife4j-core/lib'),
    },
  },
  optimizeDeps: {
    include: ['knife4j-core'],
  },
  server: {
    proxy: {
      '/v3/api-docs': { target: BACKEND, changeOrigin: true },
      '/swagger-resources': { target: BACKEND, changeOrigin: true },
      '/swagger-ui': { target: BACKEND, changeOrigin: true },
      // Demo 后端业务接口（UserController 的 /api/user/**），
      // 供「接口文档调试」在 dev 下直接命中后端。
      '/api': { target: BACKEND, changeOrigin: true },
    },
  },
  build: {
    commonjsOptions: {
      include: [/knife4j-core/, /node_modules/],
    },
    rollupOptions: {
      output: {
        entryFileNames: 'assets/index.js',
        chunkFileNames: 'assets/[name].js',
        assetFileNames: 'assets/[name].[ext]',
      },
    },
  },
});
