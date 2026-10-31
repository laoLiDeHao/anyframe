import { can, reason, type FeatureId } from '@anyframe/core'
import type { MediaStore } from '../../data/store.ts'
import { FEATURES, HOST_LABEL, type HostSession } from '../../host/types.ts'
import { resolveVersion } from '../../version.ts'
import { AppShell, type ShellFrame } from '../AppShell.tsx'

/**
 * 设备页：这台机器到底能干什么。
 *
 * 和「设置页」的分工：
 *   设备页 —— 硬件 / 平台 / 能力，回答「能用什么、为什么不能用」
 *   设置页 —— 存储、版本、关于，回答「数据在哪、这一版是什么」
 *
 * 为什么要单独一页而不是塞进设置：能力矩阵是这个产品的核心卖点
 * （跨端可降级），它值得一个一级入口，而不是藏在设置的第 4 屏。
 */

const PLATFORM_LABEL: Record<string, string> = {
  win32: 'Windows',
  linux: 'Linux / Ubuntu',
  darwin: 'macOS',
  android: 'Android',
  ios: 'iOS',
  web: '浏览器',
}

/** 每项能力对这个产品意味着什么 —— 比裸的能力名更容易理解 */
const FEATURE_IMPACT: Record<FeatureId, string> = {
  spawnProcess: '启动本地辅助进程 / 外部工具',
  backgroundService: '关掉窗口后继续在后台工作',
  arbitraryFileAccess: '把素材写进任意目录（比如 ~/AnyFrame）',
  serialDevice: '连接串口硬件',
  usbDevice: '连接 USB 硬件',
  systemTray: '在系统托盘常驻',
  autoStart: '开机自动启动',
}

const SERVICE_LABEL: Record<string, string> = {
  full: '完整（可启动外部进程）',
  embedded: '进程内嵌服务（App 自己跑）',
  remote: '远程（由本地助手代管）',
  none: '不可用（浏览器沙箱）',
}

const BACKGROUND_LABEL: Record<string, string> = {
  persistent: '常驻',
  'foreground-only': '前台服务维持（尽力而为）',
  'foreground-transient': '切后台数分钟后挂起',
  none: '页面关闭即停止',
}

const FS_LABEL: Record<string, string> = {
  full: '任意路径读写',
  scoped: '用户授权目录 / 应用目录',
  sandbox: '仅应用沙箱',
  none: '不可用',
}

export function DevicePage({
  frame,
  host,
  store,
}: {
  frame: ShellFrame
  host: HostSession
  store: MediaStore | null
}) {
  const caps = host.caps
  const connected = host.client !== null
  const enabled = FEATURES.filter((f) => can(caps, f.id))
  const disabled = FEATURES.filter((f) => !can(caps, f.id))
  const platformName = PLATFORM_LABEL[caps.platform] ?? caps.platform

  return (
    <AppShell
      {...frame}
      title="设备"
      subtitle={`${platformName} · ${caps.arch}`}
      actions={
        <button className="af-btn af-btn-sm" onClick={frame.onOpenSettings}>
          存储与设置
        </button>
      }
    >
      <section className="af-device-head">
        <div className={connected ? 'af-device-orb ok' : 'af-device-orb off'} aria-hidden="true">
          {connected ? '◉' : '◍'}
        </div>
        <div style={{ minWidth: 0 }}>
          <div className="af-device-name">
            {platformName} · {caps.arch}
          </div>
          <div className="af-device-sub">
            {HOST_LABEL[host.kind]} · {caps.host} · v{resolveVersion(caps.version)}
            {host.url ? ` · ${host.url}` : ''}
          </div>
        </div>
        <span className={connected ? 'af-pill ok' : 'af-pill off'}>
          {connected ? '本地服务已连接' : '本地服务未就绪'}
        </span>
      </section>

      <section className="af-device-grid">
        <div className="af-card">
          <h2 className="af-section-title">运行时</h2>
          <dl className="af-kv">
            <dt>宿主形态</dt>
            <dd>
              {HOST_LABEL[host.kind]}（{host.kind}）
            </dd>
            <dt>平台 / 架构</dt>
            <dd>
              {caps.platform} / {caps.arch}
            </dd>
            <dt>本地服务</dt>
            <dd>{SERVICE_LABEL[caps.service] ?? caps.service}</dd>
            <dt>后台存活</dt>
            <dd>{BACKGROUND_LABEL[caps.background] ?? caps.background}</dd>
            <dt>文件系统</dt>
            <dd>{FS_LABEL[caps.fileSystem] ?? caps.fileSystem}</dd>
            <dt>服务地址</dt>
            <dd>{host.url ?? '未连接'}</dd>
            {host.electron && (
              <>
                <dt>Electron</dt>
                <dd>
                  {host.electron.version} · {host.electron.isDev ? 'dev' : 'prod'}
                </dd>
              </>
            )}
            {host.mobile && (
              <>
                <dt>原生容器</dt>
                <dd>{host.mobile.container}</dd>
                <dt>前台服务</dt>
                <dd>{host.mobile.foreground ? '运行中（通知栏常驻）' : '未运行'}</dd>
              </>
            )}
          </dl>
        </div>


        <div className="af-card">
          <h2 className="af-section-title">
            能力（{enabled.length} / {FEATURES.length} 可用）
          </h2>
          {FEATURES.map((feature) => {
            const ok = can(caps, feature.id)
            const why = reason(caps, feature.id)
            return (
              <div className="af-cap-row" key={feature.id}>
                <div>
                  <span className={ok ? 'af-badge on' : 'af-badge off'}>
                    {ok ? '可用' : '不可用'}
                  </span>
                </div>
                <div>
                  <div className="af-cap-name">{feature.label}</div>
                  <div className="af-cap-note">{ok ? FEATURE_IMPACT[feature.id] : why}</div>
                </div>
              </div>
            )
          })}
          <p className="af-muted-2" style={{ margin: '10px 0 0' }}>
            不可用不等于没做：能力表里写着依据（系统限制 / 平台政策 / 浏览器沙箱），
            桌面端能看到这些按钮，只是这里是禁用态。
          </p>
        </div>

        <div className="af-card">
          <h2 className="af-section-title">平台限制</h2>
          {host.warnings.length === 0 ? (
            <p className="af-muted-2" style={{ margin: 0 }}>
              没有需要处理的限制。
            </p>
          ) : (
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, lineHeight: 1.75 }}>
              {host.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          )}
          {disabled.length > 0 && (
            <p className="af-muted-2" style={{ marginBottom: 0, marginTop: 10 }}>
              当前不可用：{disabled.map((f) => f.label).join('、')}
            </p>
          )}
        </div>
      </section>
    </AppShell>
  )
}
