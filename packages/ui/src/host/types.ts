import type { Capabilities, RpcClient } from '@anyframe/core'

/**
 * ─────────────────────────────────────────────────────────────
 * 宿主会话：UI 与「平台」之间的唯一接口
 * ─────────────────────────────────────────────────────────────
 * 五端的差异全部收敛在这一个类型里。UI 层（ui/Shell.tsx）只读它，
 * 不关心自己跑在 Electron、WebView 还是浏览器标签页里。
 *
 * 能做到这一点的前提是：本地服务在五种形态下都是**同一份 HTTP 契约**
 * （POST /rpc/<method>、GET /healthz、X-AnyFrame-Token），
 * 换平台只是换 baseUrl 与取 token 的方式。
 */

export type HostKind =
  /** 桌面端：Electron 主进程内嵌服务，endpoint 由 preload 桥给出 */
  | 'electron'
  /** Android：App 进程内嵌服务 + 前台服务保活 */
  | 'android'
  /** iOS：App 进程内嵌服务，切后台数秒挂起 */
  | 'ios'
  /** Web + 本地助手：连用户机器上的 Agent */
  | 'web-agent'
  /** Web 无助手：仅浏览器沙箱能力，能力受限模式 */
  | 'web-degraded'

export interface HostSession {
  kind: HostKind
  /** 以服务端上报为准的能力表；拿不到时才用静态基线 */
  caps: Capabilities
  /** 未连通时为 null（降级模式 / 内嵌服务未就绪） */
  client: RpcClient | null
  /** 服务地址；无服务时为 null */
  url: string | null
  /** 需要逐条展示给用户的平台限制 / 待办事项 */
  warnings: string[]

  /** 仅 electron 有意义 */
  electron?: { version: string; isDev: boolean }
  /** 仅 android / ios 有意义 */
  mobile?: {
    /** Android 前台服务是否在跑；iOS 恒为 false */
    foreground: boolean
    /** Capacitor 容器标识，如 'android' / 'ios' */
    container: string
  }
  /** 仅 web-degraded 有意义：缺失能力的人类可读清单 */
  web?: { missing: string[] }
}

/** 功能开关清单。顺序即展示顺序。id 必须取自 core 的 FeatureId 联合。 */
export const FEATURES: { id: import('@anyframe/core').FeatureId; label: string }[] = [
  { id: 'spawnProcess', label: '启动外部程序' },
  { id: 'backgroundService', label: '后台常驻服务' },
  { id: 'arbitraryFileAccess', label: '任意路径读写' },
  { id: 'serialDevice', label: '串口设备' },
  { id: 'usbDevice', label: 'USB 设备' },
  { id: 'systemTray', label: '系统托盘' },
  { id: 'autoStart', label: '开机自启' },
]

export const HOST_LABEL: Record<HostKind, string> = {
  electron: '桌面端',
  android: 'Android',
  ios: 'iOS',
  'web-agent': 'Web · 本地助手',
  'web-degraded': 'Web · 能力受限',
}
