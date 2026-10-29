import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { RpcClient, RpcCallError } from '@anyframe/core'
import { AnyFrameApp, type HostSession } from '@anyframe/ui'

/**
 * 桌面端入口。
 *
 * 职责只剩「连上主进程里的 RPC 服务，把会话交给共享界面」。
 * 界面本身在 packages/ui —— 桌面 / Web / 移动三端是同一份，
 * 这一层不再出现任何页面结构。
 *
 * 打包后的 Electron 没有 devtools，renderer 的 console 是唯一诊断出口：
 *   AnyFrame.exe --enable-logging
 * 会把这里的输出转发到 stderr。「preload 没加载」和「RPC 端口不通」
 * 在现场都只表现为一个白屏，所以下面留了明确的启动日志。
 */

declare global {
  interface Window {
    anyframe?: {
      host: 'electron'
      platform: string
      arch: string
      version: string
      isDev: boolean
      getServiceEndpoint(): Promise<{ url: string; token?: string }>
    }
  }
}

type Status =
  | { kind: 'connecting' }
  | { kind: 'ready'; host: HostSession }
  | { kind: 'error'; message: string }

function App() {
  const [status, setStatus] = useState<Status>({ kind: 'connecting' })

  useEffect(() => {
    let cancelled = false

    async function boot() {
      try {
        const bridge = window.anyframe
        if (!bridge) {
          throw new Error('未检测到桌面桥接层，preload 未正确加载')
        }
        const endpoint = await bridge.getServiceEndpoint()
        const client = new RpcClient({
          baseUrl: endpoint.url,
          ...(endpoint.token ? { token: endpoint.token } : {}),
        })

        if (!(await client.ping())) {
          throw new Error(`本地服务未响应: ${endpoint.url}`)
        }

        const caps = await client.capabilities()
        console.info(
          `[renderer] 已连接 ${endpoint.url} ` +
            JSON.stringify({
              host: caps.host,
              platform: caps.platform,
              arch: caps.arch,
              service: caps.service,
              background: caps.background,
              fileSystem: caps.fileSystem,
            }),
        )

        if (cancelled) return
        setStatus({
          kind: 'ready',
          host: {
            kind: 'electron',
            caps,
            client,
            url: endpoint.url,
            warnings: [],
            electron: { version: bridge.version, isDev: bridge.isDev },
          },
        })
      } catch (err) {
        if (cancelled) return
        const msg =
          err instanceof RpcCallError ? `${err.code}: ${err.message}` : (err as Error).message
        setStatus({ kind: 'error', message: msg })
        console.error(
          `[renderer] 启动失败: ${msg}\n` + (err instanceof Error ? err.stack ?? '' : String(err)),
        )
      }
    }

    void boot()
    return () => {
      cancelled = true
    }
  }, [])

  if (status.kind === 'error') {
    return (
      <main style={styles.page}>
        <section style={styles.error}>
          <strong>连接失败</strong>
          <pre style={styles.pre}>{status.message}</pre>
          <p style={styles.muted}>
            排查顺序：主进程控制台是否打印了「RPC 服务就绪」 → preload 路径是否为
            dist/preload/index.cjs → renderer 的 CSP connect-src 是否放行 127.0.0.1
          </p>
        </section>
      </main>
    )
  }

  if (status.kind === 'connecting') {
    return (
      <main style={styles.page}>
        <p style={styles.muted}>正在连接本地服务…</p>
      </main>
    )
  }

  return <AnyFrameApp host={status.host} hostLabel="桌面端" />
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    padding: 24,
    fontFamily: 'system-ui, sans-serif',
    color: '#e6e6e6',
    background: '#0f1115',
    minHeight: '100vh',
  },
  muted: { opacity: 0.65, fontSize: 12 },
  pre: { whiteSpace: 'pre-wrap', fontSize: 12, color: '#f87171' },
  error: { background: '#2a1416', border: '1px solid #5c2326', borderRadius: 8, padding: 16 },
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
