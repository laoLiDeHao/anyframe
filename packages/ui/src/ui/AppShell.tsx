import type { ReactNode } from 'react'
import type { Project } from '../model/types.ts'
import { Banner } from './components.tsx'

/**
 * 五端共用的外框：桌面左侧导航 / 手机底部 tab。
 *
 * 为什么用一个外框而不是每页各画一遍：
 * 导航结构是「产品形状」的唯一表达，散在各个页面里就一定会长歪 ——
 * 典型表现是设置页在桌面端能返回、在手机上找不到入口。
 *
 * 导航一共四项，桌面与手机是同一组：
 *   首页（驾驶舱） / 项目 / 设备 / 设置
 * 桌面端额外把「我的项目」直接列在侧边栏里，省掉一次「先进列表再点进去」。
 */

export type AppView = 'home' | 'projects' | 'project' | 'device' | 'settings'

/** 外框需要的全部导航信息。页面拿到它直接展开成 <AppShell {...frame} /> */
export interface ShellFrame {
  hostLabel: string
  projects: Project[]
  view: AppView
  activeProjectId: string | null
  warnings: string[]
  onOpenHome: () => void
  onOpenProjects: () => void
  onOpenProject: (projectId: string) => void
  onOpenDevice: () => void
  onOpenSettings: () => void
}

export interface AppShellProps extends ShellFrame {
  title: ReactNode
  subtitle?: string
  actions?: ReactNode
  children: ReactNode
}

const TABS: { view: AppView; icon: string; label: string }[] = [
  { view: 'home', icon: '⌂', label: '首页' },
  { view: 'projects', icon: '▤', label: '项目' },
  { view: 'device', icon: '◈', label: '设备' },
  { view: 'settings', icon: '⚙', label: '设置' },
]

export function AppShell(props: AppShellProps) {
  const { projects, view, activeProjectId, hostLabel } = props

  // 「项目」在打开某个项目时也要保持高亮，否则进入项目后导航看起来像断了一格
  const isProjectsArea = view === 'projects' || view === 'project'

  return (
    <div className="af-root">
      <aside className="af-sidebar">
        <div className="af-brand">
          AnyFrame <small>{hostLabel}</small>
        </div>

        <button
          className={view === 'home' ? 'af-nav active' : 'af-nav'}
          onClick={props.onOpenHome}
        >
          <span aria-hidden="true">⌂</span>
          <span className="af-nav-text">首页</span>
        </button>

        <button
          className={isProjectsArea ? 'af-nav active' : 'af-nav'}
          onClick={props.onOpenProjects}
        >
          <span aria-hidden="true">▤</span>
          <span className="af-nav-text">项目</span>
          <span className="af-nav-count">{projects.length}</span>
        </button>

        <button
          className={view === 'device' ? 'af-nav active' : 'af-nav'}
          onClick={props.onOpenDevice}
        >
          <span aria-hidden="true">◈</span>
          <span className="af-nav-text">设备</span>
        </button>

        <div className="af-side-label">我的项目</div>
        <div className="af-side-list">
          {projects.length === 0 && (
            <div className="af-muted-2" style={{ padding: '2px 10px' }}>
              还没有项目
            </div>
          )}
          {projects.map((p) => (
            <button
              key={p.id}
              className={
                view === 'project' && activeProjectId === p.id ? 'af-nav active' : 'af-nav'
              }
              onClick={() => props.onOpenProject(p.id)}
              title={p.name}
            >
              <span aria-hidden="true">◦</span>
              <span className="af-nav-text">{p.name}</span>
              <span className="af-nav-count">{p.assets.length}</span>
            </button>
          ))}
        </div>

        <div className="af-side-foot">
          <button
            className={view === 'settings' ? 'af-nav active' : 'af-nav'}
            onClick={props.onOpenSettings}
          >
            <span aria-hidden="true">⚙</span>
            <span className="af-nav-text">设置与自检</span>
          </button>
        </div>
      </aside>

      <main className="af-main">
        <header className="af-topbar">
          <div style={{ minWidth: 0 }}>
            <h1 className="af-title">{props.title}</h1>
            {props.subtitle && <div className="af-subtitle">{props.subtitle}</div>}
          </div>
          <div className="af-topbar-actions">{props.actions}</div>
        </header>

        <div className="af-content">
          {props.warnings.map((w) => (
            <Banner key={w} title="注意">
              {w}
            </Banner>
          ))}
          {props.children}
        </div>
      </main>

      <nav className="af-tabbar" aria-label="主导航">
        {TABS.map((tab) => (
          <button
            key={tab.view}
            className={view === tab.view || (tab.view === 'projects' && isProjectsArea) ? 'af-tab active' : 'af-tab'}
            onClick={() => {
              if (tab.view === 'home') props.onOpenHome()
              else if (tab.view === 'projects') props.onOpenProjects()
              else if (tab.view === 'device') props.onOpenDevice()
              else props.onOpenSettings()
            }}
          >
            <span className="af-tab-icon" aria-hidden="true">
              {tab.icon}
            </span>
            {tab.label}
          </button>
        ))}
      </nav>
    </div>
  )
}
