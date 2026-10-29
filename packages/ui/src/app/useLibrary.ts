import { useCallback, useEffect, useRef, useState } from 'react'
import type { RpcClient } from '@anyframe/core'
import { createMediaStore } from '../data/create-store.ts'
import {
  filesOf,
  importFiles as runImport,
  type ImportProgress,
  type ImportResult,
} from '../data/importer.ts'
import type { MediaStore } from '../data/store.ts'
import {
  appendAssets,
  createProject as createProjectOp,
  deleteAssets as deleteAssetsOp,
  sortProjects,
} from '../model/operations.ts'
import type { Project } from '../model/types.ts'

/**
 * ─────────────────────────────────────────────────────────────
 * 数据层与 React 的接缝
 * ─────────────────────────────────────────────────────────────
 * 页面只跟这个 hook 打交道：拿到 projects 渲染，
 * 调 saveProject / importInto 改数据，不用关心底下是磁盘还是 IndexedDB。
 *
 * 有一个刻意的决定：**所有写操作都是「先改界面、再落盘、失败回滚」**。
 * 反过来（写盘成功才更新界面）在移动端会让点击看起来「没反应」——
 * 一次 fs.write 的往返在低端机上是几十毫秒，加上缩略图生成能到秒级。
 * 回滚保证了「显示出去了 = 盘上也写了」这条对用户最重要的保证。
 */

export interface Library {
  store: MediaStore | null
  projects: Project[]
  ready: boolean
  /** 读项目列表都失败了（存储不可用），此时界面应显示错误而不是空列表 */
  fatal: string | null
  /** 降级说明，界面必须展示 */
  warnings: string[]

  createProject(name: string): Promise<Project>
  saveProject(next: Project): Promise<void>
  deleteProject(projectId: string): Promise<void>
  deleteAssets(project: Project, assetIds: readonly string[]): Promise<void>
  importInto(
    project: Project,
    files: readonly File[],
    onProgress?: (p: ImportProgress) => void,
  ): Promise<ImportResult>
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export function useLibrary(client: RpcClient | null): Library {
  const [store, setStore] = useState<MediaStore | null>(null)
  const [projects, setProjects] = useState<Project[]>([])
  const [ready, setReady] = useState(false)
  const [fatal, setFatal] = useState<string | null>(null)
  const [warnings, setWarnings] = useState<string[]>([])

  const storeRef = useRef<MediaStore | null>(null)
  const projectsRef = useRef<Project[]>([])

  const commit = useCallback((next: Project[]) => {
    const sorted = sortProjects(next)
    projectsRef.current = sorted
    setProjects(sorted)
  }, [])

  useEffect(() => {
    let cancelled = false
    setReady(false)
    setFatal(null)

    void (async () => {
      const picked = await createMediaStore(client)
      if (cancelled) return
      storeRef.current = picked.store
      setStore(picked.store)
      setWarnings(picked.warnings)

      try {
        const loaded = await picked.store.list()
        if (cancelled) return
        commit(loaded)
        setFatal(null)
      } catch (err) {
        if (cancelled) return
        setFatal(`读取项目失败：${errorText(err)}`)
      } finally {
        if (!cancelled) setReady(true)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [client, commit])

  const saveProject = useCallback(
    async (next: Project) => {
      const active = storeRef.current
      if (!active) throw new Error('存储尚未就绪')
      const prev = projectsRef.current
      commit(prev.some((p) => p.id === next.id) ? prev.map((p) => (p.id === next.id ? next : p)) : [...prev, next])
      try {
        await active.save(next)
      } catch (err) {
        commit(prev)
        throw new Error(`保存失败：${errorText(err)}`)
      }
    },
    [commit],
  )

  const createProject = useCallback(
    async (name: string) => {
      const project = createProjectOp(name)
      await saveProject(project)
      return project
    },
    [saveProject],
  )

  const deleteProject = useCallback(
    async (projectId: string) => {
      const active = storeRef.current
      if (!active) throw new Error('存储尚未就绪')
      const prev = projectsRef.current
      commit(prev.filter((p) => p.id !== projectId))
      try {
        await active.remove(projectId)
      } catch (err) {
        commit(prev)
        throw new Error(`删除失败：${errorText(err)}`)
      }
    },
    [commit],
  )

  const deleteAssets = useCallback(
    async (project: Project, assetIds: readonly string[]) => {
      const latest = projectsRef.current.find((p) => p.id === project.id) ?? project
      const { project: next, removed } = deleteAssetsOp(latest, assetIds)
      if (removed.length === 0) return
      await saveProject(next)
      // 索引已经落盘；文件删失败最多留几个孤儿文件，不影响自洽性
      await storeRef.current?.removeFiles(filesOf(removed)).catch((err: unknown) => {
        console.warn('[anyframe] 删除素材文件失败', err)
      })
    },
    [saveProject],
  )

  const importInto = useCallback(
    async (
      project: Project,
      files: readonly File[],
      onProgress?: (p: ImportProgress) => void,
    ): Promise<ImportResult> => {
      const active = storeRef.current
      if (!active) throw new Error('存储尚未就绪')
      const latest = projectsRef.current.find((p) => p.id === project.id) ?? project

      const result = await runImport({
        store: active,
        projectId: latest.id,
        files,
        onProgress,
      })

      if (result.assets.length > 0) {
        try {
          await saveProject(appendAssets(latest, result.assets))
        } catch (err) {
          // 索引没写成功 = 这次导入整体失败，把刚写进去的文件清掉，
          // 避免用户重试一次就多出一份永远看不到的副本
          await active.removeFiles(filesOf(result.assets)).catch(() => {})
          throw err
        }
      }
      return result
    },
    [saveProject],
  )

  return {
    store,
    projects,
    ready,
    fatal,
    warnings,
    createProject,
    saveProject,
    deleteProject,
    deleteAssets,
    importInto,
  }
}
