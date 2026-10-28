import { Capacitor } from '@capacitor/core'
import { ANDROID, IOS, RpcClient, type Capabilities } from '@anyframe/core'
import { ensureLocalService, mobilePlatform } from './native/local-service.ts'

/**
 * ─────────────────────────────────────────────────────────────
 * 移动端宿主引导
 * ─────────────────────────────────────────────────────────────
 * 与 apps/web 的 bootstrapWebHost() 是同一层角色，但探测逻辑完全不同：
 *   Web   —— 去 47730~47733 找用户装的 Agent（可能没有 → 降级）
 *   移动 —— 在自己进程里起一个内嵌服务（一定能起，但能力受限）
 *
 * 两者最终都产出一个 RpcClient，UI 层因此完全一致。
 * 这就是「本地服务是一份 HTTP 契约，而不是一个进程」的收益：
 * 换成移动端也只是换了个 baseUrl。
 */

export interface MobileHost {
  caps: Capabilities
  client: RpcClient | null
  /** 内嵌服务地址；未启动时为 null */
  url: string | null
  /** 前台服务是否在跑（仅 Android 有意义） */
  foreground: boolean
  /** 需要展示给用户的平台限制说明 */
  warnings: string[]
}

/** 内嵌服务的起始端口。桌面 ServiceManager 用 47800，Agent 用 47900，这里用 47810。 */
export const MOBILE_SERVICE_PORT_START = 47810

export async function bootstrapMobileHost(): Promise<MobileHost> {
  const platform = mobilePlatform()

  // 浏览器里跑 `pnpm dev` 时不是原生容器，直接给一份降级能力表，
  // 不去调插件（会抛 "not implemented"）。
  if (platform === 'web') {
    return {
      caps: {
        ...IOS,
        host: 'browser',
        platform: 'web',
        service: 'none',
        background: 'none',
        fileSystem: 'none',
      },
      client: null,
      url: null,
      foreground: false,
      warnings: ['当前在浏览器中预览，原生能力不可用。请用真机或模拟器运行。'],
    }
  }

  const baseline = platform === 'android' ? ANDROID : IOS

  // arch / version 这里只填静态基线值。真实的架构与系统版本由原生侧的
  // capabilities.get 上报（见 native/android 的 LocalHttpService），
  // 前端不额外引 @capacitor/device —— 多一个原生插件就多一份
  // cap sync 与 ProGuard 配置的维护成本，而这两个字段只用于日志。
  const caps: Capabilities = {
    ...baseline,
    version: Capacitor.getPlatform(),
  }

  const { status, warnings } = await ensureLocalService(MOBILE_SERVICE_PORT_START)

  if (!status.running || !status.url) {
    return { caps, client: null, url: null, foreground: false, warnings }
  }

  // 移动端内嵌服务不启用 token：它只监听 127.0.0.1，
  // 且同一个 App 沙箱内没有其他进程能连（iOS 完全隔离，
  // Android 上其他 App 访问本机回环端口需要同一 UID 或 root）。
  // 若你的 App 允许 WebView 加载远端页面，必须改成带 token。
  const client = new RpcClient({ baseUrl: status.url, timeoutMs: 15_000 })

  const alive = await client.ping(3000)
  if (!alive) {
    warnings.push(`内嵌服务已监听 ${status.url}，但健康检查未通过。`)
    return { caps, client: null, url: status.url, foreground: status.foreground, warnings }
  }

  // 以服务端上报的能力为准（原生侧可能因权限被拒而降级），
  // 拿不到就退回静态基线。
  const remote = await client.capabilities().catch(() => null)

  return {
    caps: remote ?? caps,
    client,
    url: status.url,
    foreground: status.foreground,
    warnings,
  }
}
