import { RpcClient } from '@anyframe/core'
import type { HostSession } from './types'

/**
 * 桌面端适配器。
 *
 * endpoint 不靠探测：preload 脚本在渲染前就把「端口 + token」塞进
 * window.anyframe（见 apps/desktop/src/preload）。这是桌面端唯一可信的来源 ——
 * 让页面自己去扫端口会引入两个问题：token 无从得知，以及扫到别的进程的端口。
 */

export interface DesktopBridge {
  host: 'electron'
  platform: string
  arch: string
  version: string
  isDev: boolean
  getServiceEndpoint(): Promise<{ url: string; token?: string }>
}

/** 存在 bridge 即判定为 Electron 宿主。比 UA 里找 "Electron" 可靠。 */
export function detectElectron(): DesktopBridge | null {
  const b = (window as unknown as { anyframe?: DesktopBridge }).anyframe
  return b && typeof b.getServiceEndpoint === 'function' ? b : null
}

export async function bootstrapElectron(bridge: DesktopBridge): Promise<HostSession> {
  const ep = await bridge.getServiceEndpoint()
  const client = new RpcClient({
    baseUrl: ep.url,
    ...(ep.token ? { token: ep.token } : {}),
  })

  if (!(await client.ping())) {
    throw new Error(`本地服务未响应: ${ep.url}`)
  }

  const caps = await client.capabilities()
  return {
    kind: 'electron',
    caps,
    client,
    url: ep.url,
    warnings: [],
    electron: { version: bridge.version, isDev: bridge.isDev },
  }
}
