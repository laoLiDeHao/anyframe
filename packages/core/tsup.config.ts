import { defineConfig } from 'tsup'

// core 必须同时产出 ESM 与 CJS：
//   ESM → Vite（web / mobile / desktop renderer）
//   CJS → Electron 主进程、Agent（打包为单文件可执行程序）
export default defineConfig({
  entry: {
    // 浏览器安全入口（web / mobile / desktop renderer）
    index: 'src/index.ts',
    // Node 宿主入口（Electron 主进程 / Agent）
    node: 'src/node.ts',
    contract: 'src/contract.ts',
    capabilities: 'src/capabilities.ts',
  },
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
  treeshake: true,
  splitting: false,
  target: 'node22',
  // zod 是纯 JS，可安全打包进 Agent 单文件产物；
  // 但 desktop 走 node_modules，因此这里保持 external，由宿主决定。
  external: ['zod'],
})
