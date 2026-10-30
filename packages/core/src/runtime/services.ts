import { spawn, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { createServer } from 'node:net'
import type { ServiceInfo, ServiceLogLine, ServiceStartInput } from '../contract.ts'

/**
 * ─────────────────────────────────────────────────────────────
 * 本地服务管理器（Node 宿主专用：Electron 主进程 / Agent）
 * ─────────────────────────────────────────────────────────────
 * Android / iOS 不复用本文件 —— 移动端由原生插件实现「内嵌服务」
 * （Ktor / Swifter），只共享 contract.ts 的 schema 与错误码。
 */

/** 进程内嵌服务的启动函数签名（Electron 主进程内直接起 HTTP 服务时用） */
export type EmbeddedFactory = (opts: {
  host: string
  port: number
  serviceId: string
  log: (text: string) => void
}) => Promise<EmbeddedHandle>

export interface EmbeddedHandle {
  port: number
  urls?: string[]
  close(): Promise<void>
}

interface Managed {
  info: ServiceInfo
  child?: ChildProcess
  embedded?: EmbeddedHandle
  closing?: Promise<void>
  logs: ServiceLogLine[]
  stopping: boolean
  timer?: ReturnType<typeof setTimeout>
}

export interface ServiceManagerOptions {
  /** 端口分配起始值，避开常见开发端口 */
  portRangeStart?: number
  maxLogLines?: number
  logger?: (level: 'info' | 'warn' | 'error', msg: string, meta?: unknown) => void
  onExit?: (info: ServiceInfo, code: number | null) => void
}

/**
 * 在起始端口附近探测一个空闲端口。
 * 导出给 Agent / Electron 主进程复用 —— 两端必须用同一套探测逻辑，
 * 否则会出现「前端在 47730 找、后端却起在 47731」的错位。
 */
export async function findFreePort(start: number, span = 200): Promise<number> {
  for (let p = start; p < start + span; p++) {
    const free = await new Promise<boolean>((resolve) => {
      const srv = createServer()
      srv.once('error', () => resolve(false))
      srv.once('listening', () => srv.close(() => resolve(true)))
      srv.listen(p, '127.0.0.1')
    })
    if (free) return p
  }
  throw Object.assign(new Error(`在 ${start}~${start + span - 1} 内找不到空闲端口`), {
    code: 'SERVICE_FAILED',
  })
}

export class ServiceManager {
  private readonly services = new Map<string, Managed>()
  private readonly portStart: number
  private readonly maxLogLines: number
  private readonly log: NonNullable<ServiceManagerOptions['logger']>
  private readonly onExit?: ServiceManagerOptions['onExit']

  constructor(opts: ServiceManagerOptions = {}) {
    this.portStart = opts.portRangeStart ?? 47800
    this.maxLogLines = opts.maxLogLines ?? 2000
    this.log = opts.logger ?? (() => {})
    this.onExit = opts.onExit
  }

  list(): ServiceInfo[] {
    return [...this.services.values()].map((m) => m.info)
  }

  logs(id: string, tail: number): ServiceLogLine[] {
    return (this.services.get(id)?.logs ?? []).slice(-tail)
  }

  /**
   * 启动服务。入参必须已通过 contract 的 schema 校验。
   *
   * 两种模式：
   *   embedded —— 传入 factory，在当前 Node 进程内起服务（桌面端默认，最省事）
   *   spawned  —— 传入 input.command，拉起外部可执行程序（Python/Go/第三方 daemon）
   */
  async start(
    input: ServiceStartInput,
    factory?: EmbeddedFactory,
  ): Promise<ServiceInfo> {
    const port = input.port ?? (await findFreePort(this.portStart))
    const host = input.host ?? '127.0.0.1'
    const id = randomUUID()

    const base: ServiceInfo = {
      id,
      name: input.name,
      status: 'starting',
      mode: factory ? 'embedded' : 'spawned',
      host,
      port,
      startedAt: Date.now(),
      restartCount: 0,
    }

    const managed: Managed = { info: base, logs: [], stopping: false }
    this.services.set(id, managed)

    const push = (stream: ServiceLogLine['stream'], text: string) => {
      managed.logs.push({ ts: Date.now(), stream, text })
      if (managed.logs.length > this.maxLogLines) {
        managed.logs.splice(0, managed.logs.length - this.maxLogLines)
      }
    }

    // ── 内嵌模式 ────────────────────────────────────────────
    if (factory) {
      try {
        const handle = await factory({ host, port, serviceId: id, log: (text) => push('system', text) })
        managed.embedded = handle
        managed.info = { ...base, status: 'running', port: handle.port, urls: handle.urls }
        push('system', `内嵌服务已启动 ${host}:${handle.port}`)
        return managed.info
      } catch (err) {
        managed.info = { ...base, status: 'crashed' }
        push('system', `内嵌服务启动失败: ${(err as Error).message}`)
        throw Object.assign(err as Error, { code: 'SERVICE_FAILED' })
      }
    }

    // ── 外部进程模式 ────────────────────────────────────────
    if (!input.command) {
      managed.info = { ...base, status: 'crashed' }
      throw Object.assign(
        new Error('service.start 需要提供 command，或传入内嵌服务工厂'),
        { code: 'VALIDATION' },
      )
    }

    const command = input.command
    const args = input.args ?? []
    const restart = input.restart ?? { enabled: true, maxRestarts: 5, backoffMs: 1000 }

    const launch = (): void => {
      push('system', `spawn: ${command} ${args.join(' ')}`)
      const child = spawn(command, args, {
        cwd: input.cwd,
        env: {
          ...process.env,
          ...(input.env ?? {}),
          ANYFRAME_SERVICE_ID: id,
          ANYFRAME_PORT: String(port),
          ANYFRAME_HOST: host,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
        // 不走 shell，避免参数注入；需要 shell 语义时由调用方自行拼好参数
        shell: false,
        windowsHide: true,
      })

      managed.child = child
      managed.info = { ...managed.info, pid: child.pid, status: 'running' }

      child.stdout?.setEncoding('utf8')
      child.stderr?.setEncoding('utf8')
      child.stdout?.on('data', (d: string) =>
        d.split('\n').filter(Boolean).forEach((l) => push('stdout', l)),
      )
      child.stderr?.on('data', (d: string) =>
        d.split('\n').filter(Boolean).forEach((l) => push('stderr', l)),
      )

      child.on('error', (err) => {
        push('system', `进程错误: ${err.message}`)
        managed.info = { ...managed.info, status: 'crashed' }
      })

      child.on('exit', (code, signal) => {
        push('system', `进程退出 code=${code} signal=${signal}`)
        const canRestart =
          !managed.stopping &&
          restart.enabled &&
          managed.info.restartCount < restart.maxRestarts &&
          code !== 0

        if (canRestart) {
          const delay = restart.backoffMs * 2 ** managed.info.restartCount
          managed.info = {
            ...managed.info,
            status: 'starting',
            restartCount: managed.info.restartCount + 1,
          }
          push('system', `${delay}ms 后进行第 ${managed.info.restartCount} 次重启`)
          managed.timer = setTimeout(launch, delay)
        } else {
          managed.info = { ...managed.info, status: 'stopped', pid: undefined }
        }
        this.onExit?.(managed.info, code)
      })
    }

    launch()
    return managed.info
  }

  async stop(id: string, timeoutMs = 5000): Promise<ServiceInfo> {
    const m = this.services.get(id)
    if (!m) {
      throw Object.assign(new Error(`服务不存在: ${id}`), { code: 'NOT_FOUND' })
    }
    if (m.info.status === 'stopped') return m.info
    m.stopping = true
    if (m.timer) clearTimeout(m.timer)

    if (m.embedded) {
      m.info = { ...m.info, status: 'stopping' }
      m.closing ??= m.embedded.close()
      await m.closing
      m.info = { ...m.info, status: 'stopped' }
      return m.info
    }

    const child = m.child
    if (child && child.exitCode === null && !child.killed) {
      m.info = { ...m.info, status: 'stopping' }
      const pid = String(child.pid)

      // 优雅关闭：Windows 没有 SIGTERM，用不带 /F 的 taskkill 发送 WM_CLOSE
      if (process.platform === 'win32') {
        spawn('taskkill', ['/pid', pid, '/t'])
      } else {
        child.kill('SIGTERM')
      }

      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          this.log('warn', `${m.info.name} 优雅关闭超时，强制终止`)
          if (process.platform === 'win32') {
            spawn('taskkill', ['/pid', pid, '/t', '/f'])
          } else {
            child.kill('SIGKILL')
          }
          resolve()
        }, timeoutMs)
        child.once('exit', () => {
          clearTimeout(timer)
          resolve()
        })
      })
    }

    m.info = { ...m.info, status: 'stopped', pid: undefined }
    return m.info
  }

  /**
   * 应用退出前必须调用，否则会留下孤儿进程。
   * Electron 侧挂在 before-quit，Agent 侧挂在 SIGINT/SIGTERM。
   */
  async stopAll(timeoutMs = 5000): Promise<void> {
    await Promise.allSettled(
      [...this.services.keys()].map((id) => this.stop(id, timeoutMs)),
    )
  }
}
