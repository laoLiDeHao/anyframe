import { Capacitor, registerPlugin } from '@capacitor/core'
import { ANDROID, IOS, RpcClient } from '@anyframe/core'
import type { HostSession } from './types'

/**
 * 移动端（Capacitor）适配器。
 *
 * 与 web.ts / electron.ts 是同一层角色，但探测逻辑完全不同：
 *   Web      —— 去 47730~47733 找用户装的 Agent（可能没有 → 降级）
 *   Electron —— preload 桥直接给出 endpoint
 *   移动     —— 在自己进程里起一个内嵌服务（一定能起，但能力受限）
 *
 * 三者最终都产出一个 RpcClient + HostSession，UI 层因此完全一致。
 * 这就是「本地服务是一份 HTTP 契约，而不是一个进程」的收益。
 */

// ── 原生插件绑定 ────────────────────────────────────────────
// 协议与 apps/mobile/src/native/local-service.ts 完全一致
// （同一个原生插件 AnyFrameLocalService，同一份 RPC 契约）。

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
  /** 引导用户关闭电池优化（国产 ROM 保活的唯一有效手段）；iOS 返回 supported: false */
  requestBatteryExemption(): Promise<{ granted: boolean; supported: boolean }>
}

/**
 * 与 apps/mobile/src/native/local-service.ts 注册的是同一个原生插件名。
 * Capacitor 对重复注册的处理是：console.warn 一次并返回首次注册的 proxy
 * （见 @capacitor/core dist/index.js registerPlugin）—— 行为无冲突，
 * 但两处 js 实现的 web 降级以先加载的模块为准。apps/mobile 若改用
 * @anyframe/ui 的宿主引导，应删掉自己那份注册以消除告警。
 */
export const LocalService = registerPlugin<LocalServicePlugin>('AnyFrameLocalService', {
  /**
   * 浏览器降级实现。移动端正常不会走到这里，
   * 但宿主判定失误或直接 import 本模块时不至于抛
   * "not implemented on web" 的红色异常。
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

export function mobilePlatform(): 'android' | 'ios' | 'web' {
  const p = Capacitor.getPlatform()
  return p === 'android' || p === 'ios' ? p : 'web'
}

/** 内嵌服务的起始端口。桌面 ServiceManager 用 47800，Agent 用 47900，这里用 47810。 */
export const MOBILE_SERVICE_PORT_START = 47810

/**
 * 启动本地服务的完整流程，把 Android 13 / 14 / 15 的三道门槛按顺序过一遍。
 *
 * 这个封装存在的意义：直接调 LocalService.start()，
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

// ── 宿主引导 ────────────────────────────────────────────────

export async function bootstrapMobile(): Promise<HostSession> {
  const platform = mobilePlatform()

  // index.ts 的 bootstrapHost() 只在 isNativePlatform() 为真时走到这里，
  // 但本模块可能被直接调用（如单测），web 平台给一份安全降级。
  if (platform === 'web') {
    return {
      kind: 'web-degraded',
      caps: { ...IOS, host: 'browser', platform: 'web', service: 'none', background: 'none', fileSystem: 'none' },
      client: null,
      url: null,
      warnings: ['当前在浏览器中预览，原生能力不可用。请用真机或模拟器运行。'],
      web: { missing: ['原生容器（当前运行在浏览器中）'] },
    }
  }

  // arch / version 只填静态基线值。真实值由原生侧 capabilities.get 上报，
  // 前端不额外引 @capacitor/device —— 多一个原生插件就多一份
  // cap sync 与 ProGuard 配置的维护成本，而这两个字段只用于日志。
  const baseline = platform === 'android' ? ANDROID : IOS
  const { status, warnings } = await ensureLocalService(MOBILE_SERVICE_PORT_START)
  const session = {
    platform,
    foreground: status.foreground,
    container: Capacitor.getPlatform(),
  }

  if (!status.running || !status.url) {
    return {
      kind: platform,
      caps: baseline,
      client: null,
      url: null,
      warnings,
      mobile: { foreground: session.foreground, container: session.container },
    }
  }

  // 移动端内嵌服务不启用 token：它只监听 127.0.0.1，
  // 且同一个 App 沙箱内没有其他进程能连（iOS 完全隔离，
  // Android 上其他 App 访问本机回环端口需要同一 UID 或 root）。
  // 若 App 允许 WebView 加载远端页面，必须改成带 token。
  const client = new RpcClient({ baseUrl: status.url, timeoutMs: 15_000 })

  if (!(await client.ping(3000))) {
    warnings.push(`内嵌服务已监听 ${status.url}，但健康检查未通过。`)
    return {
      kind: platform,
      caps: baseline,
      client: null,
      url: status.url,
      warnings,
      mobile: { foreground: session.foreground, container: session.container },
    }
  }

  // 以服务端上报的能力为准（原生侧可能因权限被拒而降级），
  // 拿不到就退回静态基线。
  const remote = await client.capabilities().catch(() => null)

  return {
    kind: platform,
    caps: remote ?? baseline,
    client,
    url: status.url,
    warnings,
    mobile: { foreground: session.foreground, container: session.container },
  }
}
