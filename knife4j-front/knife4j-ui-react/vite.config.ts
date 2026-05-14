import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react-swc';
import path from 'path';

const BACKEND = process.env.VITE_BACKEND ?? 'http://localhost:8080';
const BACKEND_PROXY = {
  target: BACKEND,
  changeOrigin: false,
};

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
      // Preserve the Vite dev-server Host header so springdoc generates
      // servers that point back to the dev origin, keeping debug requests on
      // the proxy path when the UI is opened through a LAN IP.
      '/v3/api-docs': BACKEND_PROXY,
      '/swagger-resources': BACKEND_PROXY,
      '/swagger-ui': BACKEND_PROXY,
      // Demo 后端业务接口（UserController 的 /api/user/**），
      // 供「接口文档调试」在 dev 下直接命中后端。
      '/api': BACKEND_PROXY,
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
