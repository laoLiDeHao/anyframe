import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { bootstrapWebHost, launchAgentInstaller, type WebHost } from './agent-bootstrap'

/**
 * Web 端入口。
 * 与桌面 renderer 的差异集中在「宿主引导」这一步，
 * 引导完成后拿到的 RpcClient 与桌面端完全等价。
 */
function App() {
  const [host, setHost] = useState<WebHost | null>(null)
  const [installing, setInstalling] = useState(false)

  useEffect(() => {
    void bootstrapWebHost().then(setHost)
  }, [])

  if (!host) return <main style={s.page}><p style={s.muted}>正在探测本地助手…</p></main>

  const isAgent = host.kind === 'agent'

  return (
    <main style={s.page}>
      <h1 style={s.h1}>AnyFrame · Web</h1>

      <section style={isAgent ? s.ok : s.warn}>
        <strong>{isAgent ? '已连接本地助手' : '未检测到本地助手 · 能力受限'}</strong>
        <p style={s.muted}>
          当前模式：{host.caps.service === 'none' ? '浏览器沙箱' : '本地助手代理'}
        </p>
      </section>

      {host.kind === 'degraded' && (
        <section style={s.card}>
          <h2 style={s.h2}>以下功能不可用</h2>
          <ul style={s.ul}>
            {host.missing.map((m) => <li key={m} style={s.li}>{m}</li>)}
          </ul>
          <button
            style={s.btn}
            disabled={installing}
            onClick={async () => {
              setInstalling(true)
              const ok = await launchAgentInstaller()
              if (!ok) {
                alert(
                  '未能唤起本地助手。请前往下载页手动安装 AnyFrame 本地助手，' +
                  '安装完成后刷新本页。',
                )
              }
              setInstalling(false)
            }}
          >
            {installing ? '正在唤起…' : '安装 / 启动本地助手'}
          </button>
          <p style={s.muted}>
            也可以手动指定：<code>?agent=http://127.0.0.1:47730&amp;token=YOUR_TOKEN</code>
          </p>
        </section>
      )}

      <section style={s.card}>
        <h2 style={s.h2}>能力</h2>
        <dl style={s.dl}>
          <dt>本地服务</dt><dd>{host.caps.service}</dd>
          <dt>后台存活</dt><dd>{host.caps.background}</dd>
          <dt>文件系统</dt><dd>{host.caps.fileSystem}</dd>
          <dt>串口</dt><dd>{host.caps.device?.serial ? '支持' : '不支持'}</dd>
          <dt>USB</dt><dd>{host.caps.device?.usb ? '支持' : '不支持'}</dd>
          <dt>BLE</dt><dd>{host.caps.device?.ble ? '支持' : '不支持'}</dd>
        </dl>
      </section>

      <section style={s.card}>
        <h2 style={s.h2}>浏览器兼容提示</h2>
        <p style={s.muted}>
          Safari 与 iOS 上的任何浏览器均不支持 Web Serial / WebUSB / WebHID，
          这不是应用缺陷而是 WebKit 的策略决定。需要硬件访问时请使用
          Chrome / Edge，或安装桌面版。
        </p>
      </section>
    </main>
  )
}

const s: Record<string, React.CSSProperties> = {
  page: { padding: 24, fontFamily: 'system-ui, sans-serif', maxWidth: 720, margin: '0 auto', color: '#e6e6e6', background: '#0f1115', minHeight: '100vh' },
  h1: { fontSize: 20, margin: '0 0 16px' },
  h2: { fontSize: 14, margin: '0 0 12px', opacity: 0.7, textTransform: 'uppercase', letterSpacing: 1 },
  card: { background: '#171a21', border: '1px solid #262b36', borderRadius: 8, padding: 16, marginBottom: 16 },
  ok: { background: '#12261a', border: '1px solid #1f5132', borderRadius: 8, padding: 16, marginBottom: 16 },
  warn: { background: '#2a2414', border: '1px solid #5c4f23', borderRadius: 8, padding: 16, marginBottom: 16 },
  dl: { display: 'grid', gridTemplateColumns: '120px 1fr', gap: '6px 12px', margin: 0, fontSize: 13 },
  ul: { margin: '0 0 12px', paddingLeft: 20, fontSize: 13 },
  li: { padding: '3px 0' },
  btn: { background: '#2563eb', color: '#fff', border: 0, borderRadius: 6, padding: '10px 16px', fontSize: 14, cursor: 'pointer' },
  muted: { opacity: 0.65, fontSize: 12 },
}

createRoot(document.getElementById('root')!).render(
  <StrictMode><App /></StrictMode>,
)
