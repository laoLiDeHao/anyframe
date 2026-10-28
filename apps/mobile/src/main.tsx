import { StrictMode, useEffect, useState, type CSSProperties } from 'react'
import { createRoot } from 'react-dom/client'
import { Capacitor } from '@capacitor/core'
import { can, reason, type FeatureId } from '@anyframe/core'
import { bootstrapMobileHost, type MobileHost } from './host.ts'
import { LocalService } from './native/local-service.ts'

/**
 * 移动端入口。
 *
 * 这个页面同时是**构建自检页**：能正确显示平台、内嵌服务地址与能力矩阵，
 * 就说明 vite build → cap sync → 原生打包 → WebView 加载 dist/
 * 这条链路是通的。CI 之外手工验收时也用它。
 */

const FEATURES: { id: FeatureId; label: string }[] = [
  { id: 'spawnProcess', label: '启动外部程序' },
  { id: 'backgroundService', label: '后台常驻服务' },
  { id: 'arbitraryFileAccess', label: '任意路径读写' },
  { id: 'serialDevice', label: '串口设备' },
  { id: 'usbDevice', label: 'USB 设备' },
  { id: 'systemTray', label: '系统托盘' },
  { id: 'autoStart', label: '开机自启' },
]

function App() {
  const [host, setHost] = useState<MobileHost | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    bootstrapMobileHost().then(setHost).catch((e: Error) => setError(e.message))
  }, [])

  if (error) return <main style={s.page}><section style={s.warn}><strong>初始化失败</strong><p style={s.muted}>{error}</p></section></main>
  if (!host) return <main style={s.page}><p style={s.muted}>正在启动内嵌服务…</p></main>

  const { caps } = host

  return (
    <main style={s.page}>
      <h1 style={s.h1}>AnyFrame · {caps.platform}</h1>

      <section style={host.client ? s.ok : s.warn}>
        <strong>{host.client ? '内嵌服务运行中' : '内嵌服务未就绪'}</strong>
        <p style={s.muted}>
          {host.url ?? '无地址'} · host={caps.host} · service={caps.service} ·
          {' '}background={caps.background} · fs={caps.fileSystem}
        </p>
        {host.foreground && <p style={s.muted}>前台服务已激活（通知栏常驻）</p>}
      </section>

      {host.warnings.length > 0 && (
        <section style={s.card}>
          <h2 style={s.h2}>平台限制</h2>
          <ul style={s.ul}>
            {host.warnings.map((w) => <li key={w} style={s.li}>{w}</li>)}
          </ul>
        </section>
      )}

      <section style={s.card}>
        <h2 style={s.h2}>功能开关</h2>
        <p style={s.muted}>
          不可用的功能显示为禁用态并给出原因，而不是隐藏 ——
          让用户知道桌面端有这个能力，而不是以为产品没做。
        </p>
        <ul style={s.ul}>
          {FEATURES.map((f) => {
            const enabled = can(caps, f.id)
            const why = reason(caps, f.id)
            return (
              <li key={f.id} style={s.li}>
                <button style={enabled ? s.btn : s.btnOff} disabled={!enabled}>
                  {f.label}
                </button>
                {!enabled && why && <div style={s.muted}>{why}</div>}
              </li>
            )
          })}
        </ul>
      </section>

      <section style={s.card}>
        <h2 style={s.h2}>运行时</h2>
        <dl style={s.dl}>
          <dt>原生容器</dt><dd>{String(Capacitor.isNativePlatform())}</dd>
          <dt>Capacitor</dt><dd>{Capacitor.getPlatform()}</dd>
          <dt>构建目标</dt><dd>{__ANYFRAME_TARGET__}</dd>
          <dt>服务端口</dt><dd>{host.client ? String(new URL(host.url ?? '').port) : '—'}</dd>
        </dl>
        <button
          style={s.btn}
          onClick={async () => {
            const st = await LocalService.getStatus()
            alert(JSON.stringify(st, null, 2))
          }}
        >
          查看服务状态
        </button>
      </section>
    </main>
  )
}

// 移动端安全区：刘海屏上不加 paddingTop 会被状态栏盖住
const s: Record<string, CSSProperties> = {
  page: {
    padding: 'calc(env(safe-area-inset-top) + 16px) 16px calc(env(safe-area-inset-bottom) + 24px)',
    fontFamily: 'system-ui, -apple-system, sans-serif',
    color: '#e6e6e6',
    background: '#0f1115',
    minHeight: '100vh',
    // iOS 橡皮筋滚动时背景色会露白，用 background-attachment 固定
    WebkitOverflowScrolling: 'touch',
  },
  h1: { fontSize: 20, margin: '0 0 16px' },
  h2: { fontSize: 13, margin: '0 0 10px', opacity: 0.7, textTransform: 'uppercase', letterSpacing: 1 },
  card: { background: '#171a21', border: '1px solid #262b36', borderRadius: 10, padding: 14, marginBottom: 14 },
  ok: { background: '#12261a', border: '1px solid #1f5132', borderRadius: 10, padding: 14, marginBottom: 14 },
  warn: { background: '#2a2414', border: '1px solid #5c4f23', borderRadius: 10, padding: 14, marginBottom: 14 },
  dl: { display: 'grid', gridTemplateColumns: '96px 1fr', gap: '6px 10px', margin: '0 0 12px', fontSize: 13 },
  ul: { margin: 0, paddingLeft: 18, fontSize: 13 },
  li: { padding: '4px 0' },
  // 触摸目标最小 44×44pt（Apple HIG）/ 48dp（Material），别用桌面端的 32px
  btn: { background: '#2563eb', color: '#fff', border: 0, borderRadius: 8, padding: '12px 18px', fontSize: 15, minHeight: 44 },
  btnOff: { background: '#23262d', color: '#6b7280', border: '1px solid #2f343d', borderRadius: 8, padding: '12px 18px', fontSize: 15, minHeight: 44 },
  muted: { opacity: 0.65, fontSize: 12, margin: '4px 0 0' },
}

createRoot(document.getElementById('root')!).render(
  <StrictMode><App /></StrictMode>,
)
