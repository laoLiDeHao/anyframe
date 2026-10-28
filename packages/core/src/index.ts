/**
 * ─────────────────────────────────────────────────────────────
 * @anyframe/core —— 浏览器安全入口
 * ─────────────────────────────────────────────────────────────
 * 这个 barrel 里**不允许**出现任何依赖 node:* 内置模块的导出。
 * apps/web 与 apps/mobile 都会把它打进浏览器 bundle，
 * 一旦混进 node:http / node:fs，Vite 构建就会 externalize 掉，
 * 产物在运行时炸（症状：白屏 + "process is not defined"）。
 *
 * Electron 主进程 / Agent 这些 Node 宿主请改用 '@anyframe/core/node'，
 * 那里额外导出 startRpcServer / ServiceManager / NodeFsProvider。
 *
 * 这条边界由 packages/core/src/__tests__/browser-safety.test.ts 守护。
 */

// ── 契约（五端共享的唯一真相）──────────────────────────────
export * from './contract.ts'

// ── 能力矩阵与降级文案 ─────────────────────────────────────
export * from './capabilities.ts'

// ── 前端 SDK ───────────────────────────────────────────────
export {
  RpcClient,
  RpcCallError,
  discoverAgent,
  type RpcClientOptions,
} from './runtime/client.ts'
