import { Capacitor } from '@capacitor/core'
import { bootstrapMobile } from './capacitor'
import { bootstrapElectron, detectElectron } from './electron'
import type { HostSession } from './types'
import { bootstrapWeb } from './web'

/**
 * ─────────────────────────────────────────────────────────────
 * 宿主探测：一份产物服务五端的唯一分叉点
 * ─────────────────────────────────────────────────────────────
 * 判定顺序是有讲究的：
 *
 *   1. window.anyframe      —— preload 在渲染前注入，存在即 Electron。
 *                              比查 UA 可靠：UA 可以被 --user-agent 改掉。
 *   2. Capacitor.isNativePlatform()
 *                           —— 原生桥注入的全局存在且平台为 android/ios。
 *                              桌面浏览器里 @capacitor/core 也能 import，
 *                              但 isNativePlatform() 恒为 false，不会误判。
 *   3. 其余                —— 普通浏览器标签页，走 Agent 探测 / 降级。
 *
 * 刻意不用构建期 define（如 __ANYFRAME_TARGET__）：那会让「五个端五份产物」，
 * 而这份 UI 的目标恰恰是**一次构建、处处运行**。运行时探测的代价是
 * 包里同时带着三种适配器（gzip 后几 KB），换来的是不可能装错端。
 */
export async function bootstrapHost(): Promise<HostSession> {
  const bridge = detectElectron()
  if (bridge) return bootstrapElectron(bridge)

  if (Capacitor.isNativePlatform()) return bootstrapMobile()

  return bootstrapWeb()
}
