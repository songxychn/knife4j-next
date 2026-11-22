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
  worker: { format: 'es' },
  resolve: {
    // Leave built-module imports under knife4j-core/lib to package resolution.
    alias: [{ find: /^knife4j-core$/, replacement: path.resolve(__dirname, '../core/lib') }],
  },
  optimizeDeps: {
    include: [
      'knife4j-core',
      'knife4j-core/lib/auth/oauthDeviceAuthorization',
      'knife4j-core/lib/auth/oas32Security',
      'knife4j-core/lib/offlineDocumentSnapshot',
      'knife4j-core/lib/openApiOperationExport',
      'knife4j-core/lib/openapi32/sequentialMedia',
      'knife4j-core/lib/utils/stableJson',
    ],
  },
  server: {
    proxy: {
      // Preserve the Vite dev-server Host header so springdoc generates
      // servers that point back to the dev origin, keeping debug requests on
      // the proxy path when the UI is opened through a LAN IP.
      '/v3/api-docs': BACKEND_PROXY,
      '/swagger-resources': BACKEND_PROXY,
      '/swagger-ui': BACKEND_PROXY,
      // Demo 后端业务接口，供「接口文档调试」在 dev 下直接命中后端。
      // - /api/**：UserController、Stream、validation 等
      // - /upload/**：UploadController（multipart），此前未代理会导致调试 404
      '/api': BACKEND_PROXY,
      '/upload': BACKEND_PROXY,
    },
  },
  build: {
    // JSONPath 11 requires native RegExp v support; keep JS syntax at ES2020.
    target: ['es2020', 'edge112', 'firefox116', 'chrome112', 'safari17'],
    rolldownOptions: {
      output: {
        entryFileNames: 'assets/index.js',
        chunkFileNames: 'assets/[name].js',
        assetFileNames: 'assets/[name].[ext]',
      },
    },
  },
});
