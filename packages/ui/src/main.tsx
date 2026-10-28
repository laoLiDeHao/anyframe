import { StrictMode, useEffect, useState, type CSSProperties } from 'react'
import { createRoot } from 'react-dom/client'
import { bootstrapHost } from './host/index'
import type { HostSession } from './host/types'
import { Shell } from './ui/Shell'

/**
 * 五端共用 UI 的唯一入口。
 *
 * 这里刻意保持极薄：宿主探测的全部复杂度在 src/host/ 里，
 * UI 渲染在 src/ui/Shell.tsx 里，本文件只做「探测 → 渲染」的粘合。
 * 五端加载的都是这一份产物（见 vite.config.ts 顶部注释），
 * 所以任何构建期分叉（import.meta.env 判端、条件 define）都禁止出现在这里。
 */

function App() {
  const [host, setHost] = useState<HostSession | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    bootstrapHost().then(setHost).catch((e: Error) => setError(e.message))
  }, [])

  if (error) {
    return (
      <main style={s.page}>
        <section style={s.warn}>
          <strong>初始化失败</strong>
          <p style={s.muted}>{error}</p>
        </section>
      </main>
    )
  }
  if (!host) {
    return (
      <main style={s.page}>
        <p style={s.muted}>正在探测宿主环境…</p>
      </main>
    )
  }
  return <Shell host={host} />
}

const s: Record<string, CSSProperties> = {
  page: {
    padding: 'calc(env(safe-area-inset-top) + 16px) 16px calc(env(safe-area-inset-bottom) + 24px)',
    fontFamily: 'system-ui, -apple-system, sans-serif',
    color: '#e6e6e6',
    background: '#0f1115',
    minHeight: '100vh',
  },
  warn: { background: '#2a2414', border: '1px solid #5c4f23', borderRadius: 10, padding: 14 },
  muted: { opacity: 0.65, fontSize: 12, margin: '4px 0 0' },
}

createRoot(document.getElementById('root')!).render(
  <StrictMode><App /></StrictMode>,
)
