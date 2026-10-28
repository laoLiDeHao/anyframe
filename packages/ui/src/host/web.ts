import {
  RpcClient,
  WEB_NO_AGENT,
  WEB_WITH_AGENT,
  discoverAgent,
  type Capabilities,
} from '@anyframe/core'
import type { HostSession } from './types'

/**
 * Web 适配器。
 *
 * 启动时按顺序探测：
 *   1. 显式指定的 Agent（?agent=http://127.0.0.1:47730&token=xxx）
 *   2. 常用端口上的 Agent
 *   3. 浏览器原生能力降级（能力受限模式）
 *
 * 探测结果决定 UI 形态，而不是让用户点了按钮才报错。
 */

/** Agent 的默认探测端口，需与 apps/agent/src/index.ts 保持一致 */
export const AGENT_PORTS = [47730, 47731, 47732, 47733]

function readQueryOverrides(): { url?: string; token?: string } {
  const p = new URLSearchParams(globalThis.location.search)
  return { url: p.get('agent') ?? undefined, token: p.get('token') ?? undefined }
}

/**
 * 浏览器原生能力的真实探测结果（不靠 UA 猜，直接看 API 是否存在）。
 *
 * 返回类型必须是 NonNullable<...>：契约里 device 是 `.partial().optional()`
 * （移动端权限未授予时整个字段省略），若直接写 `Capabilities['device']`，
 * 返回类型会带上 undefined，调用方每次读 device.serial 都要先判空。
 * 而浏览器探测一定有结果 —— 探测不到就是 false，不存在「未知」。
 */
function probeBrowserDevices(): NonNullable<Capabilities['device']> {
  const nav = globalThis.navigator as Navigator & {
    serial?: unknown
    usb?: unknown
    hid?: unknown
    bluetooth?: unknown
  }
  return {
    serial: 'serial' in nav && !!nav.serial,
    usb: 'usb' in nav && !!nav.usb,
    hid: 'hid' in nav && !!nav.hid,
    ble: 'bluetooth' in nav && !!nav.bluetooth,
  }
}

export async function bootstrapWeb(): Promise<HostSession> {
  const override = readQueryOverrides()
  const device = probeBrowserDevices()

  // 1) 显式指定的 Agent
  if (override.url) {
    const client = new RpcClient({
      baseUrl: override.url,
      ...(override.token ? { token: override.token } : {}),
    })
    if (await client.ping(2500)) {
      const caps = await client.capabilities().catch(() => null)
      return {
        kind: 'web-agent',
        caps: caps ?? { ...WEB_WITH_AGENT, device },
        client,
        url: override.url,
        warnings: [],
      }
    }
  }

  // 2) 自动发现
  const discovered = await discoverAgent(AGENT_PORTS, override.token)
  if (discovered) {
    const caps = await discovered.capabilities().catch(() => null)
    return {
      kind: 'web-agent',
      caps: caps ?? { ...WEB_WITH_AGENT, device },
      client: discovered,
      url: override.url ?? null,
      warnings: [],
    }
  }

  // 3) 降级：仅浏览器原生能力
  const missing: string[] = []
  missing.push('启动本地服务（浏览器沙箱禁止，需安装本地助手）')
  missing.push('后台常驻（页面关闭即停止）')
  if (!device.serial) missing.push('串口设备（当前浏览器不支持 Web Serial）')
  if (!device.usb) missing.push('USB 设备（当前浏览器不支持 WebUSB）')

  return {
    kind: 'web-degraded',
    caps: { ...WEB_NO_AGENT, device },
    client: null,
    url: null,
    warnings: [],
    web: { missing },
  }
}

/**
 * 唤起本地助手安装 / 启动。
 * 依赖桌面安装器写入的 anyframe:// 协议（见 apps/desktop/build/installer.nsh）。
 * 用户未安装时浏览器会静默失败，因此必须配一个超时兜底提示。
 */
export function launchAgentInstaller(): Promise<boolean> {
  return new Promise((resolve) => {
    const start = Date.now()
    const iframe = document.createElement('iframe')
    iframe.style.display = 'none'
    iframe.src = 'anyframe://install'
    document.body.appendChild(iframe)

    // 页面失焦说明系统弹出了协议处理器 → 大概率已安装
    const onBlur = () => {
      cleanup()
      resolve(true)
    }
    const timer = setTimeout(() => {
      cleanup()
      resolve(Date.now() - start > 2000 && document.hidden)
    }, 2500)

    function cleanup() {
      clearTimeout(timer)
      globalThis.removeEventListener('blur', onBlur)
      iframe.remove()
    }

    globalThis.addEventListener('blur', onBlur)
  })
}
