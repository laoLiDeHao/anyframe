import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { AnyFrameApp, type HostSession } from '@anyframe/ui'
import { bootstrapWebHost, launchAgentInstaller, type WebHost } from './agent-bootstrap.ts'

/**
 * Web 端入口。
 *
 * 与桌面 / 移动的唯一区别是「宿主引导」这一步：
 * Web 没有 preload，也不能起进程，只能去常见端口捞本机 Agent。
 * 引导完成后拿到的 RpcClient 与另外两端完全等价，界面完全共用。
 */

function toSession(host: WebHost): HostSession {
  if (host.kind === 'agent') {
    return {
      kind: 'web-agent',
      caps: host.caps,
      client: host.client,
      url: host.client.endpoint,
      warnings: [],
    }
  }
  return {
    kind: 'web-degraded',
    caps: host.caps,
    client: null,
    url: null,
    warnings: [
      '未检测到本地助手：项目与素材会存进当前浏览器的数据库，不会写入磁盘目录；' +
        '浏览器也不允许网页启动本地进程，装上本地助手才有完整能力。',
    ],
    web: { missing: host.missing },
  }
}

function App() {
  const [host, setHost] = useState<WebHost | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    bootstrapWebHost()
      .then((h) => {
        if (!cancelled) setHost(h)
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message)
      })
    return () => {
      cancelled = true
    }
  }, [])

  if (error) {
    return (
      <main style={styles.page}>
        <section style={styles.error}>
          <strong>初始化失败</strong>
          <pre style={styles.pre}>{error}</pre>
        </section>
      </main>
    )
  }

  if (!host) {
    return (
      <main style={styles.page}>
        <p style={styles.muted}>正在探测本地助手…</p>
      </main>
    )
  }

  return (
    <AnyFrameApp
      host={toSession(host)}
      hostLabel="Web"
      onRequestAgent={() => {
        void launchAgentInstaller()
      }}
    />
  )
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
