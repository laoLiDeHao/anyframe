import type { ReactNode } from 'react'
import type { Project } from '../model/types.ts'
import { Banner } from './components.tsx'

export type AppView = 'home' | 'services' | 'device' | 'settings'
export interface ShellFrame {
  hostLabel: string
  view: AppView
  warnings: string[]
  onOpenHome: () => void
  onOpenDevice: () => void
  onOpenServices: () => void
  onOpenSettings: () => void
  /** Legacy media pages are retained in source; they have no navigation entry. */
  projects: Project[]
  activeProjectId: string | null
  onOpenProjects: () => void
  onOpenProject: (id: string) => void
}
export interface AppShellProps extends ShellFrame { title: ReactNode; subtitle?: string; actions?: ReactNode; children: ReactNode }
const tabs: { view: AppView; icon: string; label: string }[] = [
  { view: 'home', icon: '⌂', label: '首页' },
  { view: 'services', icon: '▷', label: '服务' },
  { view: 'device', icon: '◈', label: '设备' },
  { view: 'settings', icon: '⚙', label: '设置' },
]
export function AppShell(props: AppShellProps) {
  const actions = { home: props.onOpenHome, services: props.onOpenServices, device: props.onOpenDevice, settings: props.onOpenSettings }
  return <div className="af-root">
    <aside className="af-sidebar">
      <div className="af-brand">AnyFrame <small>{props.hostLabel}</small></div>
      {tabs.map(tab => <button key={tab.view} className={props.view === tab.view ? 'af-nav active' : 'af-nav'} onClick={actions[tab.view]}><span aria-hidden="true">{tab.icon}</span><span className="af-nav-text">{tab.label}</span></button>)}
    </aside>
    <main className="af-main">
      <header className="af-topbar"><div style={{ minWidth: 0 }}><h1 className="af-title">{props.title}</h1>{props.subtitle && <div className="af-subtitle">{props.subtitle}</div>}</div><div className="af-topbar-actions">{props.actions}</div></header>
      <div className="af-content">{props.warnings.map(w => <Banner key={w} title="注意">{w}</Banner>)}{props.children}</div>
    </main>
    <nav className="af-tabbar" aria-label="主导航">{tabs.map(tab => <button key={tab.view} className={props.view === tab.view ? 'af-tab active' : 'af-tab'} onClick={actions[tab.view]}><span className="af-tab-icon" aria-hidden="true">{tab.icon}</span>{tab.label}</button>)}</nav>
  </div>
}
