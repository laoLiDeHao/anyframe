import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

/**
 * 单测 + 端到端测试的独立配置。
 *
 * 为什么不复用 vite.config.ts：那份配置给界面打包用，alias 是
 * 字符串形式（`'@anyframe/core': …/index.ts`），会把
 * `@anyframe/core/node` 也前缀匹配进去，拼出一个不存在的路径。
 * 端到端测试恰恰需要 `@anyframe/core/node`（NodeFsProvider / startRpcServer），
 * 所以这里用两条**正则** alias 精确区分，互不干扰。
 */
const r = (p: string) => fileURLToPath(new URL(p, import.meta.url))

export default defineConfig({
  resolve: {
    alias: [
      { find: /^@anyframe\/core$/, replacement: r('../core/src/index.ts') },
      { find: /^@anyframe\/core\/node$/, replacement: r('../core/src/node.ts') },
    ],
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
