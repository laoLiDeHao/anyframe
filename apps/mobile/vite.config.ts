import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

/**
 * 移动端（Capacitor）渲染层构建。
 *
 * ── 为什么 base 必须是 './' ──────────────────────────────
 * Capacitor 把 dist/ 里的文件塞进 App 包，由原生侧的 WebViewAssetLoader
 * 以 https://localhost/（Android）或 capacitor://localhost（iOS）加载。
 * 这不是一个真实部署在域名根路径的站点，用绝对路径 /assets/x.js 会在
 * 部分 Android ROM 上 404 → 白屏。相对路径 './assets/x.js' 永远正确。
 *
 * ── 与 apps/web 的产物差异 ───────────────────────────────
 * web 端可以用 ?agent= 手动指定远端 Agent；移动端不行，因为
 * androidScheme: 'https' 之后 WebView 里的 http:// 明文请求会被
 * 混合内容策略拦截。移动端所有本地能力必须经 Capacitor 插件走原生层。
 * 所以这里 define 注入 __ANYFRAME_TARGET__，代码里据此走不同分支，
 * 避免把桌面/网页的 Agent 探测逻辑打进移动端包。
 */
export default defineConfig(() => ({
  base: './',
  plugins: [react()],
  resolve: {
    alias: {
      '@anyframe/core': r('../../packages/core/src/index.ts'),
      '@': r('./src'),
    },
  },
  define: {
    // 与 apps/web 的 vite.config.ts 保持同名，src/ 下的分支判断可复用
    __ANYFRAME_TARGET__: JSON.stringify('capacitor'),
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2022',
    // 关掉 sourcemap：App 包里带 .map 会让包体膨胀 2~3 倍，
    // 而且线上崩溃栈应该走 Sentry 之类的 sourceMap 上传，不该随包分发。
    // 首屏体积直接影响冷启动时间（WebView 解析阻塞主线程）。
    sourcemap: false,
    minify: 'esbuild',
    cssCodeSplit: true,
    chunkSizeWarningLimit: 400,
    reportCompressedSize: false,
    rollupOptions: {
      output: {
        entryFileNames: 'assets/[name]-[hash].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
        /**
         * ⚠️ 必须用函数形式：Vite 8 的 OutputOptions 只接受
         * ManualChunksFunction，对象形式会 TS2769 编译不过。
         *
         * 移动端把 react 切出去还有个额外收益 —— WebView 冷启动时
         * 解析 JS 是阻塞主线程的，chunk 拆开后首屏只需解析入口，
         * react/vendor 可以并行解析。
         */
        manualChunks(id) {
          if (!id.includes('node_modules')) return
          if (id.includes('react-dom') || id.includes('/react/')) return 'react'
          if (id.includes('@capacitor')) return 'capacitor'
          if (id.includes('zod')) return 'zod'
          return 'vendor'
        },
      },
    },
  },
  server: {
    // 真机调试时手机访问开发机的 IP，必须监听所有网卡。
    // 用法：pnpm dev，然后 npx cap run android --live-reload
    // 让 Capacitor 把 WebView 指向 http://<开发机IP>:5175。
    host: true,
    port: 5175,
    strictPort: true,
  },
}));
