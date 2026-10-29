import { useEffect, useRef, useState } from 'react'
import type { Library } from '../../app/useLibrary.ts'
import type { MediaStore } from '../../data/store.ts'
import { describeSkips, pickMediaFiles, type ImportProgress } from '../../data/importer.ts'
import { formatBytes, formatRelative } from '../../model/media.ts'
import {
  addAssetsToGroup,
  clearGroupsOf,
  createGroup,
  deleteGroup,
  filterAssets,
  groupCount,
  normalizeName,
  renameGroup,
  renameProject,
  setDescription,
  ungroupedCount,
} from '../../model/operations.ts'
import type { Group, GroupFilter, Project } from '../../model/types.ts'
import { AppShell, type ShellFrame } from '../AppShell.tsx'
import { Banner, ConfirmDialog, Empty, Modal, PromptDialog } from '../components.tsx'
import { AssetTile } from '../asset/AssetTile.tsx'
import { MediaViewer } from '../viewer/MediaViewer.tsx'

/**
 * 项目页：分组条 + 素材网格 + 批量操作 + 查看器。
 *
 * 这是整个 v1 的主战场，所以三个交互决定写在这里：
 *
 *   1. 选择是**显式进入**的（点「选择」），不是长按或右键。
 *      跨端只有「点按钮」是五端行为一致的，长按在桌面浏览器上是上下文菜单。
 *   2. 分组条同时承担过滤与入口：`+ 新建分组` 就在条尾，
 *      不需要先进入某个「分组管理」页面才能建组。
 *   3. 拖拽只在桌面端有效，但代码不判平台 —— 手机上永远不会触发 dragover。
 */

type Dialog =
  | { kind: 'newGroup' }
  | { kind: 'manageGroups' }
  | { kind: 'renameGroup'; group: Group }
  | { kind: 'deleteGroup'; group: Group }
  | { kind: 'addToGroup' }
  | { kind: 'renameProject' }
  | { kind: 'projectInfo' }
  | { kind: 'deleteProject' }
  | { kind: 'deleteAssets' }
  | { kind: 'newGroupForSelection' }
  | null

export function ProjectPage({
  frame,
  project,
  store,
  library,
  onBack,
  onDeleted,
  onNotify,
}: {
  frame: ShellFrame
  project: Project
  store: MediaStore | null
  library: Library
  onBack: () => void
  onDeleted: () => void
  onNotify: (text: string, tone?: 'ok' | 'error' | 'info') => void
}) {
  const [filter, setFilter] = useState<GroupFilter>('all')
  const [selecting, setSelecting] = useState(false)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [viewerIndex, setViewerIndex] = useState<number | null>(null)
  const [dialog, setDialog] = useState<Dialog>(null)
  const [progress, setProgress] = useState<ImportProgress | null>(null)
  const [busy, setBusy] = useState(false)
  const [dragging, setDragging] = useState(false)

  // 删掉正在过滤的分组后，过滤条件会指向一个不存在的组 —— 表现为「永远空的列表」
  useEffect(() => {
    if (typeof filter === 'object' && !project.groups.some((g) => g.id === filter.groupId)) {
      setFilter('all')
    }
  }, [filter, project.groups])

  const visible = filterAssets(project, filter)

  // ── 写操作统一在这里收口，失败只提示不崩页 ────────────────
  const run = async (op: () => Promise<void>, okText?: string) => {
    setBusy(true)
    try {
      await op()
      if (okText) onNotify(okText, 'ok')
    } catch (err) {
      onNotify(err instanceof Error ? err.message : String(err), 'error')
    } finally {
      setBusy(false)
    }
  }

  const doImport = async (files: File[]) => {
    if (files.length === 0) return
    try {
      const result = await library.importInto(project, files, setProgress)
      const skipped = describeSkips(result.skipped)
      if (result.assets.length > 0) {
        onNotify(
          `已导入 ${result.assets.length} 个素材${skipped ? `；${skipped}` : ''}`,
          skipped ? 'info' : 'ok',
        )
      } else {
        onNotify(skipped ?? '没有可导入的文件', 'error')
      }
    } catch (err) {
      onNotify(err instanceof Error ? err.message : String(err), 'error')
    } finally {
      setProgress(null)
    }
  }

  const toggleSelected = (assetId: string) => {
    setSelectedIds((prev) =>
      prev.includes(assetId) ? prev.filter((id) => id !== assetId) : [...prev, assetId],
    )
  }

  const exitSelecting = () => {
    setSelecting(false)
    setSelectedIds([])
  }

  const dragDepth = useRef(0)

  return (
    <AppShell
      {...frame}
      title={project.name}
      subtitle={`${project.assets.length} 个素材 · ${project.groups.length} 个分组 · 更新于 ${formatRelative(project.updatedAt)}`}
      actions={
        selecting ? (
          <>
            <span className="af-muted-2">已选 {selectedIds.length}</span>
            <button className="af-btn af-btn-sm" onClick={exitSelecting}>
              取消
            </button>
          </>
        ) : (
          <>
            <button className="af-btn af-btn-sm" onClick={onBack} aria-label="返回项目列表">
              ←<span className="af-back-text"> 项目</span>
            </button>
            {project.assets.length > 0 && (
              <button className="af-btn af-btn-sm" onClick={() => setSelecting(true)}>
                选择
              </button>
            )}
            <button className="af-btn af-btn-sm af-btn-primary" onClick={() => void pickMediaFiles().then(doImport)}>
              导入
            </button>
            <button
              className="af-icon-btn"
              onClick={() => setDialog({ kind: 'projectInfo' })}
              aria-label="项目设置"
              title="项目设置"
            >
              ⋯
            </button>
          </>
        )
      }
    >
      {progress && (
        <Banner tone="info" title="正在导入">
          {progress.done} / {progress.total}
          {progress.name ? ` · ${progress.name}` : ' · 正在写入…'}
        </Banner>
      )}

      <div
        style={{ position: 'relative' }}
        onDragOver={(e) => {
          if (!e.dataTransfer.types.includes('Files')) return
          e.preventDefault()
          setDragging(true)
        }}
        onDragEnter={(e) => {
          if (!e.dataTransfer.types.includes('Files')) return
          dragDepth.current += 1
          setDragging(true)
        }}
        onDragLeave={() => {
          dragDepth.current = Math.max(0, dragDepth.current - 1)
          if (dragDepth.current === 0) setDragging(false)
        }}
        onDrop={(e) => {
          e.preventDefault()
          dragDepth.current = 0
          setDragging(false)
          const files = e.dataTransfer.files ? [...e.dataTransfer.files] : []
          void doImport(files)
        }}
      >
        {dragging && (
          <div className="af-drop">
            <div style={{ fontSize: 22 }}>⤓</div>
            <div>松开导入到「{project.name}」</div>
            <div className="af-muted-2">支持图片 / 视频 / 音频，单个文件 ≤ {formatBytes(16 * 1024 * 1024)}</div>
          </div>
        )}

        <div className="af-chipbar">
          <Chip
            active={filter === 'all'}
            label="全部"
            count={project.assets.length}
            onClick={() => setFilter('all')}
          />
          <Chip
            active={filter === 'ungrouped'}
            label="未分组"
            count={ungroupedCount(project)}
            onClick={() => setFilter('ungrouped')}
          />
          {project.groups.map((group) => (
            <Chip
              key={group.id}
              active={typeof filter === 'object' && filter.groupId === group.id}
              label={group.name}
              count={groupCount(project, group.id)}
              onClick={() => setFilter({ groupId: group.id })}
            />
          ))}
          <button className="af-chip af-chip-add" onClick={() => setDialog({ kind: 'newGroup' })}>
            + 新建分组
          </button>
          {project.groups.length > 0 && (
            <button className="af-chip af-chip-add" onClick={() => setDialog({ kind: 'manageGroups' })}>
              管理
            </button>
          )}
        </div>

        {project.assets.length === 0 ? (
          <Empty
            icon="⤓"
            title="把素材拖进来，或者点右上角「导入」"
            desc={
              <>
                图片、视频、音频都可以。文件会原样保存到项目目录里，不会被压缩或转码；
                导入后再用分组整理它们。
                <br />
                手机端「导入」会打开系统相册 / 文件选择器。
              </>
            }
            action={
              <button
                className="af-btn af-btn-primary"
                onClick={() => void pickMediaFiles().then(doImport)}
              >
                导入素材
              </button>
            }
          />
        ) : visible.length === 0 ? (
          <Empty
            icon="◌"
            title="这个分组里还没有素材"
            desc="素材可以同时属于多个分组。去「全部」里选中它们，再用「加入分组」放进来。"
            action={
              <button className="af-btn" onClick={() => setFilter('all')}>
                查看全部素材
              </button>
            }
          />
        ) : (
          <div className="af-grid">
            {visible.map((asset, i) => (
              <AssetTile
                key={asset.id}
                store={store}
                asset={asset}
                groups={project.groups}
                selecting={selecting}
                selected={selectedIds.includes(asset.id)}
                onOpen={() => setViewerIndex(i)}
                onToggle={() => toggleSelected(asset.id)}
              />
            ))}
          </div>
        )}
      </div>

      {selecting && (
        <div className="af-batchbar">
          <span className="af-muted">已选 {selectedIds.length}</span>
          <div className="af-spacer" />
          <button
            className="af-btn af-btn-sm"
            disabled={selectedIds.length === 0 || busy}
            onClick={() => setDialog({ kind: 'addToGroup' })}
          >
            加入分组
          </button>
          <button
            className="af-btn af-btn-sm"
            disabled={selectedIds.length === 0 || busy}
            onClick={() =>
              void run(async () => {
                const { project: next, changed } = clearGroupsOf(project, selectedIds)
                if (changed === 0) return
                await library.saveProject(next)
                onNotify(`已移出 ${changed} 个素材的分组`, 'ok')
              })
            }
          >
            移出分组
          </button>
          <button
            className="af-btn af-btn-sm af-btn-danger"
            disabled={selectedIds.length === 0 || busy}
            onClick={() => setDialog({ kind: 'deleteAssets' })}
          >
            删除
          </button>
        </div>
      )}

      {viewerIndex !== null && (
        <MediaViewer
          store={store}
          assets={visible}
          index={viewerIndex}
          groups={project.groups}
          onClose={() => setViewerIndex(null)}
          onChange={setViewerIndex}
        />
      )}

      {/* ── 弹窗 ─────────────────────────────────────────── */}

      {dialog?.kind === 'newGroup' && (
        <PromptDialog
          title="新建分组"
          desc="分组是素材的标签：同一素材可以属于多个分组，移出分组不会删除文件。"
          label="分组名称"
          initial={`分组 ${project.groups.length + 1}`}
          confirmLabel="创建"
          busy={busy}
          onCancel={() => setDialog(null)}
          onSubmit={(value) =>
            void run(async () => {
              const { project: next, group } = createGroup(project, value)
              await library.saveProject(next)
              setFilter({ groupId: group.id })
              setDialog(null)
            }, '分组已创建')
          }
        />
      )}

      {dialog?.kind === 'manageGroups' && (
        <Modal
          title="管理分组"
          desc="删除分组只会移除标签，素材仍然保留在项目里。"
          onClose={() => setDialog(null)}
          actions={
            <>
              <button className="af-btn af-btn-ghost" onClick={() => setDialog(null)}>
                关闭
              </button>
              <button
                className="af-btn af-btn-primary"
                onClick={() => setDialog({ kind: 'newGroup' })}
              >
                + 新建分组
              </button>
            </>
          }
        >
          {project.groups.length === 0 && <p className="af-muted-2">还没有分组。</p>}
          {project.groups.map((group) => (
            <div key={group.id} className="af-group-row" style={{ cursor: 'default' }}>
              <span className="af-group-name">{group.name}</span>
              <span className="af-muted-2">{groupCount(project, group.id)}</span>
              <button
                className="af-btn af-btn-sm af-btn-ghost"
                onClick={() => setDialog({ kind: 'renameGroup', group })}
              >
                改名
              </button>
              <button
                className="af-btn af-btn-sm af-btn-danger"
                onClick={() => setDialog({ kind: 'deleteGroup', group })}
              >
                删除
              </button>
            </div>
          ))}
        </Modal>
      )}

      {dialog?.kind === 'renameGroup' && (
        <PromptDialog
          title="重命名分组"
          label="分组名称"
          initial={dialog.group.name}
          confirmLabel="保存"
          busy={busy}
          onCancel={() => setDialog({ kind: 'manageGroups' })}
          onSubmit={(value) =>
            void run(async () => {
              await library.saveProject(renameGroup(project, dialog.group.id, value))
              setDialog({ kind: 'manageGroups' })
            }, '已重命名')
          }
        />
      )}

      {dialog?.kind === 'deleteGroup' && (
        <ConfirmDialog
          title={`删除分组「${dialog.group.name}」？`}
          desc={`该分组里的 ${groupCount(project, dialog.group.id)} 个素材不会被删除，只是不再带这个标签。`}
          confirmLabel="删除分组"
          danger
          busy={busy}
          onCancel={() => setDialog({ kind: 'manageGroups' })}
          onConfirm={() =>
            void run(async () => {
              await library.saveProject(deleteGroup(project, dialog.group.id))
              setDialog(project.groups.length > 1 ? { kind: 'manageGroups' } : null)
            }, '分组已删除，素材已保留')
          }
        />
      )}

      {dialog?.kind === 'addToGroup' && (
        <Modal
          title={`把 ${selectedIds.length} 个素材加入分组`}
          desc="已在该分组里的素材会自动跳过。"
          onClose={() => setDialog(null)}
          actions={
            <>
              <button className="af-btn af-btn-ghost" onClick={() => setDialog(null)}>
                完成
              </button>
              <button
                className="af-btn af-btn-primary"
                onClick={() => setDialog({ kind: 'newGroupForSelection' })}
              >
                + 新建分组
              </button>
            </>
          }
        >
          {project.groups.length === 0 && (
            <p className="af-muted-2">还没有分组，先新建一个。</p>
          )}
          {project.groups.map((group) => (
            <button
              key={group.id}
              className="af-group-row"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const { project: next, changed } = addAssetsToGroup(project, group.id, selectedIds)
                  if (changed === 0) {
                    onNotify('这些素材已经都在该分组里了', 'info')
                    return
                  }
                  await library.saveProject(next)
                  onNotify(`已把 ${changed} 个素材加入「${group.name}」`, 'ok')
                })
              }
            >
              <span className="af-group-name">{group.name}</span>
              <span className="af-muted-2">{groupCount(project, group.id)}</span>
              <span aria-hidden="true">›</span>
            </button>
          ))}
        </Modal>
      )}

      {dialog?.kind === 'newGroupForSelection' && (
        <PromptDialog
          title="新建分组并加入"
          label="分组名称"
          initial={`分组 ${project.groups.length + 1}`}
          confirmLabel="创建并加入"
          busy={busy}
          onCancel={() => setDialog({ kind: 'addToGroup' })}
          onSubmit={(value) =>
            void run(async () => {
              const created = createGroup(project, value)
              const added = addAssetsToGroup(created.project, created.group.id, selectedIds)
              await library.saveProject(added.project)
              setDialog(null)
              onNotify(`已创建「${created.group.name}」并加入 ${added.changed} 个素材`, 'ok')
            })
          }
        />
      )}

      {dialog?.kind === 'deleteAssets' && (
        <ConfirmDialog
          title={`删除 ${selectedIds.length} 个素材？`}
          desc="素材文件会从项目目录中删除，无法恢复。只想去掉分组标签的话，用「移出分组」。"
          confirmLabel="删除素材"
          danger
          busy={busy}
          onCancel={() => setDialog(null)}
          onConfirm={() =>
            void run(async () => {
              const count = selectedIds.length
              await library.deleteAssets(project, selectedIds)
              setDialog(null)
              exitSelecting()
              setViewerIndex(null)
              onNotify(`已删除 ${count} 个素材`, 'ok')
            })
          }
        />
      )}

      {dialog?.kind === 'projectInfo' && (
        <Modal
          title="项目设置"
          onClose={() => setDialog(null)}
          actions={
            <>
              <button className="af-btn af-btn-ghost" onClick={() => setDialog(null)}>
                关闭
              </button>
              <button
                className="af-btn"
                onClick={() => setDialog({ kind: 'renameProject' })}
              >
                重命名
              </button>
              <button
                className="af-btn af-btn-danger"
                onClick={() => setDialog({ kind: 'deleteProject' })}
              >
                删除项目
              </button>
            </>
          }
        >
          <label className="af-label">项目说明</label>
          <input
            className="af-input"
            defaultValue={project.description}
            placeholder="这个项目是干什么用的（可选）"
            onBlur={(e) => {
              const value = e.target.value
              if (value === project.description) return
              void run(async () => {
                await library.saveProject(setDescription(project, value))
              }, '说明已保存')
            }}
          />
          <dl className="af-kv" style={{ marginTop: 16 }}>
            <dt>创建时间</dt>
            <dd>{formatRelative(project.createdAt)}</dd>
            <dt>素材</dt>
            <dd>{project.assets.length} 个</dd>
            <dt>分组</dt>
            <dd>{project.groups.length} 个</dd>
          </dl>
        </Modal>
      )}

      {dialog?.kind === 'renameProject' && (
        <PromptDialog
          title="重命名项目"
          label="项目名称"
          initial={project.name}
          confirmLabel="保存"
          busy={busy}
          onCancel={() => setDialog({ kind: 'projectInfo' })}
          onSubmit={(value) =>
            void run(async () => {
              const name = normalizeName(value, project.name)
              await library.saveProject(renameProject(project, name))
              setDialog(null)
            }, '已重命名')
          }
        />
      )}

      {dialog?.kind === 'deleteProject' && (
        <ConfirmDialog
          title={`删除项目「${project.name}」？`}
          desc={`项目的 ${project.assets.length} 个素材文件、${project.groups.length} 个分组会一起删除，无法恢复。`}
          confirmLabel="删除项目"
          danger
          busy={busy}
          onCancel={() => setDialog({ kind: 'projectInfo' })}
          onConfirm={() =>
            void run(async () => {
              await library.deleteProject(project.id)
              setDialog(null)
              onDeleted()
            })
          }
        />
      )}
    </AppShell>
  )
}

function Chip({
  active,
  label,
  count,
  onClick,
}: {
  active: boolean
  label: string
  count: number
  onClick: () => void
}) {
  return (
    <button className={active ? 'af-chip active' : 'af-chip'} onClick={onClick}>
      {label}
      <span className="af-chip-count">{count}</span>
    </button>
  )
}
