import type { CSSProperties } from 'react'
import { can, reason } from '@anyframe/core'
import { FEATURES, HOST_LABEL, type HostSession } from '../host/types'

/**
 * ─────────────────────────────────────────────────────────────
 * Shell：五端共用的唯一 UI 骨架
 * ─────────────────────────────────────────────────────────────
 * 只读 HostSession，不关心自己跑在 Electron、WebView 还是浏览器
 * 标签页里 —— 平台差异在 src/host/ 已经被收敛掉了。
 *
 * 这个组件同时是**构建自检页**：能正确显示宿主类型、服务地址与
 * 能力矩阵，就说明「一份产物服务五端」的链路是通的。
 * CI 之外手工验收时也用它。
 *
 * 样式全部走 inline style：CSP 的 style-src 'unsafe-inline' 已在
 * index.html 放行，且不引入任何 CSS 文件加载顺序问题（file://、
 * capacitor:// 下相对路径最容易出错的就是静态资源）。
 */

export function Shell({ host }: { host: HostSession }) {
  const { caps } = host
  const connected = host.client !== null

  return (
    <main style={s.page}>
      <h1 style={s.h1}>
        AnyFrame · {HOST_LABEL[host.kind]}
      </h1>

      <section style={connected ? s.ok : s.warn}>
        <strong>{connected ? '本地服务已连通' : '本地服务未就绪'}</strong>
        <p style={s.muted}>
          {host.url ?? '无地址'} · host={caps.host} · service={caps.service} ·
          {' '}background={caps.background} · fs={caps.fileSystem}
        </p>
        {host.mobile?.foreground && <p style={s.muted}>前台服务已激活（通知栏常驻）</p>}
        {host.electron && (
          <p style={s.muted}>
            Electron {host.electron.version} · {host.electron.isDev ? 'dev' : 'prod'}
          </p>
        )}
      </section>

      {host.warnings.length > 0 && (
        <section style={s.card}>
          <h2 style={s.h2}>平台限制</h2>
          <ul style={s.ul}>
            {host.warnings.map((w) => <li key={w} style={s.li}>{w}</li>)}
          </ul>
        </section>
      )}

      {host.web?.missing && host.web.missing.length > 0 && (
        <section style={s.card}>
          <h2 style={s.h2}>缺失能力</h2>
          <ul style={s.ul}>
            {host.web.missing.map((m) => <li key={m} style={s.li}>{m}</li>)}
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
          <dt>宿主</dt><dd>{host.kind}</dd>
          <dt>平台</dt><dd>{caps.platform} / {caps.arch}</dd>
          <dt>服务端口</dt>
          <dd>{host.url ? String(new URL(host.url).port) : '—'}</dd>
        </dl>
      </section>
    </main>
  )
}

// 移动端安全区：刘海屏上不加 paddingTop 会被状态栏盖住。
// 桌面 / Web 下 env(safe-area-inset-*) 为 0，等价于普通 16px 内边距，
// 所以一份样式即可服务五端。
const s: Record<string, CSSProperties> = {
  page: {
    padding: 'calc(env(safe-area-inset-top) + 16px) 16px calc(env(safe-area-inset-bottom) + 24px)',
    fontFamily: 'system-ui, -apple-system, sans-serif',
    color: '#e6e6e6',
    background: '#0f1115',
    minHeight: '100vh',
    WebkitOverflowScrolling: 'touch',
  },
  h1: { fontSize: 20, margin: '0 0 16px' },
  h2: { fontSize: 13, margin: '0 0 10px', opacity: 0.7, textTransform: 'uppercase', letterSpacing: 1 },
  card: { background: '#171a21', border: '1px solid #262b36', borderRadius: 10, padding: 14, marginBottom: 14 },
  ok: { background: '#12261a', border: '1px solid #1f5132', borderRadius: 10, padding: 14, marginBottom: 14 },
  warn: { background: '#2a2414', border: '1px solid #5c4f23', borderRadius: 10, padding: 14, marginBottom: 14 },
  dl: { display: 'grid', gridTemplateColumns: '96px 1fr', gap: '6px 10px', margin: 0, fontSize: 13 },
  ul: { margin: 0, paddingLeft: 18, fontSize: 13 },
  li: { padding: '4px 0' },
  // 触摸目标最小 44×44pt（Apple HIG）/ 48dp（Material），桌面端同样适用
  btn: { background: '#2563eb', color: '#fff', border: 0, borderRadius: 8, padding: '12px 18px', fontSize: 15, minHeight: 44 },
  btnOff: { background: '#23262d', color: '#6b7280', border: '1px solid #2f343d', borderRadius: 8, padding: '12px 18px', fontSize: 15, minHeight: 44 },
  muted: { opacity: 0.65, fontSize: 12, margin: '4px 0 0' },
}
