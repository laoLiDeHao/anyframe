import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

/**
 * 用 import.meta.url 而不是 __dirname。
 *
 * Vite 8 已经会警告：`configLoader: 'native'` 将成为未来默认值，
 * 而 native 加载器直接把配置文件当原生 ESM 执行，那时 __dirname 不存在。
 * 下面这个写法在 bundle / native 两种加载器下都成立，
 * 也和 apps/mobile/vite.config.ts 保持同一套风格。
 */
const r = (p: string) => fileURLToPath(new URL(p, import.meta.url))

/**
 * Web 端构建。产物是纯静态文件，可部署到任意托管
 * （Nginx / OSS+CDN / Cloudflare Pages / GitHub Pages）。
 *
 * 与桌面 renderer 的唯一实质区别：没有 preload 桥，
 * 本地能力全部依赖用户安装的 Agent（见 src/agent-bootstrap.ts）。
 */
export default defineConfig(({ mode }) => {
  // 部署到子路径时设 BASE_PATH=/anyframe/；GitHub Pages 常用
  const base = process.env.BASE_PATH ?? '/'

  return {
    base,
    plugins: [react()],
    resolve: {
      alias: {
        '@anyframe/core': r('../../packages/core/src/index.ts'),
        '@': r('./src'),
      },
    },
    define: {
      __ANYFRAME_TARGET__: JSON.stringify('web'),
    },
    build: {
      outDir: 'dist',
      emptyOutDir: true,
      target: 'es2022',
      sourcemap: mode !== 'production',
      minify: 'esbuild',
      cssCodeSplit: true,
      // 首屏体积是 Web 端最关键的指标。超过 500KB 就报警，
      // 别等上线后才发现 WASM/图表库把包撑爆。
      chunkSizeWarningLimit: 500,
      reportCompressedSize: true,
      rollupOptions: {
        output: {
          entryFileNames: 'assets/[name]-[hash].js',
          chunkFileNames: 'assets/[name]-[hash].js',
          assetFileNames: 'assets/[name]-[hash][extname]',
          manualChunks(id) {
            if (id.includes('node_modules')) {
              if (id.includes('react')) return 'react'
              if (id.includes('zod')) return 'zod'
              return 'vendor'
            }
          },
        },
      },
    },
    server: {
      port: 5174,
      strictPort: true,
      // 开发时若要连本机 Agent，注意 Agent 的 allowedOrigins
      // 必须包含 http://localhost:5174，否则被 CORS 拦截
    },
    preview: {
      port: 4173,
      strictPort: true,
    },
  }
})

/*
 * ── 可选：PWA ────────────────────────────────────────────────
 * 想让 Web 版能「安装到桌面」、离线打开，加装 vite-plugin-pwa：
 *
 *   pnpm --filter @anyframe/web add -D vite-plugin-pwa
 *
 * 然后在 plugins 里加入：
 *
 *   import { VitePWA } from 'vite-plugin-pwa'
 *   VitePWA({
 *     registerType: 'autoUpdate',
 *     includeAssets: ['favicon.svg'],
 *     manifest: {
 *       name: 'AnyFrame',
 *       short_name: 'AnyFrame',
 *       description: '本地服务运行时与文件工作区',
 *       theme_color: '#0f1115',
 *       background_color: '#0f1115',
 *       display: 'standalone',
 *       start_url: '.',
 *       icons: [
 *         { src: '/pwa-192.png', sizes: '192x192', type: 'image/png' },
 *         { src: '/pwa-512.png', sizes: '512x512', type: 'image/png' },
 *         { src: '/pwa-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
 *       ],
 *     },
 *     workbox: {
 *       // Agent 探测请求绝不能被 SW 缓存，否则装完 Agent 仍显示离线
 *       navigateFallbackDenylist: [/^\/rpc\//, /^\/healthz$/],
 *       runtimeCaching: [
 *         {
 *           urlPattern: ({ url }) => url.hostname === '127.0.0.1',
 *           handler: 'NetworkOnly',
 *         },
 *       ],
 *     },
 *   })
 *
 * ⚠️ Service Worker 拦截 127.0.0.1 请求是 Web 版最隐蔽的坑，
 *    上面的 navigateFallbackDenylist 与 NetworkOnly 两条规则必须保留。
 */
