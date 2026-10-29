import type { MediaStore } from '../../data/store.ts'
import { HOST_LABEL, type HostSession } from '../../host/types.ts'
import { resolveVersion } from '../../version.ts'
import { AppShell, type ShellFrame } from '../AppShell.tsx'

/**
 * 设置页：存储、版本、关于。
 *
 * 和「设备页」的分工是刻意的：
 *   能力矩阵 / 平台限制 / 宿主细节 → 设备页（那是这个产品的卖点，值得一级入口）
 *   数据在哪、这一版是什么     → 设置页
 *
 * 之前这两块都挤在这里，结果是「想确认能不能写磁盘」要滚三屏设置才能看到。
 */
export function SettingsPage({
  frame,
  host,
  store,
  onRequestAgent,
}: {
  frame: ShellFrame
  host: HostSession
  store: MediaStore | null
  onRequestAgent?: () => void
}) {
  const degraded = host.client === null

  return (
    <AppShell
      {...frame}
      title="设置"
      subtitle={`AnyFrame v${resolveVersion(host.caps.version)} · ${HOST_LABEL[host.kind]}`}
      actions={
        <button className="af-btn af-btn-sm" onClick={frame.onOpenDevice}>
          设备能力
        </button>
      }
    >
      {degraded && onRequestAgent && (
        <div className="af-row" style={{ marginBottom: 16 }}>
          <span className="af-muted-2">
            当前是能力受限模式。想要完整能力（写磁盘、后台常驻）：
          </span>
          <button className="af-btn af-btn-sm" onClick={onRequestAgent}>
            安装 / 启动本地助手
          </button>
        </div>
      )}

      <section className="af-section">
        <h2 className="af-section-title">存储</h2>
        <div className="af-card">
          <dl className="af-kv">
            <dt>存储方式</dt>
            <dd>
              {store ? (store.kind === 'disk' ? '磁盘文件（RPC fs）' : '浏览器数据库（降级）') : '尚未就绪'}
            </dd>
            <dt>位置</dt>
            <dd>{store?.location ?? '—'}</dd>
            <dt>宿主</dt>
            <dd>
              {HOST_LABEL[host.kind]}（{host.kind}）· {host.caps.platform}/{host.caps.arch}
            </dd>
            <dt>服务地址</dt>
            <dd>{host.url ?? '未连接'}</dd>
          </dl>
          <p className="af-muted-2" style={{ marginBottom: 0 }}>
            {store?.kind === 'disk'
              ? '桌面端与本地助手会把素材写进数据目录下的 AnyFrame/，重启、换浏览器都还在。'
              : '降级模式下素材存在当前浏览器 / WebView 里：同一台设备刷新还在，换设备或清缓存就没了。'}
          </p>
        </div>
      </section>

      <section className="af-section">
        <h2 className="af-section-title">需要诊断？</h2>
        <div className="af-card af-row">
          <div>
            <div style={{ fontSize: 13.5 }}>设备页有宿主细节、7 项能力的可用性与原因。</div>
            <div className="af-muted-2" style={{ marginTop: 4 }}>
              排查「某个功能为什么不可用」时先看那里。
            </div>
          </div>
          <div className="af-spacer" />
          <button className="af-btn" onClick={frame.onOpenDevice}>
            打开设备页
          </button>
        </div>
      </section>

      <section className="af-section">
        <h2 className="af-section-title">关于这一版</h2>
        <div className="af-card">
          <p style={{ margin: '0 0 8px' }}>
            v{resolveVersion(host.caps.version)}：首页驾驶舱、项目 / 分组 / 素材工作台、设备能力页。
            素材按原文件保存，分组是标签，删除分组不会删素材。
          </p>
          <p className="af-muted-2" style={{ marginBottom: 0 }}>
            跨端同步、素材编辑、分享导出都还没有；规划见仓库里的 docs/V1-PLAN.md。
          </p>
        </div>
      </section>
    </AppShell>
  )
}
