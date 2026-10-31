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
              {host.client ? '宿主私有服务目录' : '未连接运行宿主'}
            </dd>
            <dt>位置</dt>
            <dd>services/&lt;服务 ID&gt;/</dd>
            <dt>宿主</dt>
            <dd>
              {HOST_LABEL[host.kind]}（{host.kind}）· {host.caps.platform}/{host.caps.arch}
            </dd>
            <dt>服务地址</dt>
            <dd>{host.url ?? '未连接'}</dd>
          </dl>
          <p className="af-muted-2" style={{ marginBottom: 0 }}>
            每个服务的入口、前端与业务数据保存在各自目录中；端口和访问设置在服务列表里编辑。
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
            v{resolveVersion(host.caps.version)}：独立服务包管理、运行配置和局域网分享。
          </p>
          <p className="af-muted-2" style={{ marginBottom: 0 }}>
            导入预先打包的 ZIP 服务，在当前设备上运行。
          </p>
        </div>
      </section>
    </AppShell>
  )
}
