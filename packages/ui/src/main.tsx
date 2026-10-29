import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { AnyFrameApp } from './app/AnyFrameApp.tsx'
import { bootstrapHost } from './host/index.ts'
import { HOST_LABEL, type HostSession } from './host/types.ts'
import { Banner } from './ui/components.tsx'
import { ensureAppStyles } from './ui/theme.ts'

/**
 * packages/ui 自带构建的唯一入口（`pnpm --filter @anyframe/ui build`）。
 *
 * 三个宿主 app 并不加载这份产物 —— 它们直接吃本包的源码。
 * 这个入口存在的价值是：能独立跑 `pnpm dev` 调试界面，
 * 并保证「一份产物服务五端」这条链路随时可验证。
 */

ensureAppStyles()

function App() {
  const [host, setHost] = useState<HostSession | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    bootstrapHost()
      .then(setHost)
      .catch((e: Error) => setError(e.message))
  }, [])

  if (error) {
    return (
      <div className="af-root">
        <main className="af-main">
          <div className="af-content">
            <Banner tone="error" title="初始化失败">
              {error}
            </Banner>
          </div>
        </main>
      </div>
    )
  }

  if (!host) {
    return (
      <div className="af-root">
        <main className="af-main">
          <div className="af-content">
            <p className="af-muted">正在探测宿主环境…</p>
          </div>
        </main>
      </div>
    )
  }

  return <AnyFrameApp host={host} hostLabel={HOST_LABEL[host.kind]} />
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
