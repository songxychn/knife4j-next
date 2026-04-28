import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import vueJsx from '@vitejs/plugin-vue-jsx'
import Components from 'unplugin-vue-components/vite'
import { AntDesignVueResolver } from 'unplugin-vue-components/resolvers'
import viteCompression from 'vite-plugin-compression';
import removeConsole from 'vite-plugin-remove-console';
import { resolve } from 'path'
import { nodePolyfills } from 'vite-plugin-node-polyfills'
import fs from 'fs'
import path from 'path'

/**
 * 把 Vite 默认把 public/oauth 复制到 dist/oauth 的产物
 * 移动到 dist/webjars/oauth，与 knife4j-vue (webpack) 构建结果保持一致。
 * utils.js 中 getOAuth2Html(true) 会返回 "webjars/oauth/oauth2.html"，
 * 必须在这个路径下可访问 OAuth2 的回调页面。
 */
function moveOauthToWebjars() {
  let resolvedOutDir = 'dist';
  return {
    name: 'knife4j-move-oauth-to-webjars',
    apply: 'build',
    configResolved(config) {
      resolvedOutDir = path.resolve(config.root, config.build.outDir);
    },
    closeBundle() {
      const srcDir = path.resolve(resolvedOutDir, 'oauth');
      const destDir = path.resolve(resolvedOutDir, 'webjars/oauth');
      if (!fs.existsSync(srcDir)) {
        return;
      }
      fs.mkdirSync(path.dirname(destDir), { recursive: true });
      if (fs.existsSync(destDir)) {
        fs.rmSync(destDir, { recursive: true, force: true });
      }
      fs.renameSync(srcDir, destDir);
    }
  }
}

// https://vitejs.dev/config/
export default defineConfig({
  base: './',
  plugins: [
    vue(),
    vueJsx(),
    Components({
      resolvers: [AntDesignVueResolver()]
    }),
    nodePolyfills(),
    viteCompression({
      deleteOriginFile: false, //删除源文件
      threshold: 10240, //压缩前最小文件大小
      algorithm: 'gzip', //压缩算法
      ext: '.gz', //文件类型
    }),
    removeConsole({
      // iconfont.js 是 iconfont.cn 生成的 IIFE 资源，不经过 babel 处理
      external: ['src/assets/iconfonts/iconfont.js'],
      // 同时匹配 console.log / console.debug 以及 knife4j 代码中常见的 window.console.log / window.console.debug
      custom: ['console.log', 'console.debug', 'window.console.log', 'window.console.debug']
    }),
    moveOauthToWebjars()
  ],
  resolve: {
    alias: [
      { find: '@', replacement: resolve(__dirname, 'src') },
      { find: /^~/, replacement: '' },
    ]
  },
  // 开启less支持
  css: {
    preprocessorOptions: {
      less: {
        javascriptEnabled: true
      }
    }
  },
  server: {
    host: true,
    proxy: {
      '/api': {
        target: `http://localhost:8990`,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, '')
      }
    }
  },
  build: {
    rollupOptions: {
      input: 'doc.html',
      output: {
        chunkFileNames: 'webjars/js/[name]-[hash].js',
        entryFileNames: 'webjars/js/[name]-[hash].js',
        assetFileNames: 'webjars/[ext]/[name]-[hash].[ext]'
      }
    }
  }
})
