import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react-swc';

const BACKEND = process.env.VITE_BACKEND ?? 'http://localhost:8080';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  base: './',
  optimizeDeps: {
    include: ['knife4j-core'],
  },
  server: {
    proxy: {
      '/v3/api-docs': { target: BACKEND, changeOrigin: true },
      '/swagger-resources': { target: BACKEND, changeOrigin: true },
      '/swagger-ui': { target: BACKEND, changeOrigin: true },
      '/doc.html': { target: BACKEND, changeOrigin: true },
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
