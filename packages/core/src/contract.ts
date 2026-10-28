import { z } from 'zod'

/**
 * ─────────────────────────────────────────────────────────────
 * 五端唯一的 API 契约
 * ─────────────────────────────────────────────────────────────
 * 这是整个架构的「单一真相来源」。
 *
 * 四个宿主（Electron 主进程 / Web Agent / Android 原生 / iOS 原生）
 * 各自实现这些方法，但对外暴露的入参、出参、错误码完全一致。
 * UI 层只依赖这里，永远不出现 `if (isIOS)` 这类散落判断。
 *
 * 桌面端与 Web 端走 http://127.0.0.1:<port>/rpc/<method>，
 * 移动端走 Capacitor 插件桥接，但 schema 校验共用本文件。
 */

// ── 通用信封 ────────────────────────────────────────────────

export const RpcErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
  /** 可选的结构化上下文，便于前端做差异化提示 */
  details: z.record(z.string(), z.unknown()).optional(),
})

export type RpcError = z.infer<typeof RpcErrorSchema>

/** 统一错误码。宿主必须使用这些常量，不要自造字符串。 */
export const ErrCode = {
  /** 该平台不具备此能力（如 iOS 无法 spawn 进程） */
  UNSUPPORTED: 'UNSUPPORTED',
  /** 有权限模型限制（如 Android Scoped Storage 越界） */
  PERMISSION_DENIED: 'PERMISSION_DENIED',
  NOT_FOUND: 'NOT_FOUND',
  ALREADY_EXISTS: 'ALREADY_EXISTS',
  VALIDATION: 'VALIDATION',
  /** 本地服务启动失败 / 端口被占 */
  SERVICE_FAILED: 'SERVICE_FAILED',
  TIMEOUT: 'TIMEOUT',
  INTERNAL: 'INTERNAL',
} as const

export type ErrCodeValue = (typeof ErrCode)[keyof typeof ErrCode]

// ── 能力探测 ────────────────────────────────────────────────

export const CapabilitiesSchema = z.object({
  /** 宿主标识，用于埋点与问题定位 */
  host: z.enum(['electron', 'agent', 'capacitor', 'browser']),
  platform: z.enum(['win32', 'linux', 'darwin', 'android', 'ios', 'web']),
  arch: z.string(),
  version: z.string(),

  /**
   * 本地服务能力等级：
   *   full       —— 可 spawn 任意外部进程（Windows / Ubuntu 桌面）
   *   embedded   —— 仅能在 App 进程内起内嵌服务（Android / iOS）
   *   remote     —— 自身不能起服务，但能连本地 Agent（Web）
   *   none       —— 完全不可用
   */
  service: z.enum(['full', 'embedded', 'remote', 'none']),

  /**
   * 后台存活能力：
   *   persistent          —— 常驻（桌面）
   *   foreground-only     —— 前台服务保活，尽力而为（Android specialUse）
   *   foreground-transient—— 前台可用，切后台数分钟内挂起（iOS）
   *   none                —— 页面关了就没了（Web 无 Agent）
   */
  background: z.enum([
    'persistent',
    'foreground-only',
    'foreground-transient',
    'none',
  ]),

  /**
   * 文件系统能力等级：
   *   full     —— 任意路径读写（桌面）
   *   scoped   —— 用户授权目录（Web File System Access / Android SAF）
   *   sandbox  —— 仅 App 沙箱（iOS）
   *   none
   */
  fileSystem: z.enum(['full', 'scoped', 'sandbox', 'none']),

  /**
   * 可选硬件能力。整个 device 字段也是可选的 ——
   * 移动端在权限尚未授予时拿不到真实探测结果，
   * 此时应当省略而不是全部填 false（false 意味着「探测过了，没有」）。
   */
  device: z
    .object({
      serial: z.boolean(),
      usb: z.boolean(),
      hid: z.boolean(),
      ble: z.boolean(),
    })
    .partial()
    .optional(),
})

export type Capabilities = z.infer<typeof CapabilitiesSchema>

// ── 文件系统 ────────────────────────────────────────────────
//
// 命名约定（重要）：zod schema 一律带 Schema 后缀，
// 推导出的类型用干净的名字。
//
//     export const FsReadInputSchema = z.object({ ... })
//     export type  FsReadInput       = z.output<typeof FsReadInputSchema>
//
// 原因是 zod 的 input / output 在有 .default() 时**不一样**：
//   z.input  → { atomic?: boolean }   调用方传参用这个
//   z.output → { atomic: boolean }    宿主实现收到的是这个
// 宿主拿到的一定是 parse 之后的结果，默认值已补齐，
// 所以 FsProvider / ServiceManager 的签名必须用 z.output，
// 否则每个实现都要写 `input.atomic ?? true`，默认值等于白设。

export const FsReadInputSchema = z.object({
  path: z.string().min(1),
  encoding: z.enum(['utf8', 'base64', 'binary']).default('utf8'),
  /** 大文件分片读取，避免移动端内存炸 */
  offset: z.number().int().min(0).optional(),
  length: z.number().int().positive().optional(),
})
export type FsReadInput = z.output<typeof FsReadInputSchema>

export const FsReadOutputSchema = z.object({
  path: z.string(),
  data: z.string(),
  size: z.number().int(),
  truncated: z.boolean(),
})
export type FsReadOutput = z.output<typeof FsReadOutputSchema>

export const FsWriteInputSchema = z.object({
  path: z.string().min(1),
  data: z.string(),
  encoding: z.enum(['utf8', 'base64']).default('utf8'),
  /** 原子写：先写 .tmp 再 rename，避免服务被杀时留下半个文件 */
  atomic: z.boolean().default(true),
  createDirs: z.boolean().default(true),
})
export type FsWriteInput = z.output<typeof FsWriteInputSchema>

export const FsWriteOutputSchema = z.object({
  path: z.string(),
  bytesWritten: z.number().int(),
})
export type FsWriteOutput = z.output<typeof FsWriteOutputSchema>

export const FsListInputSchema = z.object({
  path: z.string().min(1),
  recursive: z.boolean().default(false),
})
export type FsListInput = z.output<typeof FsListInputSchema>

export const FsEntrySchema = z.object({
  name: z.string(),
  path: z.string(),
  isDir: z.boolean(),
  size: z.number().int(),
  mtime: z.number(),
})
export type FsEntry = z.output<typeof FsEntrySchema>

export const FsListOutputSchema = z.object({ entries: z.array(FsEntrySchema) })
export type FsListOutput = z.output<typeof FsListOutputSchema>

export const FsRemoveInputSchema = z.object({
  path: z.string().min(1),
  recursive: z.boolean().default(false),
})
export type FsRemoveInput = z.output<typeof FsRemoveInputSchema>

/**
 * 文件系统抽象。
 *
 * 放在契约层（而不是 runtime/fs.ts）是因为移动端也要实现它：
 *   - Electron 主进程 / Agent → NodeFsProvider（node:fs）
 *   - Capacitor              → CapacitorFsProvider（@capacitor/filesystem）
 * runtime/fs.ts 依赖 node:*，浏览器 bundle 不能碰，
 * 所以接口必须待在这个「纯类型 + zod」的文件里。
 *
 * 五端因此共用同一套 method 定义与同一套集成测试。
 */
export interface FsProvider {
  read(input: FsReadInput): Promise<FsReadOutput>
  write(input: FsWriteInput): Promise<FsWriteOutput>
  list(input: FsListInput): Promise<FsListOutput>
  remove(input: FsRemoveInput): Promise<void>
}

// ── 本地服务 ────────────────────────────────────────────────

export const ServiceStartInputSchema = z.object({
  /** 服务标识，用于日志与去重 */
  name: z.string().min(1).regex(/^[a-z0-9][a-z0-9-_]{0,63}$/, {
    message: 'name 只能包含小写字母、数字、连字符、下划线',
  }),
  /** 指定端口；缺省则由宿主挑选空闲端口 */
  port: z.number().int().min(1).max(65535).optional(),
  /** 绑定地址。仅桌面宿主允许 0.0.0.0（会触发 Windows 防火墙弹窗） */
  host: z.enum(['127.0.0.1', '0.0.0.0']).default('127.0.0.1'),
  /** 外部可执行文件路径（仅 service=full 的宿主有效） */
  command: z.string().optional(),
  args: z.array(z.string()).default([]),
  env: z.record(z.string(), z.string()).default({}),
  cwd: z.string().optional(),
  /** 崩溃自动重启 */
  restart: z
    .object({
      enabled: z.boolean().default(true),
      maxRestarts: z.number().int().min(0).default(5),
      backoffMs: z.number().int().min(500).default(1000),
    })
    .default({ enabled: true, maxRestarts: 5, backoffMs: 1000 }),
})
export type ServiceStartInput = z.output<typeof ServiceStartInputSchema>

export const ServiceInfoSchema = z.object({
  id: z.string(),
  name: z.string(),
  status: z.enum(['starting', 'running', 'stopping', 'stopped', 'crashed']),
  /** 运行模式：外部进程 or 进程内嵌 */
  mode: z.enum(['spawned', 'embedded']),
  pid: z.number().int().optional(),
  host: z.string(),
  port: z.number().int(),
  startedAt: z.number(),
  restartCount: z.number().int(),
})
export type ServiceInfo = z.output<typeof ServiceInfoSchema>

export const ServiceStopInputSchema = z.object({
  id: z.string(),
  /** 优雅关闭等待时长，超时后 SIGKILL / taskkill */
  timeoutMs: z.number().int().min(0).default(5000),
})
export type ServiceStopInput = z.output<typeof ServiceStopInputSchema>

export const ServiceLogsInputSchema = z.object({
  id: z.string(),
  tail: z.number().int().min(1).max(10000).default(500),
})
export type ServiceLogsInput = z.output<typeof ServiceLogsInputSchema>

export const ServiceLogLineSchema = z.object({
  ts: z.number(),
  stream: z.enum(['stdout', 'stderr', 'system']),
  text: z.string(),
})
export type ServiceLogLine = z.output<typeof ServiceLogLineSchema>

export const ServiceListOutputSchema = z.object({
  services: z.array(ServiceInfoSchema),
})
export type ServiceListOutput = z.output<typeof ServiceListOutputSchema>

export const ServiceLogsOutputSchema = z.object({
  lines: z.array(ServiceLogLineSchema),
})
export type ServiceLogsOutput = z.output<typeof ServiceLogsOutputSchema>

// ── 方法表 ──────────────────────────────────────────────────

/**
 * 所有 RPC 方法的入参/出参映射。
 * 宿主实现与前端调用都由这个表推导类型，改一处全端生效。
 */
export const methods = {
  'capabilities.get': { in: z.void(), out: CapabilitiesSchema },

  'fs.read': { in: FsReadInputSchema, out: FsReadOutputSchema },
  'fs.write': { in: FsWriteInputSchema, out: FsWriteOutputSchema },
  'fs.list': { in: FsListInputSchema, out: FsListOutputSchema },
  'fs.remove': { in: FsRemoveInputSchema, out: z.void() },

  'service.start': { in: ServiceStartInputSchema, out: ServiceInfoSchema },
  'service.stop': { in: ServiceStopInputSchema, out: ServiceInfoSchema },
  'service.list': { in: z.void(), out: ServiceListOutputSchema },
  'service.logs': { in: ServiceLogsInputSchema, out: ServiceLogsOutputSchema },
} as const

export type MethodName = keyof typeof methods

/** 调用方传参类型：带 .default() 的字段可省略 */
export type MethodInput<M extends MethodName> = z.input<(typeof methods)[M]['in']>

/** 宿主实现收到的类型：默认值已补齐，实现里不需要再写 ?? */
export type MethodArgs<M extends MethodName> = z.output<(typeof methods)[M]['in']>

export type MethodOutput<M extends MethodName> = z.output<(typeof methods)[M]['out']>

/** 运行时按方法名校验入参，宿主侧统一调用 */
export function parseInput<M extends MethodName>(
  method: M,
  raw: unknown,
): { ok: true; data: MethodArgs<M> } | { ok: false; error: RpcError } {
  const schema = methods[method]?.in as z.ZodType | undefined
  if (!schema) {
    return {
      ok: false,
      error: { code: ErrCode.VALIDATION, message: `未知方法: ${String(method)}` },
    }
  }
  const r = schema.safeParse(raw ?? undefined)
  if (!r.success) {
    return {
      ok: false,
      error: {
        code: ErrCode.VALIDATION,
        message: `${method} 入参校验失败`,
        details: { issues: r.error.issues },
      },
    }
  }
  // 断言是必要的：z.ZodType 擦掉了具体方法的信息，
  // 但 safeParse 成功后的 data 就是 MethodArgs<M>。
  return { ok: true, data: r.data as MethodArgs<M> }
}

/** 协议版本。前后端不一致时前端应提示升级 Agent。 */
export const PROTOCOL_VERSION = '1'
