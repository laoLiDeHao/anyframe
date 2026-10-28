import { createServer, type Server } from 'node:http'
// verbatimModuleSyntax 打开时，纯类型必须用 type-only import，
// 否则 tsup 会把 AddressInfo 当成值保留下来，产物里出现一个
// require('node:net').AddressInfo —— 运行时 undefined，类型却是过的。
import type { AddressInfo } from 'node:net'
import {
  ErrCode,
  PROTOCOL_VERSION,
  parseInput,
  type MethodArgs,
  type MethodName,
  type MethodOutput,
  type RpcError,
} from '../contract.ts'

/**
 * ─────────────────────────────────────────────────────────────
 * 极简 RPC over HTTP 服务端（零第三方依赖）
 * ─────────────────────────────────────────────────────────────
 * 被两个宿主复用：
 *   - Electron 主进程（apps/desktop）
 *   - 本地 Agent 独立可执行程序（apps/agent）
 *
 * 故意不引入 Fastify/Hono：构建配置阶段依赖越少越好，
 * 且这里只需 POST /rpc/:method 一条路由。后续要换框架，
 * 只要保持 URL 与信封格式不变，前端零改动。
 */

export interface RpcHandlerCtx {
  method: MethodName
  /** 请求来源，用于日志与访问控制 */
  origin: string | null
}

/**
 * 方法表推导出的 handler 映射。
 *
 * 用 mapped type 而不是 `(input: never) => unknown`：
 * 后者会让宿主实现里到处写 `input as never as { id: string }`，
 * 类型安全等于零，改契约时编译器也不会报错。
 * 现在 handler 的入参是「parse 之后」的类型（默认值已补齐），
 * 返回值被约束为对应方法的 out schema，写错立刻红线。
 */
export type RpcHandlerMap = {
  [M in MethodName]?: (
    input: MethodArgs<M>,
    ctx: RpcHandlerCtx,
  ) => MethodOutput<M> | Promise<MethodOutput<M>>
}

export interface RpcServerOptions {
  /** 绑定地址。默认 127.0.0.1；0.0.0.0 会触发 Windows 防火墙弹窗 */
  host?: string
  /** 0 表示自动挑选空闲端口 */
  port?: number
  handlers: RpcHandlerMap
  /**
   * 允许跨域的来源。Web 版必须精确列出你的站点域名，
   * 不要用 '*' —— Agent 有本地文件与服务控制权，通配等于开后门。
   */
  allowedOrigins?: string[]
  /** 共享令牌。Agent 模式下必填，防止本机其他网页调用 */
  token?: string
  logger?: (level: 'info' | 'warn' | 'error', msg: string, meta?: unknown) => void
}

export interface RpcServerHandle {
  readonly url: string
  readonly host: string
  readonly port: number
  readonly token: string | undefined
  close(): Promise<void>
}

function ok(data: unknown) {
  return { ok: true, v: PROTOCOL_VERSION, data: data ?? null }
}

function fail(error: RpcError) {
  return { ok: false, v: PROTOCOL_VERSION, error }
}

/**
 * ErrCode → HTTP 状态码。
 *
 * 为什么不能像最初那样一律回 500：
 *   - 监控按 5xx 算错误率。「网页请求了一个越界路径」是完全正常的拒绝，
 *     全部记成 500 会让错误率长期虚高，真出故障时反而看不出来。
 *   - 浏览器 / Service Worker 对 5xx 有重试与降级逻辑，4xx 才表示
 *     「这个请求本身不对，别重试」。一律 500 会诱发无意义的重试风暴。
 *   - 排障时 curl -i 一眼就能区分是「我请求错了」还是「宿主崩了」。
 *
 * ⚠️ 只有出现在这张表里的 code 才会被原样返回。
 * Node 自己抛的 ENOENT / EACCES / ERR_INVALID_ARG_TYPE 等不在其中，
 * 会被归一成 INTERNAL —— 否则宿主内部的错误码会原样透到前端，
 * 而前端的 RpcCallError.isPermissionDenied 之类判断根本认不出来。
 */
const HTTP_STATUS: Record<string, number> = {
  [ErrCode.VALIDATION]: 400,
  [ErrCode.PERMISSION_DENIED]: 403,
  [ErrCode.NOT_FOUND]: 404,
  [ErrCode.ALREADY_EXISTS]: 409,
  // 启动本地服务失败（端口被占、二进制不存在…）属于宿主侧故障，用 5xx
  [ErrCode.SERVICE_FAILED]: 500,
  [ErrCode.INTERNAL]: 500,
  [ErrCode.UNSUPPORTED]: 501,
  [ErrCode.TIMEOUT]: 504,
}

/** 4xx 是调用方的问题，不值得用 error 级别刷日志 */
const SERVER_FAULT = new Set<string>([ErrCode.INTERNAL, ErrCode.SERVICE_FAILED])

export async function startRpcServer(
  opts: RpcServerOptions,
): Promise<RpcServerHandle> {
  const host = opts.host ?? '127.0.0.1'
  const log = opts.logger ?? (() => {})
  const allowedOrigins = new Set(opts.allowedOrigins ?? [])

  const server: Server = createServer(async (req, res) => {
    const origin = req.headers.origin ?? null

    // ── CORS 预检 ──────────────────────────────────────────
    // 关键：Private Network Access。HTTPS 页面访问 http://127.0.0.1
    // 时，Chrome 会先发带 Access-Control-Request-Private-Network 的
    // 预检，服务端必须回 Access-Control-Allow-Private-Network: true，
    // 否则请求被直接拦截。这是 Web 版最常卡住的地方。
    const isPrivateNetworkRequest =
      req.headers['access-control-request-private-network'] === 'true'

    const corsHeaders: Record<string, string> = {}
    if (origin && (allowedOrigins.has(origin) || allowedOrigins.has('*'))) {
      corsHeaders['Access-Control-Allow-Origin'] = origin
      corsHeaders['Vary'] = 'Origin'
      corsHeaders['Access-Control-Allow-Methods'] = 'POST, GET, OPTIONS'
      corsHeaders['Access-Control-Allow-Headers'] = 'Content-Type, X-AnyFrame-Token'
      corsHeaders['Access-Control-Max-Age'] = '86400'
      if (isPrivateNetworkRequest) {
        corsHeaders['Access-Control-Allow-Private-Network'] = 'true'
      }
    }

    const send = (status: number, body: unknown) => {
      const payload = JSON.stringify(body)
      res.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': Buffer.byteLength(payload),
        // Agent 常驻本机，禁止任何缓存
        'Cache-Control': 'no-store',
        ...corsHeaders,
      })
      res.end(payload)
    }

    if (req.method === 'OPTIONS') {
      send(204, '')
      return
    }

    // ── Host 头校验（DNS rebinding 防护）────────────────────
    // 攻击者可将自己的域名解析到 127.0.0.1，绕过同源策略访问本地服务。
    // 此时 Origin 会是攻击者域名（已被下面的来源白名单挡住），
    // 但 Host 头一定是攻击者域名 —— 双重校验，缺一不可。
    const hostHeader = (req.headers.host ?? '').replace(/:\d+$/, '')
    const hostAllowed =
      hostHeader === '' ||
      hostHeader === '127.0.0.1' ||
      hostHeader === 'localhost' ||
      hostHeader === '[::1]'
    if (!hostAllowed) {
      log('warn', `拒绝非法 Host 头: ${hostHeader}`)
      send(421, fail({ code: ErrCode.PERMISSION_DENIED, message: 'Host 头不被接受' }))
      return
    }

    // ── 健康检查（无需鉴权，供前端探测 Agent 是否在线）──────
    if (req.method === 'GET' && req.url === '/healthz') {
      send(200, ok({ alive: true, v: PROTOCOL_VERSION }))
      return
    }

    // ── 鉴权 ───────────────────────────────────────────────
    if (opts.token) {
      const got = req.headers['x-anyframe-token']
      if (got !== opts.token) {
        send(401, fail({ code: ErrCode.PERMISSION_DENIED, message: '令牌无效' }))
        return
      }
    }
    if (origin && !allowedOrigins.has(origin) && !allowedOrigins.has('*')) {
      send(403, fail({ code: ErrCode.PERMISSION_DENIED, message: '来源未被允许' }))
      return
    }

    // ── 路由：POST /rpc/<method> ───────────────────────────
    const match = /^\/rpc\/([a-z]+\.[a-zA-Z]+)$/.exec(req.url ?? '')
    if (req.method !== 'POST' || !match) {
      send(404, fail({ code: ErrCode.NOT_FOUND, message: '未知路由' }))
      return
    }

    const method = match[1] as MethodName
    const handler = opts.handlers[method]
    if (!handler) {
      send(
        501,
        fail({ code: ErrCode.UNSUPPORTED, message: `${method} 未实现` }),
      )
      return
    }

    // 限制请求体大小，防止内存打爆（文件写入应走分片）
    const chunks: Buffer[] = []
    let size = 0
    const MAX_BODY = 32 * 1024 * 1024
    for await (const chunk of req) {
      size += chunk.length
      if (size > MAX_BODY) {
        send(
          413,
          fail({ code: ErrCode.VALIDATION, message: '请求体超过 32MB 上限' }),
        )
        req.destroy()
        return
      }
      chunks.push(chunk as Buffer)
    }

    let raw: unknown
    try {
      const text = Buffer.concat(chunks).toString('utf8')
      raw = text ? JSON.parse(text) : undefined
    } catch {
      send(400, fail({ code: ErrCode.VALIDATION, message: 'JSON 解析失败' }))
      return
    }

    const parsed = parseInput(method, raw)
    if (!parsed.ok) {
      send(400, fail(parsed.error))
      return
    }

    try {
      // 这里做一次宽化断言：opts.handlers[method] 的静态类型是所有方法
      // handler 的联合，直接调用 TS 会要求入参是各方法入参的交集。
      // 入参已由上面的 parseInput 按同一张方法表校验过，运行时是安全的。
      const invoke = handler as (
        input: unknown,
        ctx: RpcHandlerCtx,
      ) => unknown | Promise<unknown>
      const data = await invoke(parsed.data, { method, origin })
      send(200, ok(data))
    } catch (err) {
      const e = err as { code?: string; message?: string }
      // 不在白名单里的 code（Node 的 ENOENT 之类）一律归一成 INTERNAL
      const code =
        typeof e?.code === 'string' && e.code in HTTP_STATUS ? e.code : ErrCode.INTERNAL
      log(
        SERVER_FAULT.has(code) ? 'error' : 'warn',
        `${method} 执行失败`,
        err,
      )
      send(
        HTTP_STATUS[code] ?? 500,
        fail({
          code,
          message: e?.message ?? '内部错误',
        }),
      )
    }
  })

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(opts.port ?? 0, host, () => {
      server.removeListener('error', reject)
      resolve()
    })
  })

  const addr = server.address() as AddressInfo
  const url = `http://${host === '0.0.0.0' ? '127.0.0.1' : host}:${addr.port}`
  log('info', `RPC 服务已启动: ${url}`)

  return {
    url,
    host,
    port: addr.port,
    token: opts.token,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections?.()
        server.close(() => resolve())
      }),
  }
}
