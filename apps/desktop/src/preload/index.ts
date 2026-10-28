import { contextBridge, ipcRenderer } from 'electron'

/**
 * Preload：在 contextIsolation + sandbox 下，这是 renderer 唯一能碰到的原生面。
 *
 * 注意：本地服务的调用**不走这里**，renderer 直接用 fetch 连
 * http://127.0.0.1:<port>/rpc/*（与 Web 版连 Agent 完全同一条路径）。
 * 这里只暴露「拿到端口」和少量必须走 IPC 的系统能力。
 */

export interface AnyFrameDesktopBridge {
  /** 桌面宿主标识，前端据此选择 adapter */
  host: 'electron'
  platform: NodeJS.Platform
  arch: string
  version: string
  isDev: boolean

  /**
   * 获取本地 RPC 服务地址。
   * renderer 拿到后 new RpcClient({ baseUrl })，之后一切调用走 HTTP。
   */
  getServiceEndpoint(): Promise<{ url: string; token?: string }>

  /** 系统能力（托盘、自启等只有桌面端有的功能） */
  system: {
    setAutoLaunch(enabled: boolean): Promise<boolean>
    getAutoLaunch(): Promise<boolean>
    showItemInFolder(path: string): Promise<void>
    minimize(): void
    maximize(): void
    close(): void
  }

  /** 主进程 → renderer 的事件订阅 */
  onServiceEvent(cb: (payload: unknown) => void): () => void
}

const bridge: AnyFrameDesktopBridge = {
  host: 'electron',
  platform: process.platform,
  arch: process.arch,
  version: process.env.ANYFRAME_VERSION ?? '0.0.0',
  isDev: process.env.NODE_ENV === 'development',

  getServiceEndpoint: () => ipcRenderer.invoke('anyframe:get-endpoint'),

  system: {
    setAutoLaunch: (enabled) => ipcRenderer.invoke('anyframe:set-autolaunch', enabled),
    getAutoLaunch: () => ipcRenderer.invoke('anyframe:get-autolaunch'),
    showItemInFolder: (path) => ipcRenderer.invoke('anyframe:show-in-folder', path),
    minimize: () => ipcRenderer.send('anyframe:win-minimize'),
    maximize: () => ipcRenderer.send('anyframe:win-maximize'),
    close: () => ipcRenderer.send('anyframe:win-close'),
  },

  onServiceEvent: (cb) => {
    const listener = (_e: unknown, payload: unknown) => cb(payload)
    ipcRenderer.on('anyframe:service-event', listener)
    return () => ipcRenderer.removeListener('anyframe:service-event', listener)
  },
}

contextBridge.exposeInMainWorld('anyframe', bridge)
