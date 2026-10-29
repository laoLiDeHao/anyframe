import react from '@vitejs/plugin-react'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

/**
 * 五端共用的唯一 UI 构建。
 *
 * 产物是一份**纯静态**站点：index.html + 若干 js chunk，没有任何服务端依赖。
 * desktop 把它拷进 asar 的 dist/renderer/，mobile 拷进 webDir，web 直接部署。
 * 因此这里有三条硬约束：
 *
 * 1. base 必须是 './'。
 *    desktop 从 file://…/app.asar/dist/renderer/index.html 加载，
 *    iOS 从 capacitor://localhost/ 加载，两者都没有「站点根」的概念，
 *    绝对路径 /assets/xxx.js 会直接 404。
 *    代价是放弃按 BASE_PATH 部署到子路径再配 history 回退的能力 ——
 *    本应用没有前端路由，相对 base 在域名根与子路径下都正确。
 * 2. 不能 import 任何 node:* 模块。tsconfig.json 里用 types: [] 兜住。
 * 3. 宿主差异全部走运行时探测（src/host/），不做构建期分叉。
 *    一份产物服务五端，就不存在「某个端的包忘了重新构建」这类问题。
 */
const r = (p: string) => fileURLToPath(new URL(p, import.meta.url))

export default defineConfig({
  base: './',
  plugins: [react()],
  define: {
    // 界面要显示版本号，但浏览器读不到 package.json —— 构建期注入一次。
    // 四个宿主共用同一个变量名，见 src/version.ts。
    __ANYFRAME_VERSION__: JSON.stringify(
      JSON.parse(readFileSync(r('../../package.json'), 'utf8')).version,
    ),
  },
  resolve: {
    alias: {
      // 直接吃 core 的 TS 源码：改契约后 HMR 立即生效，
      // 也避免「core 忘了 build」导致的陈旧 dist 被打包。
      '@anyframe/core': r('../core/src/index.ts'),
    },
  },
  build: {
    outDir: r('./dist'),
    emptyOutDir: true,
    sourcemap: true,
    target: 'es2022',
    rollupOptions: {
      output: {
        // Vite 8 只接受函数形式的 manualChunks，对象形式会直接 TS2769。
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
    // desktop 主进程开发模式固定加载 http://localhost:5173，
    // 见 apps/desktop/src/main/index.ts 的 DEV_RENDERER_URL。
    port: 5173,
    strictPort: true,
    hmr: { port: 5173 },
  },
})
