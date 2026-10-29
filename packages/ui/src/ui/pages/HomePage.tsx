import { can } from '@anyframe/core'
import type { MediaStore } from '../../data/store.ts'
import { FEATURES, HOST_LABEL, type HostSession } from '../../host/types.ts'
import { formatRelative } from '../../model/media.ts'
import { resolveVersion } from '../../version.ts'
import { AppShell, type ShellFrame } from '../AppShell.tsx'

/**
 * 首页 = 驾驶舱。
 *
 * 它不是「功能入口列表」，而是**产品自我说明**：一眼看明白 AnyFrame 是什么、
 * 现在有什么数据、下一步该点哪里。所以版面只有四块：
 *
 *   1. Hero：一句话说清「一套代码五个端」，两个主行动（项目 / 设备）
 *   2. 三张特性的卡片：为什么它敢跨五个端
 *   3. 三步工作流：新用户不知道从哪儿开始时照着做
 *   4. 最近项目：已有数据的人不需要再看介绍，直接进去
 *
 * 刻意不做「图表 / 环形进度」这类装饰：这个产品的价值是「能跑、能降级」，
 * 用数字堆出来的高级感会显得心虚。留白 + 排版 + 一个克制的渐变就够了。
 */
export function HomePage({
  frame,
  host,
  store,
}: {
  frame: ShellFrame
  host: HostSession
  store: MediaStore | null
}) {
  const projects = frame.projects
  const assetCount = projects.reduce((sum, p) => sum + p.assets.length, 0)
  const groupCount = projects.reduce((sum, p) => sum + p.groups.length, 0)
  const enabled = FEATURES.filter((f) => can(host.caps, f.id)).length
  const connected = host.client !== null
  const recent = projects.slice(0, 3)

  return (
    <AppShell
      {...frame}
      title="首页"
      subtitle={`${HOST_LABEL[host.kind]} · 控制台`}
      actions={
        <button className="af-btn af-btn-primary" onClick={frame.onOpenProjects}>
          进入项目管理
        </button>
      }
    >
      <section className="af-hero">
        <div className="af-hero-badge">
          <i />
          v{resolveVersion(host.caps.version)} · {HOST_LABEL[host.kind]}
        </div>

        <h2 className="af-hero-title">
          一套代码，<span>五个端</span>
          <br />
          界面不变形，<br className="af-only-compact" />
          能力不撒谎。
        </h2>

        <div className="af-hero-ends" aria-hidden="true">
          {['Windows', 'Ubuntu', 'Web', 'Android', 'iOS'].map((name) => (
            <span className="af-end-chip" key={name}>
              <i />
              {name}
            </span>
          ))}
        </div>

        <p className="af-hero-sub">
          Windows、Ubuntu、Web、Android、iOS 共用同一份界面、同一份 RPC 契约。
          能做的事写进能力矩阵，做不了的地方给理由 —— 而不是把按钮藏起来假装没这个需求。
        </p>

        <div className="af-hero-actions">
          <button className="af-btn af-btn-primary af-btn-lg" onClick={frame.onOpenProjects}>
            进入项目管理 →
          </button>
          <button className="af-btn af-btn-lg" onClick={frame.onOpenDevice}>
            查看本机能力
          </button>
        </div>

        <div className="af-hero-stats">
          <div className="af-stat">
            <div className="af-stat-value">{projects.length}</div>
            <div className="af-stat-label">项目</div>
          </div>
          <div className="af-stat">
            <div className="af-stat-value">{assetCount}</div>
            <div className="af-stat-label">素材</div>
          </div>
          <div className="af-stat">
            <div className="af-stat-value">{groupCount}</div>
            <div className="af-stat-label">分组</div>
          </div>
          <div className="af-stat">
            <div className="af-stat-value">{store?.kind === 'disk' ? '磁盘' : '本地库'}</div>
            <div className="af-stat-label">存储方式</div>
          </div>
        </div>
      </section>

      <section className="af-cards">
        <article className="af-feature-card">
          <div className="af-feature-icon" aria-hidden="true">
            ⧉
          </div>
          <h3>一份产物，五个宿主</h3>
          <p>
            界面、契约、集成测试都只有一份。换平台只是换一个宿主适配器：
            桌面走 Electron + 本地 HTTP，移动端走 Capacitor + 进程内服务，业务代码零改动。
          </p>
        </article>
        <article className="af-feature-card">
          <div className="af-feature-icon" aria-hidden="true">
            ◈
          </div>
          <h3>能力矩阵 + 降级</h3>
          <p>
            7 项能力按平台声明可用性，不可用时是禁用态加原因。
            本机现在有 {enabled} / {FEATURES.length} 项可用
            {connected ? '，本地服务已连通' : '，当前处于能力受限模式'}。
          </p>
        </article>
        <article className="af-feature-card">
          <div className="af-feature-icon" aria-hidden="true">
            ▤
          </div>
          <h3>本地优先，文件即真相</h3>
          <p>
            素材是磁盘上的原文件，项目是目录里的 <code>project.json</code>。
            不用数据库、不转码，换设备、换软件、直接拷走都能接着用。
          </p>
        </article>
      </section>

      <section className="af-section">
        <h2 className="af-section-title">从这里开始</h2>
        <div className="af-steps">
          <article className="af-step">
            <div className="af-step-num">STEP 01</div>
            <h3>建一个项目</h3>
            <p>一个项目对应存储目录里的一个文件夹，先给它起个名字。</p>
          </article>
          <article className="af-step">
            <div className="af-step-num">STEP 02</div>
            <h3>导入素材</h3>
            <p>桌面端直接把文件拖进窗口；手机端点「导入」走系统相册 / 文件选择器。</p>
          </article>
          <article className="af-step">
            <div className="af-step-num">STEP 03</div>
            <h3>分组与查看</h3>
            <p>分组是标签不是文件夹：同一素材可以进多个组，删组不会删文件。</p>
          </article>
        </div>
      </section>

      {recent.length > 0 && (
        <section className="af-section">
          <div className="af-row" style={{ marginBottom: 10 }}>
            <h2 className="af-section-title" style={{ margin: 0 }}>
              最近项目
            </h2>
            <div className="af-spacer" />
            <button className="af-btn af-btn-sm af-btn-ghost" onClick={frame.onOpenProjects}>
              全部项目 →
            </button>
          </div>
          <div className="af-projects">
            {recent.map((project) => (
              <button
                key={project.id}
                className="af-project"
                onClick={() => frame.onOpenProject(project.id)}
                title={project.name}
              >
                <div className="af-project-cover" aria-hidden="true">
                  ▤
                </div>
                <div className="af-project-body">
                  <span className="af-project-name">{project.name}</span>
                  <span className="af-project-meta">
                    {project.assets.length} 个素材 · {project.groups.length} 个分组
                  </span>
                  <span className="af-project-meta">
                    更新于 {formatRelative(project.updatedAt)}
                  </span>
                </div>
              </button>
            ))}
          </div>
        </section>
      )}

      <section className="af-section">
        <div className="af-card af-row" style={{ gap: 14 }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 600 }}>想确认这台设备能做什么？</div>
            <div className="af-muted-2" style={{ marginTop: 4 }}>
              设备页会列出宿主形态、存储位置，以及 7 项能力逐项的可用性与原因。
            </div>
          </div>
          <div className="af-spacer" />
          <button className="af-btn" onClick={frame.onOpenDevice}>
            打开设备详情
          </button>
        </div>
      </section>
    </AppShell>
  )
}
