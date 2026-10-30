import { defineConfig } from 'tsup'
import { readFileSync } from 'node:fs'

const version = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version as string

/**
 * Agent 打包为**单文件 CJS**。
 *
 * 必须 noExternal 把所有依赖（含 zod）内联进来 ——
 * Node SEA 只能嵌入一个 JS 文件，运行时不会去 node_modules 里找东西。
 */
export default defineConfig({
  entry: { agent: 'src/index.ts' },
  outDir: 'dist',
  format: ['cjs'],
  platform: 'node',
  target: 'node22',
  bundle: true,
  // 关键：内联 workspace 依赖与 zod，产出真正自包含的单文件。
  // 用 /^@anyframe\// 正则而不是字符串 '@anyframe/core' ——
  // Agent 实际 import 的是子路径 '@anyframe/core/node'，字符串精确匹配不到，
  // 会被 external 掉，SEA 产物运行时立刻 Cannot find module。
  // 也不用 /.*/ 通配：那会连带尝试打包 node: 内置模块，与下面的 external 冲突。
  noExternal: [/.*/],
  // Node 内置模块保持 external（SEA 运行时由宿主 Node 提供）
  external: [
    'node:http', 'node:net', 'node:fs', 'node:fs/promises', 'node:path',
    'node:os', 'node:crypto', 'node:child_process', 'node:url',
    'node:events', 'node:stream', 'node:util', 'node:zlib', 'node:tty',
    'electron',
  ],
  sourcemap: false,
  clean: true,
  dts: false,
  minify: false,           // 保留可读性，便于用户侧排障
  splitting: false,
  banner: {
    // shebang 只在这里注入一次。
    // ⚠️ src/index.ts 里**不能**再写一遍 —— esbuild 会保留源文件开头的
    // shebang，结果产物第 1、2 行都是 `#!/usr/bin/env node`，
    // Node 只剥离第 1 行，第 2 行报 SyntaxError，SEA 的 code cache 生成随之失败。
    js: '#!/usr/bin/env node',
  },
  define: {
    'process.env.ANYFRAME_BUILD_TARGET': '"agent"',
    // 版本号必须在构建时固化进产物。
    // SEA 单文件里没有 package.json 可读，发布出去的 exe 也不会带着
    // CI 的环境变量跑，所以 --help 和 capabilities.get 里的版本只能靠
    // esbuild 的文本替换。本地开发时读不到该环境变量，退回 package.json 的值。
    'process.env.ANYFRAME_AGENT_VERSION': JSON.stringify(
      process.env.ANYFRAME_AGENT_VERSION ?? version,
    ),
  },
})
