import { useCallback, useEffect, useMemo, useState } from 'react'
import type { HostSession } from '../host/types.ts'
import { Banner, Toast } from '../ui/components.tsx'
import { AppShell, type AppView, type ShellFrame } from '../ui/AppShell.tsx'
import { DevicePage } from '../ui/pages/DevicePage.tsx'
import { HomePage } from '../ui/pages/HomePage.tsx'
import { ProjectPage } from '../ui/pages/ProjectPage.tsx'
import { ProjectsPage } from '../ui/pages/ProjectsPage.tsx'
import { SettingsPage } from '../ui/pages/SettingsPage.tsx'
import { ServicesPage } from '../ui/pages/ServicesPage.tsx'
import { ensureAppStyles } from '../ui/theme.ts'
import { useLibrary } from './useLibrary.ts'

/**
 * ─────────────────────────────────────────────────────────────
 * 正式版界面的组装层
 * ─────────────────────────────────────────────────────────────
 * 唯一职责：宿主会话 → 数据 → 当前页面。
 *
 * 三个页面（项目列表 / 项目详情 / 设置）不是路由，而是一个状态机。
 * 理由：这一版只有三个页面且不打算支持深链接，引入路由库会让
 * 「桌面 file:// + Capacitor https://localhost」两套 base 都多一层配置，
 * 换来的收益为零。等真的需要深链接（分享某个素材的链接）时再换也不迟 ——
 * 页面组件本身不依赖这个选择。
 */

// 样式在模块加载时注入一次。放在这里而不是入口文件里，
// 是因为三个 app 的入口各不相同，这层才是最靠近界面的公共点。
ensureAppStyles()

export interface AnyFrameAppProps {
  host: HostSession
  /** 品牌后缀：桌面端 / Web / Android */
  hostLabel: string
  /** 能力受限时「安装本地助手」的可选动作（只有 Web 端有） */
  onRequestAgent?: () => void
}

interface ToastState {
  id: number
  text: string
  tone: 'ok' | 'error' | 'info'
}

export function AnyFrameApp({ host, hostLabel, onRequestAgent }: AnyFrameAppProps) {
  const library = useLibrary(host.client)

  const [view, setView] = useState<AppView>('home')
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null)
  const [toast, setToast] = useState<ToastState | null>(null)

  const notify = useCallback((text: string, tone: 'ok' | 'error' | 'info' = 'info') => {
    setToast({ id: Date.now(), text, tone })
  }, [])

  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => setToast(null), toast.tone === 'error' ? 5200 : 3200)
    return () => window.clearTimeout(timer)
  }, [toast])

  const activeProject = useMemo(
    () => library.projects.find((p) => p.id === activeProjectId) ?? null,
    [library.projects, activeProjectId],
  )

  // 项目被删掉后不能停在一个不存在的页面上：直接落回项目列表
  const effectiveView: AppView = view === 'project' && !activeProject ? 'projects' : view

  const openHome = useCallback(() => setView('home'), [])
  const openProjects = useCallback(() => setView('projects'), [])
  const openProject = useCallback((projectId: string) => {
    setActiveProjectId(projectId)
    setView('project')
  }, [])
  const openDevice = useCallback(() => setView('device'), [])
  const openSettings = useCallback(() => setView('settings'), [])

  const frame: ShellFrame = {
    hostLabel,
    projects: library.projects,
    view: effectiveView,
    activeProjectId,
    warnings: library.warnings,
    onOpenHome: openHome,
    onOpenProjects: openProjects,
    onOpenProject: openProject,
    onOpenDevice: openDevice,
    onOpenServices: () => setView('services'),
    onOpenSettings: openSettings,
  }

  if (!library.ready) {
    return (
      <div className="af-root">
        <main className="af-main">
          <div className="af-content">
            <p className="af-muted">正在读取项目…</p>
          </div>
        </main>
      </div>
    )
  }

  if (library.fatal && effectiveView !== 'services') {
    return (
      <AppShell {...frame} title="项目">
        <Banner tone="error" title="读取项目失败">
          {library.fatal}
          <br />
          数据仍然在设备上，可以重启应用后重试；如果反复失败，请到设置页查看宿主与存储信息。
        </Banner>
      </AppShell>
    )
  }

  return (
    <>
      {effectiveView === 'home' ? (
        <HomePage frame={frame} host={host} store={library.store} />
      ) : effectiveView === 'services' ? (
        <ServicesPage frame={frame} host={host} />
      ) : effectiveView === 'device' ? (
        <DevicePage frame={frame} host={host} store={library.store} />
      ) : effectiveView === 'settings' ? (
        <SettingsPage
          frame={frame}
          host={host}
          store={library.store}
          onRequestAgent={onRequestAgent}
        />
      ) : effectiveView === 'project' && activeProject ? (
        <ProjectPage
          // 换项目时整页重挂载，把选择态 / 过滤 / 查看器状态一起清掉
          key={activeProject.id}
          frame={frame}
          project={activeProject}
          store={library.store}
          library={library}
          onBack={openProjects}
          onDeleted={() => {
            setActiveProjectId(null)
            setView('projects')
          }}
          onNotify={notify}
        />
      ) : (
        <ProjectsPage
          frame={frame}
          store={library.store}
          onCreate={async (name) => {
            const project = await library.createProject(name)
            notify(`已创建「${project.name}」`, 'ok')
            openProject(project.id)
          }}
          onNotify={notify}
        />
      )}

      {toast && <Toast text={toast.text} tone={toast.tone} />}
    </>
  )
}
