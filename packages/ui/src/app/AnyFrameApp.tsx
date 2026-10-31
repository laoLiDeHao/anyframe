import { useState } from 'react'
import type { HostSession } from '../host/types.ts'
import { type AppView, type ShellFrame } from '../ui/AppShell.tsx'
import { DevicePage } from '../ui/pages/DevicePage.tsx'
import { HomePage } from '../ui/pages/HomePage.tsx'
import { SettingsPage } from '../ui/pages/SettingsPage.tsx'
import { ServicesPage } from '../ui/pages/ServicesPage.tsx'
import { ensureAppStyles } from '../ui/theme.ts'
ensureAppStyles()
export interface AnyFrameAppProps { host: HostSession; hostLabel: string; onRequestAgent?: () => void }
export function AnyFrameApp({ host, hostLabel, onRequestAgent }: AnyFrameAppProps) {
  const [view, setView] = useState<AppView>('services')
  const frame: ShellFrame = {
    hostLabel, view, warnings: [], projects: [], activeProjectId: null,
    onOpenHome: () => setView('home'), onOpenServices: () => setView('services'),
    onOpenDevice: () => setView('device'), onOpenSettings: () => setView('settings'),
    onOpenProjects: () => setView('services'), onOpenProject: () => setView('services'),
  }
  if (view === 'services') return <ServicesPage frame={frame} host={host} />
  if (view === 'device') return <DevicePage frame={frame} host={host} store={null} />
  if (view === 'settings') return <SettingsPage frame={frame} host={host} store={null} onRequestAgent={onRequestAgent} />
  return <HomePage frame={frame} host={host} />
}
