import { defineConfig } from 'tsup'

/**
 * Electron 主进程 + preload 的构建。
 *
 * 为什么用 tsup 而不是 vite-plugin-electron：
 *   - 主进程是 Node 目标，tsup 直接产出 CJS，无需处理 ESM/CJS 互操作
 *   - preload 必须是 CJS 或 sandboxed ESM，tsup 的 format 控制最直接
 *   - 少一个 Electron 专用插件依赖，升级 Electron 时不会被动
 *
 * 产物路径与 package.json 的 "main"、electron-builder.yml 的 files 一致：
 *   dist/main/index.cjs
 *   dist/preload/index.cjs
 */
export default defineConfig([
  {
    entry: { 'main/index': 'src/main/index.ts' },
    outDir: 'dist',
    format: ['cjs'],
    platform: 'node',
    target: 'node22',            // Electron 44 内置 Node 24.18，向下兼容 22 语法
    sourcemap: true,
    clean: false,                // renderer 产物在同目录，别清掉
    dts: false,
    // electron 与 Node 内置模块必须 external，否则会被打进 bundle
    external: ['electron'],
    // 用正则而不是字符串：主进程 import 的是 '@anyframe/core/node' 子路径，
    // 字符串 '@anyframe/core' 在 tsup 里不会匹配到子路径，会导致它被 external，
    // 打包成 asar 后运行时找不到模块。
    noExternal: [/^@anyframe\//],
    shims: false,
    define: {
      'process.env.ANYFRAME_BUILD_TARGET': '"desktop"',
    },
    banner: {
      // 让 CJS 产物里能用 import.meta.url 语义
      js: '/* AnyFrame desktop main process */',
    },
  },
  {
    entry: { 'preload/index': 'src/preload/index.ts' },
    outDir: 'dist',
    format: ['cjs'],
    platform: 'node',
    target: 'node22',
    sourcemap: true,
    clean: false,
    dts: false,
    external: ['electron'],
    // 刻意不设 noExternal：preload 里禁止 import @anyframe/core。
    // BrowserWindow 开了 sandbox: true，preload 只有一个受限的 process 垫片，
    // 没有 node:fs / node:http / node:child_process；一旦内联 core 的 Node 运行时，
    // 打包能过、启动即崩（"require is not defined" 或 "Cannot find module 'node:http'"）。
    // 业务数据全部由 renderer 走 HTTP 直连 127.0.0.1，preload 只做引导。
    // preload 运行在隔离上下文，禁止访问 Node 全局（contextIsolation: true）
    define: {
      'process.env.ANYFRAME_BUILD_TARGET': '"desktop-preload"',
    },
  },
])
