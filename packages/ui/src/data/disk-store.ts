import { RpcCallError, type FsEntry, type RpcClient } from '@anyframe/core'
import type { Project } from '../model/types.ts'
import {
  PROJECTS_DIR,
  STORAGE_ROOT,
  UrlCache,
  isSafeId,
  parseProject,
  projectFile,
  projectDir,
  serializeProject,
  type MediaStore,
  type MediaUrl,
} from './store.ts'

/**
 * ─────────────────────────────────────────────────────────────
 * DiskStore —— 走 RPC 的 fs.*，数据是用户能看见的真文件
 * ─────────────────────────────────────────────────────────────
 * 三个宿主共用这一条路：
 *   - Electron：主进程的 NodeFsProvider
 *   - Web + Agent：Agent 的 NodeFsProvider
 *   - 移动端：原生侧一旦实现 fs.*，这里自动生效（界面零改动）
 *
 * 为什么不直接调 Node 的 fs：渲染层没有 Node（contextIsolation + sandbox），
 * 而且桌面端和 Web 端走同一条 HTTP 契约是本项目既定的架构决策。
 */

function isNotFound(err: unknown): boolean {
  return err instanceof RpcCallError && err.code === 'NOT_FOUND'
}

export class DiskStore implements MediaStore {
  readonly kind = 'disk' as const
  readonly location = `本机磁盘 · ${STORAGE_ROOT}/（跟随宿主的数据目录）`

  private readonly cache = new UrlCache(24)

  constructor(private readonly client: RpcClient) {}

  async list(): Promise<Project[]> {
    let entries: FsEntry[]
    try {
      const res = await this.client.call('fs.list', { path: PROJECTS_DIR })
      entries = res.entries
    } catch (err) {
      // 第一次使用时目录还不存在，这不是错误 —— 等同于「还没有项目」
      if (isNotFound(err)) return []
      throw err
    }

    const out: Project[] = []
    for (const entry of entries) {
      // 目录名就是项目 id；不合规的一律忽略（可能用户手动塞了别的目录）
      if (!entry.isDir || !isSafeId(entry.name)) continue
      const project = await this.readProject(entry.name)
      if (project) out.push(project)
    }
    return out
  }

  private async readProject(projectId: string): Promise<Project | null> {
    try {
      const res = await this.client.call('fs.read', {
        path: projectFile(projectId),
        encoding: 'utf8',
      })
      return parseProject(res.data)
    } catch (err) {
      if (isNotFound(err)) return null
      throw err
    }
  }

  async save(project: Project): Promise<void> {
    await this.client.call('fs.write', {
      path: projectFile(project.id),
      data: serializeProject(project),
      encoding: 'utf8',
      // 原子写由宿主保证：先写 .tmp 再 rename。
      // 服务被杀在写盘中途时，用户最多丢掉这次改动，不会拿到半个 JSON。
      atomic: true,
      createDirs: true,
    })
  }

  async remove(projectId: string): Promise<void> {
    try {
      await this.client.call('fs.remove', { path: projectDir(projectId), recursive: true })
    } catch (err) {
      if (!isNotFound(err)) throw err
    }
    this.cache.clear()
  }

  async putFile(key: string, bytes: Uint8Array): Promise<void> {
    await this.client.call('fs.write', {
      path: key,
      data: bytesToBase64(bytes),
      encoding: 'base64',
      atomic: true,
      createDirs: true,
    })
  }

  async getUrl(key: string, mime: string): Promise<MediaUrl> {
    const cached = this.cache.get(key)
    if (cached) return { url: cached }

    const res = await this.client.call('fs.read', { path: key, encoding: 'base64' })
    const url = `data:${mime};base64,${res.data}`
    this.cache.set(key, url)
    return { url }
  }

  async removeFiles(keys: readonly string[]): Promise<void> {
    for (const key of keys) {
      try {
        await this.client.call('fs.remove', { path: key })
      } catch (err) {
        // 文件本来就不在属于正常情况（比如缩略图生成失败过），不能让删除整体失败
        if (!isNotFound(err)) console.warn(`[anyframe] 删除文件失败: ${key}`, err)
      }
    }
  }
}

/**
 * base64 编码。
 * 不能用 btoa(String.fromCharCode(...bytes))：参数个数上限会让 10 万字节以上的
 * 数组直接抛 RangeError（典型的「小图能传、大图崩」）。必须分块。
 */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(binary)
}
