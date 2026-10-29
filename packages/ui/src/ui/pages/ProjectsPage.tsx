import { useState } from 'react'
import { useMediaUrl } from '../../app/useMediaUrl.ts'
import type { MediaStore } from '../../data/store.ts'
import { formatRelative } from '../../model/media.ts'
import { coverAsset } from '../../model/operations.ts'
import type { Project } from '../../model/types.ts'
import { AppShell, type ShellFrame } from '../AppShell.tsx'
import { Empty, PromptDialog } from '../components.tsx'

/**
 * 首页：项目列表。
 *
 * 它是产品里唯一「什么都不用选就能看懂」的页面，所以刻意只放三样东西：
 * 项目卡片、新建按钮、空状态说明。自检信息已经挪到设置页 ——
 * 首页是产品，诊断是诊断。
 */
export function ProjectsPage({
  frame,
  store,
  onCreate,
  onNotify,
}: {
  frame: ShellFrame
  store: MediaStore | null
  onCreate: (name: string) => Promise<void>
  onNotify: (text: string, tone?: 'ok' | 'error' | 'info') => void
}) {
  const [creating, setCreating] = useState(false)
  const [busy, setBusy] = useState(false)

  const submit = async (name: string) => {
    setBusy(true)
    try {
      await onCreate(name)
      setCreating(false)
    } catch (err) {
      onNotify(err instanceof Error ? err.message : String(err), 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <AppShell
      {...frame}
      title="项目"
      subtitle={`${frame.projects.length} 个项目`}
      actions={
        <button className="af-btn af-btn-primary" onClick={() => setCreating(true)}>
          + 新建项目
        </button>
      }
    >
      {frame.projects.length === 0 ? (
        <Empty
          icon="▤"
          title="还没有项目"
          desc={
            <>
              项目是素材的容器：一个项目对应存储目录里的一个文件夹，素材文件原样保存，
              分组只是它们的标签。先建一个项目，再把图片、视频、音频拖进来。
            </>
          }
          action={
            <button className="af-btn af-btn-primary" onClick={() => setCreating(true)}>
              新建第一个项目
            </button>
          }
        />
      ) : (
        <div className="af-projects">
          {frame.projects.map((project) => (
            <ProjectCard
              key={project.id}
              project={project}
              store={store}
              onOpen={() => frame.onOpenProject(project.id)}
            />
          ))}
        </div>
      )}

      {creating && (
        <PromptDialog
          title="新建项目"
          desc="给项目起个名字，比如「产品宣传片素材」。之后可以随时改。"
          label="项目名称"
          initial={`未命名项目 ${frame.projects.length + 1}`}
          placeholder="例如：2026 春季新品"
          confirmLabel="创建"
          busy={busy}
          onCancel={() => setCreating(false)}
          onSubmit={(value) => void submit(value)}
        />
      )}
    </AppShell>
  )
}

function ProjectCard({
  project,
  store,
  onOpen,
}: {
  project: Project
  store: MediaStore | null
  onOpen: () => void
}) {
  const cover = coverAsset(project)
  const url = useMediaUrl(store, cover?.thumb, 'image/jpeg')

  return (
    <button className="af-project" onClick={onOpen} title={project.name}>
      <div className="af-project-cover">
        {url ? <img src={url} alt="" draggable={false} /> : <span aria-hidden="true">▤</span>}
      </div>
      <div className="af-project-body">
        <span className="af-project-name">{project.name}</span>
        <span className="af-project-meta">
          {project.assets.length} 个素材 · {project.groups.length} 个分组
        </span>
        <span className="af-project-meta">更新于 {formatRelative(project.updatedAt)}</span>
      </div>
    </button>
  )
}
