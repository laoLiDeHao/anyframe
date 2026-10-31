import { HOST_LABEL, type HostSession } from '../../host/types.ts'
import { AppShell, type ShellFrame } from '../AppShell.tsx'
export function HomePage({ frame, host }: { frame: ShellFrame; host: HostSession }) {
  return <AppShell {...frame} title="首页" subtitle={HOST_LABEL[host.kind]}>
    <section className="af-hero"><div className="af-hero-badge"><i />AnyFrame</div><h2 className="af-hero-title">你的本地服务工作台</h2><p className="af-hero-sub">运行默认服务，或导入自己的服务包。通过链接与二维码，让同一网络的设备加入。</p><div className="af-hero-actions"><button className="af-btn af-btn-primary af-btn-lg" onClick={frame.onOpenServices}>管理服务 →</button><button className="af-btn af-btn-lg" onClick={frame.onOpenDevice}>查看运行设备</button></div></section>
    <section className="af-card af-section"><h2 className="af-section-title">运行设备</h2><p className="af-muted">{HOST_LABEL[host.kind]} · {host.client ? '已连接' : '未连接'}</p><p className="af-muted-2">服务在当前宿主运行，配置、访问和局域网分享都在服务列表中管理。</p></section>
  </AppShell>
}
