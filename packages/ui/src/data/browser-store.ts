import type { Project } from '../model/types.ts'
import { parseProject, serializeProject, type MediaStore, type MediaUrl } from './store.ts'

/**
 * ─────────────────────────────────────────────────────────────
 * BrowserStore —— 没有本地服务时的降级实现（IndexedDB）
 * ─────────────────────────────────────────────────────────────
 * 什么时候会走到这里：
 *   1. Web 版没装 / 没启动本地助手（能力受限模式）
 *   2. 移动端内嵌服务健康检查没过，或原生侧还没实现 fs.*
 *
 * 为什么不做成「只存在内存里」：那样刷新一下项目就没了，
 * 用户会以为产品坏了。IndexedDB 至少在同一个浏览器 / 同一个 App 里是持久的。
 *
 * ⚠️ 必须在界面上说清楚它和磁盘存储的区别：
 *    这里的数据不会出现在 ~/AnyFrame，也不会同步到别的设备。
 *    假装它写进了磁盘，比不存更糟。
 */

const DB_NAME = 'anyframe'
const DB_VERSION = 1
const STORE_PROJECTS = 'projects'
const STORE_FILES = 'files'

interface ProjectRecord {
  id: string
  json: string
}

interface FileRecord {
  key: string
  blob: Blob
}

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('IndexedDB 请求失败'))
  })
}

function completed(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB 事务被中断'))
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB 事务失败'))
  })
}

export class BrowserStore implements MediaStore {
  readonly kind = 'browser' as const
  readonly location = '浏览器本地数据库（IndexedDB）· 不写入磁盘目录，换设备看不到'

  private dbPromise: Promise<IDBDatabase | null> | null = null
  /** indexedDB 不可用（无痕模式 / 老 WebView）时的兜底，刷新即丢 */
  private readonly memProjects = new Map<string, string>()
  private readonly memFiles = new Map<string, Blob>()
  private readonly urlCache = new Map<string, string>()

  private open(): Promise<IDBDatabase | null> {
    if (this.dbPromise) return this.dbPromise
    this.dbPromise = new Promise((resolve) => {
      if (typeof indexedDB === 'undefined') {
        resolve(null)
        return
      }
      let req: IDBOpenDBRequest
      try {
        req = indexedDB.open(DB_NAME, DB_VERSION)
      } catch {
        resolve(null)
        return
      }
      req.onupgradeneeded = () => {
        const db = req.result
        if (!db.objectStoreNames.contains(STORE_PROJECTS)) {
          db.createObjectStore(STORE_PROJECTS, { keyPath: 'id' })
        }
        if (!db.objectStoreNames.contains(STORE_FILES)) {
          db.createObjectStore(STORE_FILES, { keyPath: 'key' })
        }
      }
      req.onsuccess = () => resolve(req.result)
      // 无痕模式、存储配额为 0、被策略禁用都会走到这里 —— 不抛错，降级到内存
      req.onerror = () => resolve(null)
      req.onblocked = () => resolve(null)
    })
    return this.dbPromise
  }

  async list(): Promise<Project[]> {
    const db = await this.open()
    if (!db) {
      return [...this.memProjects.values()].flatMap((json) => {
        const p = parseProject(json)
        return p ? [p] : []
      })
    }
    const tx = db.transaction(STORE_PROJECTS, 'readonly')
    const records = await request<ProjectRecord[]>(
      tx.objectStore(STORE_PROJECTS).getAll() as IDBRequest<ProjectRecord[]>,
    )
    return records.flatMap((r) => {
      const p = parseProject(r.json)
      return p ? [p] : []
    })
  }

  async save(project: Project): Promise<void> {
    const json = serializeProject(project)
    const db = await this.open()
    if (!db) {
      this.memProjects.set(project.id, json)
      return
    }
    const tx = db.transaction(STORE_PROJECTS, 'readwrite')
    tx.objectStore(STORE_PROJECTS).put({ id: project.id, json } satisfies ProjectRecord)
    await completed(tx)
  }

  async remove(projectId: string): Promise<void> {
    const db = await this.open()
    if (!db) {
      this.memProjects.delete(projectId)
      for (const key of [...this.memFiles.keys()]) {
        if (key.includes(`/${projectId}/`)) this.memFiles.delete(key)
      }
      return
    }
    const tx = db.transaction(STORE_PROJECTS, 'readwrite')
    tx.objectStore(STORE_PROJECTS).delete(projectId)
    await completed(tx)
  }

  async putFile(key: string, bytes: Uint8Array): Promise<void> {
    // 复制到一个独立的 ArrayBuffer 再交给 Blob：
    // 直接传 Uint8Array 时，TS 的 BlobPart 要求 buffer 是 ArrayBuffer 而不是
    // ArrayBufferLike（SharedArrayBuffer 不算），而传入的视图可能来自任意缓冲。
    // 复制一份只有几毫秒成本，换来的是类型与运行时的双重确定性。
    const buffer = new ArrayBuffer(bytes.byteLength)
    new Uint8Array(buffer).set(bytes)
    const blob = new Blob([buffer])
    const db = await this.open()
    if (!db) {
      this.memFiles.set(key, blob)
      return
    }
    const tx = db.transaction(STORE_FILES, 'readwrite')
    tx.objectStore(STORE_FILES).put({ key, blob } satisfies FileRecord)
    await completed(tx)
  }

  async getUrl(key: string, _mime: string): Promise<MediaUrl> {
    const cached = this.urlCache.get(key)
    if (cached) return { url: cached }

    let blob: Blob | undefined
    const db = await this.open()
    if (!db) {
      blob = this.memFiles.get(key)
    } else {
      const tx = db.transaction(STORE_FILES, 'readonly')
      const record = await request<FileRecord | undefined>(
        tx.objectStore(STORE_FILES).get(key) as IDBRequest<FileRecord | undefined>,
      )
      blob = record?.blob
    }
    if (!blob) throw new Error(`素材文件不存在: ${key}`)

    // blob URL 比 data URL 省一次 base64 解码，Video 也能直接拖动进度条
    const url = URL.createObjectURL(blob)
    this.urlCache.set(key, url)
    return { url }
  }

  async removeFiles(keys: readonly string[]): Promise<void> {
    const db = await this.open()
    if (!db) {
      for (const key of keys) {
        this.memFiles.delete(key)
        this.releaseUrl(key)
      }
      return
    }
    const tx = db.transaction(STORE_FILES, 'readwrite')
    const store = tx.objectStore(STORE_FILES)
    for (const key of keys) {
      store.delete(key)
      this.releaseUrl(key)
    }
    await completed(tx)
  }

  private releaseUrl(key: string): void {
    const url = this.urlCache.get(key)
    if (!url) return
    URL.revokeObjectURL(url)
    this.urlCache.delete(key)
  }
}
