/**
 * ─────────────────────────────────────────────────────────────
 * @anyframe/core/node —— Node 宿主专用入口
 * ─────────────────────────────────────────────────────────────
 * 以下 Node 宿主与基础设施可以 import 它：
 *   1. apps/desktop/src/main/**      Electron 主进程
 *   2. apps/agent/src/**             本地助手（SEA / portable）
 *   3. 各包的测试与构建脚本
 *   4. apps/mobile/node/**          Android 内嵌 Node（独立于 WebView）
 *   5. packages/service-host/**    通用服务包管理与受限运行器
 *
 * 渲染进程、apps/web、apps/mobile 一律用 '@anyframe/core'。
 * preload 里也不行 —— preload 虽然有 Node 环境，但把它打进 renderer
 * 的依赖图会让 Vite 尝试解析 node:child_process。
 */

// 契约与能力矩阵在 Node 侧同样需要（server 要做 zod 校验、要返回 capabilities）
export * from './contract.ts'
export * from './capabilities.ts'

// 前端 SDK 也在 Node 侧导出：Agent 自己要作为 client 去探测别的实例
export {
  RpcClient,
  RpcCallError,
  discoverAgent,
  type RpcClientOptions,
} from './runtime/client.ts'

// ── Node 宿主运行时 ────────────────────────────────────────
export {
  startRpcServer,
  type RpcServerOptions,
  type RpcServerHandle,
  type RpcHandlerMap,
  type RpcHandlerCtx,
} from './runtime/server.ts'

export {
  ServiceManager,
  findFreePort,
  type ServiceManagerOptions,
  type EmbeddedFactory,
  type EmbeddedHandle,
} from './runtime/services.ts'

export {
  NodeFsProvider,
  type FsProvider,
  type FsProviderOptions,
} from './runtime/fs.ts'
