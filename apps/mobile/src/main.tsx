import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Capacitor } from '@capacitor/core'
import { AnyFrameApp, type HostKind, type HostSession } from '@anyframe/ui'
import { bootstrapMobileHost, type MobileHost } from './host.ts'

/**
 * 移动端入口。
 *
 * 与桌面 / Web 的差别只在宿主引导：
 *   - 能起服务，但只能起「应用进程内的内嵌服务」（Android 用前台服务保活）
 *   - 起不来时（健康检查失败 / 原生侧还没实现 fs.*）界面会自动退化为
 *     IndexedDB 存储，并在顶部横幅说明 —— 不会白屏，也不会假装写盘成功
 */

function toSession(host: MobileHost): HostSession {
  const platform = Capacitor.getPlatform()
  const native = Capacitor.isNativePlatform()

  const kind: HostKind = !native ? 'web-degraded' : platform === 'ios' ? 'ios' : 'android'

  return {
    kind,
    caps: host.caps,
    client: host.client,
    url: host.url,
    warnings: host.warnings,
    ...(native
      ? { mobile: { foreground: host.foreground, container: platform } }
      : {}),
  }
}

function App() {
  const [host, setHost] = useState<MobileHost | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    bootstrapMobileHost()
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
        <p style={styles.muted}>正在启动内嵌服务…</p>
      </main>
    )
  }

  return (
    <AnyFrameApp
      host={toSession(host)}
      hostLabel={Capacitor.isNativePlatform() ? String(host.caps.platform) : '移动端预览'}
    />
  )
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    padding: 'calc(env(safe-area-inset-top) + 16px) 16px 24px',
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
