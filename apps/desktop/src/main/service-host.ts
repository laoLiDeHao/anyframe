import { ProjectServiceHost } from '@anyframe/service-host'
import { app } from 'electron'
import { homedir } from 'node:os'
import { join } from 'node:path'
import {
  ErrCode,
  LINUX,
  NodeFsProvider,
  ServiceManager,
  WINDOWS,
  startRpcServer,
  type Capabilities,
  type RpcServerHandle,
} from '@anyframe/core/node'

/**
 * ─────────────────────────────────────────────────────────────
 * 桌面端服务宿主
 * ─────────────────────────────────────────────────────────────
 * 关键设计：桌面端也走 http://127.0.0.1:<port>/rpc/*，而不是 Electron IPC。
 *
 * 收益：
 *   1. 桌面版与 Web 版（连本地 Agent）走完全相同的代码路径，
 *      一套集成测试覆盖两端
 *   2. 本地服务顺带成为可被第三方程序调用的 API
 *   3. 未来做「手机连电脑上的服务」时架构已就位
 *
 * 代价：多一次 loopback HTTP 往返（实测 <1ms）。
 * 大文件传输或高频事件再单独开 IPC 快车道，UI 层无感知。
 */

export interface ServiceHost {
  handle: RpcServerHandle
  manager: ServiceManager
  capabilities: Capabilities
  shutdown(): Promise<void>
}

export async function createServiceHost(): Promise<ServiceHost> {
  const platform = process.platform
  const version = app.getVersion()

  // 平台能力基线来自 core，不在这里重复判断
  const capabilities: Capabilities = {
    ...(platform === 'win32' ? WINDOWS : LINUX),
    arch: process.arch,
    version,

  }

  // ── 文件系统 ────────────────────────────────────────────────
  // 桌面端默认放开到用户主目录。若产品需要访问任意路径，
  // 传空数组即不限制；但请注意这让任何拿到 token 的进程都能读写。
  const dataRoot = join(
    process.env.ANYFRAME_DATA_ROOT ?? homedir(),
  )
  const fsProvider = new NodeFsProvider({
    allowedRoots: process.env.ANYFRAME_FS_UNRESTRICTED === '1' ? [] : [dataRoot],
    maxReadBytes: 64 * 1024 * 1024,
  })

  // ── 服务管理器 ──────────────────────────────────────────────
  const manager = new ServiceManager({
    portRangeStart: 47800,
    logger: (level, msg, meta) => console[level](`[service] ${msg}`, meta ?? ''),
    onExit: (info, code) => {
      console.warn(`[service] ${info.name} 退出 code=${code}`)
    },
  })

  const projects = new ProjectServiceHost(manager, { dataRoot: app.getPath('userData'), builtinRoot: app.isPackaged ? join(process.resourcesPath, 'services') : join(app.getAppPath(), '../../services/builtin') })
  await projects.initialize()
  capabilities.serviceTemplates = (await projects.catalog()).packages.map(p => p.id)

  // ── RPC 服务端 ─────────────────────────────────────────────
  const handle = await startRpcServer({
    host: '127.0.0.1',
    port: Number(process.env.ANYFRAME_RPC_PORT ?? 0) || 0,
    // Agent 模式才需要 token；桌面端由 Electron 生命周期托管，
    // 但仍建议开启，防止本机其他网页探测到端口后调用。
    token: process.env.ANYFRAME_RPC_TOKEN,
    // 桌面端 renderer 走 file:// 或 localhost，Origin 可能为 null
    allowedOrigins: [
      'null',
      'http://localhost:5173',
      'file://',
    ],
    handlers: {
      'capabilities.get': () => capabilities,

      // handler 的入参类型由 core 的方法表推导，这里不需要任何断言。
      // 改契约（contract.ts）时，签名对不上会直接编译报错。
      'fs.read': (input) => fsProvider.read(input),
      'fs.write': (input) => fsProvider.write(input),
      'fs.list': (input) => fsProvider.list(input),
      'fs.remove': (input) => fsProvider.remove(input),

      'service.start': (input) => projects.start(input),
      'service.stop': (input) => manager.stop(input.id, input.timeoutMs),
      'service.list': () => ({ services: manager.list() }),
      'service.catalog': () => projects.catalog(),
      'service.import': i => projects.importArchive(i.name, i.archive),
      'service.logs': (input) => ({ lines: manager.logs(input.id, input.tail) }),
    },
  })

  console.info(`[host] RPC 服务就绪: ${handle.url}`)

  return {
    handle,
    manager,
    capabilities,
    async shutdown() {
      // 顺序很重要：先停子服务，再关 RPC，避免前端拿到半死不活的响应
      await manager.stopAll(5000)
      await handle.close()
    },
  }
}

/** 平台不支持时统一抛出的错误，前端据 code 展示 reason() 文案 */
export function unsupported(feature: string): Error {
  return Object.assign(new Error(`${feature} 在当前平台不可用`), {
    code: ErrCode.UNSUPPORTED,
  })
}
