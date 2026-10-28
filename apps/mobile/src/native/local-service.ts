import { Capacitor, registerPlugin } from '@capacitor/core'

/**
 * ─────────────────────────────────────────────────────────────
 * 移动端「本地服务」插件绑定
 * ─────────────────────────────────────────────────────────────
 * 移动端不能 spawn 外部程序（iOS 审核指南 2.5.2 明令禁止，
 * Android 10+ 对可执行文件有 W^X 限制），所以「启动本地服务」
 * 在移动端的语义收窄为：在 App 进程内起一个监听 127.0.0.1 的
 * 内嵌 HTTP 服务，并用前台服务把它尽量保住。
 *
 * 协议与桌面/Agent 完全一致（POST /rpc/<method>、/healthz、
 * X-AnyFrame-Token），所以 UI 层用的还是同一个 RpcClient，
 * 不需要为移动端写第二套调用代码。
 *
 * ── 为什么是 HTTP 而不是直接走 Capacitor 桥 ────────────────
 * 桥每次调用都要 JSON 过 JNI / WKScriptMessageHandler，
 * 高频场景（日志流、文件分片）开销明显；更重要的是走 HTTP 之后
 * 移动端与桌面端能共用同一套集成测试。
 *
 * ── 混合内容的疑问 ─────────────────────────────────────────
 * androidScheme: 'https' 让页面源是 https://localhost，而服务是
 * http://127.0.0.1 —— 看起来会被混合内容策略拦截，实际不会：
 * W3C Mixed Content 规范把回环地址归为 potentially trustworthy
 * origin，Chrome / Android WebView 都据此放行。这也是 Web 版能
 * 从 HTTPS 站点连本地 Agent 的原因。
 * iOS 侧不是混合内容问题而是 ATS 问题，需在 Info.plist 里开
 * NSAllowsLocalNetworking（见 native/ios/Info.plist.patch.xml）。
 */

export interface LocalServiceStatus {
  running: boolean
  /** 内嵌服务实际监听的端口；未启动时为 null */
  port: number | null
  /** 形如 http://127.0.0.1:47810，未启动时为 null */
  url: string | null
  /**
   * 是否处于「前台服务」状态。
   * Android：有常驻通知即为 true；被厂商 ROM 杀掉后为 false。
   * iOS：恒为 false —— 系统不提供等价机制，切后台数秒即挂起。
   */
  foreground: boolean
  platform: 'android' | 'ios' | 'web'
  /** 上次状态变更的原因，UI 可直接展示，不用自己再判断一遍 */
  reason?: string
}

export interface LocalServicePlugin {
  /**
   * 启动内嵌服务。
   * Android 上会同时拉起前台服务；Android 13+ 需要先拿到通知权限，
   * 否则 startForeground 抛 SecurityException，服务立即被杀。
   * 调用顺序必须是 requestNotificationPermission() → start()，
   * 用下面的 ensureLocalService() 就不用自己记这个顺序。
   */
  start(options?: { port?: number }): Promise<LocalServiceStatus>
  stop(): Promise<LocalServiceStatus>
  getStatus(): Promise<LocalServiceStatus>

  /** Android 13+ 的 POST_NOTIFICATIONS 运行时权限；iOS 直接返回 granted */
  requestNotificationPermission(): Promise<{ granted: boolean }>

  /**
   * 引导用户关闭电池优化。
   * 这是国产 ROM（小米/华为/OPPO/vivo）上唯一有效的保活手段 ——
   * 它们会无视 Android 官方的前台服务豁免直接杀进程。
   * iOS 无此概念，返回 supported: false。
   */
  requestBatteryExemption(): Promise<{ granted: boolean; supported: boolean }>
}

export const LocalService = registerPlugin<LocalServicePlugin>('AnyFrameLocalService', {
  /**
   * 浏览器降级实现。移动端正常不会走到这里，
   * 但 `pnpm dev` 直接在桌面浏览器里打开 Vite 时会；
   * 没有它就是一个 "not implemented on web" 的红色异常。
   */
  web: () =>
    Promise.resolve({
      start: async () => webUnsupported(),
      stop: async () => webUnsupported(),
      getStatus: async () => webUnsupported(),
      requestNotificationPermission: async () => ({ granted: false }),
      requestBatteryExemption: async () => ({ granted: false, supported: false }),
    } as LocalServicePlugin),
})

function webUnsupported(): LocalServiceStatus {
  return {
    running: false,
    port: null,
    url: null,
    foreground: false,
    platform: 'web',
    reason: '浏览器内无法启动本地服务，请使用桌面版或安装本地助手。',
  }
}

// ── 平台判定 ────────────────────────────────────────────────

export function isNative(): boolean {
  return Capacitor.isNativePlatform()
}

export function mobilePlatform(): 'android' | 'ios' | 'web' {
  const p = Capacitor.getPlatform()
  return p === 'android' || p === 'ios' ? p : 'web'
}

/**
 * 启动本地服务的完整流程，把 Android 13 / 14 / 15 的三道门槛按顺序过一遍。
 *
 * 这个封装存在的意义：直接在 UI 里调 LocalService.start()，
 * 在 Android 14 上会因缺 foregroundServiceType 静默失败，
 * 在 Android 13 上会因没通知权限被系统立刻杀掉，
 * 而两种失败的表象都是「服务起不来」，极难排查。
 */
export async function ensureLocalService(port?: number): Promise<{
  status: LocalServiceStatus
  /** 需要用户手动处理的事项，UI 应逐条展示 */
  warnings: string[]
}> {
  const warnings: string[] = []
  const platform = mobilePlatform()

  if (platform === 'android') {
    const notif = await LocalService.requestNotificationPermission().catch(() => ({
      granted: false,
    }))
    if (!notif.granted) {
      warnings.push(
        '未授予通知权限。Android 13 起前台服务必须能发通知，' +
          '否则服务会在启动后数秒内被系统终止。',
      )
    }

    const battery = await LocalService.requestBatteryExemption().catch(() => ({
      granted: false,
      supported: false,
    }))
    if (battery.supported && !battery.granted) {
      warnings.push(
        '未加入电池优化白名单。小米 / 华为 / OPPO / vivo 等厂商 ROM ' +
          '会无视 Android 的前台服务豁免直接杀进程，需在系统设置里手动关闭省电策略。',
      )
    }
  }

  if (platform === 'ios') {
    warnings.push(
      'iOS 不提供常驻后台机制：切到后台数秒后服务即被挂起，' +
        '回到前台自动恢复。需要 7×24 运行时请使用桌面版。',
    )
  }

  const status = await LocalService.start(port === undefined ? {} : { port })
  if (!status.running && status.reason) warnings.push(status.reason)

  return { status, warnings }
}
