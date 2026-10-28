import {
  ErrCode,
  PROTOCOL_VERSION,
  type Capabilities,
  type MethodInput,
  type MethodName,
  type MethodOutput,
  type RpcError,
} from '../contract.ts'

/**
 * 前端唯一入口。
 * 无论宿主是 Electron、Web Agent 还是 Capacitor，UI 都只跟这个类说话。
 */

export class RpcCallError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message)
    this.name = 'RpcCallError'
  }
  /** 平台不支持 —— UI 应展示 reason() 文案而不是报错 */
  get isUnsupported(): boolean {
    return this.code === ErrCode.UNSUPPORTED
  }
  get isPermissionDenied(): boolean {
    return this.code === ErrCode.PERMISSION_DENIED
  }
}

export interface RpcClientOptions {
  baseUrl: string
  token?: string
  /** 单次调用超时，默认 30s；服务启动类操作建议单独传更长值 */
  timeoutMs?: number
  fetchImpl?: typeof fetch
}

export class RpcClient {
  private readonly baseUrl: string
  private readonly token: string | undefined
  private readonly timeoutMs: number
  private readonly fetchImpl: typeof fetch

  constructor(opts: RpcClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/$/, '')
    this.token = opts.token
    this.timeoutMs = opts.timeoutMs ?? 30_000
    this.fetchImpl = opts.fetchImpl ?? globalThis.fetch.bind(globalThis)
  }

  async call<M extends MethodName>(
    method: M,
    input?: MethodInput<M>,
    opts?: { timeoutMs?: number },
  ): Promise<MethodOutput<M>> {
    const ctrl = new AbortController()
    const timer = setTimeout(
      () => ctrl.abort(),
      opts?.timeoutMs ?? this.timeoutMs,
    )

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    }
    if (this.token) headers['X-AnyFrame-Token'] = this.token

    try {
      const res = await this.fetchImpl(`${this.baseUrl}/rpc/${method}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(input ?? null),
        signal: ctrl.signal,
      })

      const body = (await res.json()) as
        | { ok: true; v: string; data: MethodOutput<M> }
        | ({ ok: false; v: string; error: RpcError } & Record<string, unknown>)

      if (!body.ok) {
        throw new RpcCallError(body.error.code, body.error.message, body.error.details)
      }
      if (body.v !== PROTOCOL_VERSION) {
        throw new RpcCallError(
          ErrCode.VALIDATION,
          `协议版本不匹配：服务端 ${body.v}，客户端 ${PROTOCOL_VERSION}。请升级本地助手。`,
        )
      }
      return body.data
    } catch (err) {
      if (err instanceof RpcCallError) throw err
      if ((err as Error).name === 'AbortError') {
        throw new RpcCallError(ErrCode.TIMEOUT, `${method} 调用超时`)
      }
      throw new RpcCallError(
        ErrCode.INTERNAL,
        `无法连接本地服务：${(err as Error).message}`,
      )
    } finally {
      clearTimeout(timer)
    }
  }

  /** 探测宿主是否在线。Web 版启动时先调这个，决定展示哪种 UI。 */
  async ping(timeoutMs = 1500): Promise<boolean> {
    try {
      const ctrl = new AbortController()
      const timer = setTimeout(() => ctrl.abort(), timeoutMs)
      const res = await this.fetchImpl(`${this.baseUrl}/healthz`, {
        signal: ctrl.signal,
      })
      clearTimeout(timer)
      return res.ok
    } catch {
      return false
    }
  }

  async capabilities(): Promise<Capabilities> {
    return this.call('capabilities.get')
  }
}

/**
 * Web 版 Agent 自动发现。
 * 依次探测常见端口，命中即返回可用的 client。
 * 注意：HTTPS 页面访问 http://127.0.0.1 是被允许的
 * （127.0.0.1 属于 potentially trustworthy origin），
 * 但必须处理好 PNA 预检，见 runtime/server.ts。
 */
export async function discoverAgent(
  // 四个端口，与 apps/web/src/agent-bootstrap.ts 的 AGENT_PORTS 保持一致。
  // 为什么是四个而不是一个：Agent 默认监听 47730，被占用时向后顺延，
  // 用户同时开两个 Agent（或 47730 被别的程序占了）就会落到 47731+。
  // 少探一个端口会表现为「Agent 明明在跑，网页却说找不到」，很难排查。
  ports = [47730, 47731, 47732, 47733],
  token?: string,
): Promise<RpcClient | null> {
  for (const port of ports) {
    const client = new RpcClient({
      baseUrl: `http://127.0.0.1:${port}`,
      ...(token ? { token } : {}),
    })
    if (await client.ping()) return client
  }
  return null
}
