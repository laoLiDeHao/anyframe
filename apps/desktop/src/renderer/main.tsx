import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { RpcClient, RpcCallError, can, reason, type Capabilities } from '@anyframe/core'

/**
 * Renderer 入口。
 * 这里只做一件事：连上本地 RPC 服务，渲染能力矩阵。
 * 它同时是「五端构建配置是否正确」的最小验证页面 ——
 * 打开后能看到 capabilities 就说明整条链路（打包 → 主进程 → 服务宿主 → HTTP）通了。
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
  | { kind: 'ready'; caps: Capabilities; url: string }
  | { kind: 'error'; message: string }

const FEATURES = [
  'spawnProcess',
  'backgroundService',
  'arbitraryFileAccess',
  'serialDevice',
  'usbDevice',
  'systemTray',
  'autoStart',
] as const

function App() {
  const [status, setStatus] = useState<Status>({ kind: 'connecting' })

  useEffect(() => {
    let cancelled = false

    async function boot() {
      try {
        // 桌面端：从 preload 拿端口。Web 端：走 discoverAgent() 自动探测。
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
        if (!cancelled) setStatus({ kind: 'ready', caps, url: endpoint.url })
        // 打包后的 Electron 没有 devtools，renderer 的 console 是唯一诊断出口：
        //   AnyFrame.exe --enable-logging
        // 会把这里的输出转发到 stderr。没有这两行，「preload 没加载」和
        // 「RPC 端口不通」在现场都只表现为一个白屏，无从判断卡在哪一步。
        // 必须 JSON.stringify：Electron 转发 console 时会对第二个参数调
        // String()，直接传对象只会打出 "[object Object]"，等于没打。
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

  return (
    <main style={styles.page}>
      <h1 style={styles.h1}>AnyFrame · 构建自检</h1>

      {status.kind === 'connecting' && <p style={styles.muted}>正在连接本地服务…</p>}

      {status.kind === 'error' && (
        <section style={styles.error}>
          <strong>连接失败</strong>
          <pre style={styles.pre}>{status.message}</pre>
          <p style={styles.muted}>
            排查顺序：主进程控制台是否打印了「RPC 服务就绪」 → preload 路径是否为
            dist/preload/index.cjs → renderer 的 CSP connect-src 是否放行 127.0.0.1
          </p>
        </section>
      )}

      {status.kind === 'ready' && (
        <>
          <section style={styles.card}>
            <h2 style={styles.h2}>宿主信息</h2>
            <dl style={styles.dl}>
              <dt>host</dt><dd>{status.caps.host}</dd>
              <dt>platform</dt><dd>{status.caps.platform}</dd>
              <dt>arch</dt><dd>{status.caps.arch}</dd>
              <dt>version</dt><dd>{status.caps.version}</dd>
              <dt>RPC</dt><dd>{status.url}</dd>
            </dl>
          </section>

          <section style={styles.card}>
            <h2 style={styles.h2}>能力矩阵</h2>
            <table style={styles.table}>
              <thead>
                <tr><th>能力</th><th>等级</th><th>说明</th></tr>
              </thead>
              <tbody>
                <tr><td>本地服务</td><td>{status.caps.service}</td><td>full = 可 spawn 外部进程</td></tr>
                <tr><td>后台存活</td><td>{status.caps.background}</td><td>persistent = 常驻</td></tr>
                <tr><td>文件系统</td><td>{status.caps.fileSystem}</td><td>full = 任意路径</td></tr>
              </tbody>
            </table>
          </section>

          <section style={styles.card}>
            <h2 style={styles.h2}>功能开关</h2>
            <ul style={styles.ul}>
              {FEATURES.map((f) => {
                const ok = can(status.caps, f)
                const why = reason(status.caps, f)
                return (
                  <li key={f} style={styles.li}>
                    <span style={ok ? styles.badgeOn : styles.badgeOff}>
                      {ok ? '可用' : '不可用'}
                    </span>
                    <code>{f}</code>
                    {!ok && why && <span style={styles.muted}> — {why}</span>}
                  </li>
                )
              })}
            </ul>
          </section>
        </>
      )}
    </main>
  )
}

const styles: Record<string, React.CSSProperties> = {
  page: { padding: 24, fontFamily: 'system-ui, sans-serif', color: '#e6e6e6', background: '#0f1115', minHeight: '100vh' },
  h1: { fontSize: 20, margin: '0 0 16px' },
  h2: { fontSize: 14, margin: '0 0 12px', opacity: 0.7, textTransform: 'uppercase', letterSpacing: 1 },
  card: { background: '#171a21', border: '1px solid #262b36', borderRadius: 8, padding: 16, marginBottom: 16 },
  dl: { display: 'grid', gridTemplateColumns: '120px 1fr', gap: '6px 12px', margin: 0, fontSize: 13 },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 13 },
  ul: { listStyle: 'none', padding: 0, margin: 0, fontSize: 13 },
  li: { padding: '6px 0', borderBottom: '1px solid #262b36', display: 'flex', gap: 10, alignItems: 'baseline' },
  badgeOn: { background: '#12351f', color: '#4ade80', padding: '2px 8px', borderRadius: 4, fontSize: 11 },
  badgeOff: { background: '#3a1d1d', color: '#f87171', padding: '2px 8px', borderRadius: 4, fontSize: 11 },
  muted: { opacity: 0.6, fontSize: 12 },
  pre: { whiteSpace: 'pre-wrap', fontSize: 12, color: '#f87171' },
  error: { background: '#2a1416', border: '1px solid #5c2326', borderRadius: 8, padding: 16 },
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
