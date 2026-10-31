import { existsSync } from 'node:fs'
import { ProjectServiceHost } from '@anyframe/service-host'
// ⚠️ 这里刻意**不写** `#!/usr/bin/env node`。
// shebang 由 tsup.config.ts 的 banner 统一注入。源码里再写一遍的话，
// 产物会变成「第 1 行 shebang + 第 2 行 shebang」—— Node 只剥离第 1 行，
// 第 2 行是非法 token，`node --experimental-sea-config` 直接报
// "SyntaxError: Invalid or unexpected token" + "Cannot generate V8 code cache"。
import { randomBytes } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, dirname, resolve } from 'node:path'
import {
  ErrCode,
  NodeFsProvider,
  ServiceManager,
  WEB_WITH_AGENT,
  startRpcServer,
  type Capabilities,
} from '@anyframe/core/node'

/**
 * ─────────────────────────────────────────────────────────────
 * AnyFrame 本地助手（Agent）
 * ─────────────────────────────────────────────────────────────
 * Web 版的能力代理。浏览器无法启动进程、无法任意读写文件，
 * 所以把这两件事交给这个常驻本机的程序。
 *
 * 安全模型（务必理解，别随手放宽）：
 *   1. 只绑 127.0.0.1 —— 局域网其他机器连不进来
 *   2. Origin 白名单 —— 挡住其他网页的跨站调用
 *   3. Host 头校验 —— 挡住 DNS rebinding（由 core 的 server 实现）
 *   4. 可选 token —— 纵深防御
 *   ⚠️ 注意：localhost 不是对抗「本机恶意程序」的边界。
 *      任何本地进程都能连上来。如果威胁模型包含这个，
 *      需要再加操作系统级的凭据（Windows DPAPI / keychain）。
 */

const VERSION = process.env.ANYFRAME_AGENT_VERSION ?? '0.1.0'

// ── 参数解析 ──────────────────────────────────────────────────
interface Args {
  port: number
  host: string
  token?: string
  origins: string[]
  dataRoot: string
  unrestricted: boolean
  printToken: boolean
}

function parseArgs(argv: string[]): Args {
  const get = (name: string): string | undefined => {
    const hit = argv.find((a) => a.startsWith(`--${name}=`))
    if (hit) return hit.slice(name.length + 3)
    const i = argv.indexOf(`--${name}`)
    return i >= 0 ? argv[i + 1] : undefined
  }
  const has = (name: string) => argv.includes(`--${name}`)

  // 默认允许的来源。生产部署时必须改成你的真实域名。
  const defaultOrigins = [
    'http://localhost:5174',   // 本地开发
    'http://localhost:4173',   // vite preview
    'https://app.anyframe.local',
  ]

  return {
    port: Number(get('port') ?? process.env.ANYFRAME_AGENT_PORT ?? 47730),
    host: get('host') ?? '127.0.0.1',
    token: get('token') ?? process.env.ANYFRAME_AGENT_TOKEN,
    origins: (get('allow-origin') ?? defaultOrigins.join(','))
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    dataRoot: get('data-root') ?? homedir(),
    unrestricted: has('unrestricted'),
    printToken: has('print-token'),
  }
}

function usage(): void {
  console.log(`
AnyFrame 本地助手 v${VERSION}

用法:
  anyframe-agent [选项]

选项:
  --port=<n>              监听端口（默认 47730；被占用时自动向后顺延）
  --host=<addr>           绑定地址（默认 127.0.0.1，**不要**改成 0.0.0.0
                          除非你清楚这意味着局域网内任何设备都能控制你的电脑）
  --token=<secret>        访问令牌；缺省时自动生成并写入状态文件
  --allow-origin=<list>   逗号分隔的来源白名单（默认包含本地开发地址）
  --data-root=<path>      允许读写的根目录（默认用户主目录）
  --unrestricted          不限制可访问路径（仅在完全可信环境下使用）
  --print-token           启动后在控制台打印令牌
  --help                  显示本帮助
`)
}

// ── 状态文件 ──────────────────────────────────────────────────
// 写到 ~/.anyframe/agent.json。浏览器读不到它，
// 但桌面版、CLI 工具、以及排障时的用户能看到。
async function writeStateFile(state: Record<string, unknown>): Promise<string> {
  const dir = join(homedir(), '.anyframe')
  await mkdir(dir, { recursive: true })
  const file = join(dir, 'agent.json')
  await writeFile(file, JSON.stringify({ ...state, writtenAt: Date.now() }, null, 2), 'utf8')
  return file
}

// ── 主流程 ────────────────────────────────────────────────────
async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  if (argv.includes('--help') || argv.includes('-h')) {
    usage()
    return
  }

  const args = parseArgs(argv)
  const token = args.token ?? randomBytes(24).toString('base64url')

  /**
   * process.platform 的取值比契约枚举宽（还有 aix / freebsd / openbsd /
   * sunos / netbsd / haiku / cygwin），直接赋值 TS 不过、zod 也会拒。
   * 三大平台原样保留，其余 UNIX-like 一律归到 linux ——
   * 它们的能力模型与 linux 一致（可 spawn、可用 init 系统、可任意读写）。
   *
   * 这里不判断 'ios'：Node 的 Platform 类型里没有它，
   * 写上去会报 TS2367「两个类型没有重叠」。iOS 上跑的是 Capacitor
   * 内嵌服务，根本不会有 Node Agent 进程。'android' 在类型里存在
   * （Termux 之类的场景），所以保留。
   */
  const p = process.platform
  const platform: Capabilities['platform'] =
    p === 'win32' || p === 'linux' || p === 'darwin' || p === 'android' ? p : 'linux'

  const capabilities: Capabilities = {
    ...WEB_WITH_AGENT,
    /**
     * 必须报真实宿主平台。
     * WEB_WITH_AGENT 里的 platform 是 'web' —— 那是**浏览器**的身份，
     * 而这里是 Agent 进程自己。照抄会让 UI 把「本地助手运行在 Windows 上」
     * 显示成「web」，用户报障时给出的平台信息就是错的。
     */
    platform,
    arch: process.arch,
    version: VERSION,
    // Agent 本身就是 Node，能 spawn 任意外部进程 —— 按契约的定义这就是 full
    // （remote 是「自身不能起服务，但能连本地 Agent」，说的是浏览器那一侧）
    service: 'full',
    /**
     * 受 --data-root 限制时如实报 scoped。
     * 原来这里写的是 `args.unrestricted ? 'full' : 'full'` —— 两个分支一样，
     * 等于恒定宣称能访问任意路径；而实际越界会被 NodeFsProvider 拒掉。
     * UI 据此画出「打开任意目录」的入口，用户一点就是 PERMISSION_DENIED，
     * 看起来像 bug，其实是能力上报撒谎。
     */
    fileSystem: args.unrestricted ? 'full' : 'scoped',
    /**
     * 硬件通道目前一个都没接：serial / usb / hid 需要原生绑定
     * （serialport、usb、node-hid），ble 需要 noble，全部尚未引入。
     * 这里必须如实报 false —— 报 true 的话 UI 会亮出「连接串口设备」按钮，
     * 用户点下去才发现不支持，比一开始就置灰糟糕得多。
     * 将来接入原生绑定后，按「模块是否成功加载」逐项打开，不要写死 true。
     *
     * 注意 WEB_WITH_AGENT 里的 device 描述的是**浏览器**的 Web Serial /
     * WebUSB / WebHID / Web Bluetooth 可用性，与 Agent 侧完全是两回事，
     * 不能继承过来。
     */
    device: { serial: false, usb: false, hid: false, ble: false },
  }

  const fsProvider = new NodeFsProvider({
    allowedRoots: args.unrestricted ? [] : [args.dataRoot],
    maxReadBytes: 64 * 1024 * 1024,
  })

  const manager = new ServiceManager({
    portRangeStart: 47900,
    logger: (level, msg) => console[level](`[agent:service] ${msg}`),
  })
  const projects = new ProjectServiceHost(manager, { dataRoot: join(args.dataRoot, '.anyframe'), builtinRoot: process.env.ANYFRAME_BUILTIN_ROOT ?? [join(dirname(resolve(process.argv[1] ?? process.execPath)), 'services'), join(dirname(process.execPath), 'services'), join(process.cwd(), 'services/builtin'), join(process.cwd(), '../../services/builtin')].find(path => existsSync(path)) ?? join(process.cwd(), 'services/builtin') })
  await projects.initialize()
  capabilities.serviceTemplates = (await projects.catalog()).packages.map(p => p.id)

  // 端口被占用时自动顺延，最多试 4 次。
  // 前端 discoverAgent 会扫 47730~47733，与此保持一致。
  let handle = null as Awaited<ReturnType<typeof startRpcServer>> | null
  for (let attempt = 0; attempt < 4 && !handle; attempt++) {
    try {
      handle = await startRpcServer({
        host: args.host,
        port: args.port + attempt,
        token,
        allowedOrigins: args.origins,
        handlers: {
          'capabilities.get': () => capabilities,
          // 入参类型由 core 方法表推导，无需断言
          'fs.read': (i) => fsProvider.read(i),
          'fs.write': (i) => fsProvider.write(i),
          'fs.list': (i) => fsProvider.list(i),
          'fs.remove': (i) => fsProvider.remove(i),
          'service.start': (i) => projects.start(i),
          'service.stop': (i) => manager.stop(i.id, i.timeoutMs),
          'service.list': () => ({ services: manager.list() }),
          'service.catalog': () => projects.catalog(),
          'service.import': i => projects.importArchive(i.name, i.archive),
          'service.logs': (i) => ({ lines: manager.logs(i.id, i.tail) }),
        },
      })
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code
      if (code === 'EADDRINUSE') {
        console.warn(`[agent] 端口 ${args.port + attempt} 被占用，尝试下一个`)
        continue
      }
      throw err
    }
  }

  if (!handle) {
    console.error(`[agent] ${args.port}~${args.port + 3} 全部被占用，退出`)
    process.exit(1)
  }

  const stateFile = await writeStateFile({
    version: VERSION,
    pid: process.pid,
    url: handle.url,
    port: handle.port,
    host: handle.host,
    token,
    allowedOrigins: args.origins,
    dataRoot: args.unrestricted ? '(unrestricted)' : args.dataRoot,
    node: process.version,
    platform: process.platform,
  })

  console.log(`[agent] AnyFrame 本地助手 v${VERSION} 已启动`)
  console.log(`[agent] 监听      : ${handle.url}`)
  console.log(`[agent] 状态文件  : ${stateFile}`)
  console.log(`[agent] 允许来源  : ${args.origins.join(', ')}`)
  console.log(`[agent] 可访问目录: ${args.unrestricted ? '(不限制)' : args.dataRoot}`)
  if (args.printToken) console.log(`[agent] 令牌      : ${token}`)

  // ── 优雅退出 ────────────────────────────────────────────────
  let shuttingDown = false
  const shutdown = async (signal: string) => {
    if (shuttingDown) return
    shuttingDown = true
    console.log(`[agent] 收到 ${signal}，正在停止所有本地服务…`)
    try {
      await manager.stopAll(5000)
      await handle?.close()
    } catch (err) {
      console.error('[agent] 关闭失败', err)
    } finally {
      process.exit(0)
    }
  }

  process.on('SIGINT', () => void shutdown('SIGINT'))
  process.on('SIGTERM', () => void shutdown('SIGTERM'))
  // Windows 下 Ctrl+C / 控制台关闭
  if (process.platform === 'win32') {
    const rl = await import('node:readline')
    rl.createInterface({ input: process.stdin, output: process.stdout })
      .on('SIGINT', () => void shutdown('SIGINT'))
  }

  process.on('uncaughtException', (err) => {
    const e = err as { code?: string }
    // Agent 是长驻程序，绝不能因为一个请求出错就整体退出
    if (e.code === ErrCode.INTERNAL) console.error('[agent] uncaughtException', err)
    else console.error('[agent] uncaughtException', err)
  })
  process.on('unhandledRejection', (r) => console.error('[agent] unhandledRejection', r))
}

main().catch((err) => {
  console.error('[agent] 启动失败', err)
  process.exit(1)
})
