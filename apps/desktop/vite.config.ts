import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

/**
 * 用 import.meta.url 而不是 __dirname。
 *
 * apps/desktop 的 package.json 是 "type": "module"，
 * Vite 未来的 configLoader: 'native' 会直接把本文件当原生 ESM 执行，
 * 那时 __dirname 根本不存在（Vite 8 已经会为此打警告）。
 * fileURLToPath(new URL(...)) 在 bundle / native 两种加载器下都成立，
 * 也与 apps/mobile/vite.config.ts 保持同一套写法。
 */
const r = (p: string) => fileURLToPath(new URL(p, import.meta.url))

/**
 * Renderer 构建（就是普通 Web 应用）。
 *
 * ⚠️ base 必须是 './' 相对路径：
 *   打包后 index.html 由 Electron 通过 file:// 协议加载，
 *   默认的 '/' 会导致所有资源 404、白屏。
 *   这是 Electron + Vite 最高频的踩坑点。
 */
export default defineConfig({
  root: r('./src/renderer'),
  base: './',
  plugins: [react()],
  resolve: {
    alias: {
      '@anyframe/core': r('../../packages/core/src/index.ts'),
      '@': r('./src/renderer'),
    },
  },
  define: {
    // 让共享 UI 代码能区分宿主，但不要用它替代 capabilities 探测
    __ANYFRAME_TARGET__: JSON.stringify('desktop'),
  },
  build: {
    outDir: r('./dist/renderer'),
    emptyOutDir: true,
    target: 'chrome132',        // Electron 44 = Chromium 152，留足余量
    sourcemap: true,
    minify: 'esbuild',
    cssCodeSplit: true,
    assetsInlineLimit: 4096,
    rollupOptions: {
      input: r('./src/renderer/index.html'),
      output: {
        // 固定文件名，便于 electron-updater 做差分更新
        entryFileNames: 'assets/[name].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
        /**
         * ⚠️ 必须用函数形式。Vite 8 的 OutputOptions 只接受
         * ManualChunksFunction，写成 `{ react: ['react','react-dom'] }`
         * 这种对象形式会直接 TS2769 编译不过（apps/web 同理）。
         *
         * 桌面端不像 Web 端那样对首屏体积敏感（资源走 file://，
         * 没有网络往返），但仍要把 react 单独切出来：
         * 业务代码每次改动都变，react 几乎不变，分开后
         * electron-updater 的 blockmap 差分下载能小一个数量级。
         */
        manualChunks(id) {
          if (!id.includes('node_modules')) return
          if (id.includes('react-dom') || id.includes('/react/')) return 'react'
          if (id.includes('zod')) return 'zod'
          return 'vendor'
        },
      },
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    // 主进程开发模式加载 http://localhost:5173
    hmr: { port: 5173 },
  },
  // Renderer 里会 import @anyframe/core 的浏览器安全子集，
  // Node 内置模块不能被打进来
  optimizeDeps: {
    exclude: ['electron'],
  },
})
