import type { Asset, Group, MediaKind, Project } from '../model/types.ts'
import { SCHEMA_VERSION } from '../model/types.ts'

/**
 * ─────────────────────────────────────────────────────────────
 * 存储层：MediaStore 抽象
 * ─────────────────────────────────────────────────────────────
 * 界面只认这个接口，不关心数据到底落在磁盘还是 IndexedDB。
 * v1 有两个实现：
 *
 *   DiskStore      —— 走 RPC 的 fs.*（桌面 / 本地 Agent；移动端原生侧一旦实现
 *                     fs.* 也自动走这条，界面零改动）
 *   BrowserStore   —— 无本地服务时降级到 IndexedDB（Web 无 Agent / 移动端服务未就绪）
 *
 * ── 路径约定（重要）─────────────────────────────────────────
 * 所有路径都是**相对存储根**的，形如 `AnyFrame/projects/<id>/media/<aid>.png`。
 * 这是同一份代码能跨端复用磁盘的关键：
 *
 *   Node 宿主：相对路径以 dataRoot 为基准（默认用户主目录）→ ~/AnyFrame/...
 *   Capacitor：相对路径落在 Directory.Data（应用私有目录）
 *
 * 前端永远不拼绝对路径 —— 一旦拼了，五端就会变成五套代码。
 */

/** 存储根。改这个名字等于改用户的目录结构，需要迁移，别随手动。 */
export const STORAGE_ROOT = 'AnyFrame'
export const PROJECTS_DIR = `${STORAGE_ROOT}/projects`

/** id 会拼进路径，必须先白名单化，防 `../` 之类的越界 */
const SAFE_ID = /^[a-z]+_[a-z0-9]{2,}$/i

export function isSafeId(id: string): boolean {
  return SAFE_ID.test(id)
}

export function projectDir(projectId: string): string {
  return `${PROJECTS_DIR}/${projectId}`
}

export function projectFile(projectId: string): string {
  return `${projectDir(projectId)}/project.json`
}

export function mediaKey(projectId: string, assetId: string, ext: string): string {
  const safeExt = /^[a-z0-9]{1,8}$/.test(ext) ? ext : 'bin'
  return `${projectDir(projectId)}/media/${assetId}.${safeExt}`
}

export function thumbKey(projectId: string, assetId: string): string {
  return `${projectDir(projectId)}/thumbs/${assetId}.jpg`
}

/** 读出来的可显示地址。data URL 或 blob URL，视图层不区分。 */
export interface MediaUrl {
  url: string
  /** blob URL 用完可以显式释放；data URL 没有这一步 */
  release?: () => void
}

export interface MediaStore {
  readonly kind: 'disk' | 'browser'
  /** 给用户看的一句话：数据到底写在哪。设置页直接展示，不做二次翻译 */
  readonly location: string

  list(): Promise<Project[]>
  save(project: Project): Promise<void>
  remove(projectId: string): Promise<void>

  putFile(key: string, bytes: Uint8Array): Promise<void>
  getUrl(key: string, mime: string): Promise<MediaUrl>
  removeFiles(keys: readonly string[]): Promise<void>
}

// ── 序列化 ──────────────────────────────────────────────────

export function serializeProject(project: Project): string {
  return JSON.stringify(project, null, 2)
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

const KINDS: readonly MediaKind[] = ['image', 'video', 'audio', 'other']

/**
 * 把磁盘上的 JSON 变成可信的 Project。
 *
 * 为什么要有这一步：project.json 是用户可见、可手改、也会被旧版本写过的文件。
 * 直接 `as Project` 的话，一个少写的方括号就会让整个项目页白屏；
 * 这里遇到坏字段就退化到安全默认值，遇到坏 id 就整条丢弃，
 * 让「一个素材坏了」永远不等于「项目打不开」。
 */
export function parseProject(text: string): Project | null {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return null
  }
  if (!isRecord(raw)) return null

  const id = typeof raw.id === 'string' && isSafeId(raw.id) ? raw.id : ''
  if (!id) return null

  const now = Date.now()
  const num = (v: unknown, d: number): number =>
    typeof v === 'number' && Number.isFinite(v) ? v : d
  const str = (v: unknown, d: string): string => (typeof v === 'string' ? v : d)

  const groups: Group[] = Array.isArray(raw.groups)
    ? raw.groups.flatMap((g): Group[] => {
        if (!isRecord(g)) return []
        const gid = typeof g.id === 'string' && isSafeId(g.id) ? g.id : ''
        if (!gid) return []
        return [{ id: gid, name: str(g.name, '未命名分组'), createdAt: num(g.createdAt, now) }]
      })
    : []

  const groupIds = new Set(groups.map((g) => g.id))

  const assets: Asset[] = Array.isArray(raw.assets)
    ? raw.assets.flatMap((a): Asset[] => {
        if (!isRecord(a)) return []
        const aid = typeof a.id === 'string' && isSafeId(a.id) ? a.id : ''
        const file = typeof a.file === 'string' && a.file.startsWith(`${PROJECTS_DIR}/`) ? a.file : ''
        if (!aid || !file) return []
        const kind = KINDS.includes(a.kind as MediaKind) ? (a.kind as MediaKind) : 'other'
        const rawGroups = Array.isArray(a.groupIds) ? a.groupIds : []
        return [
          {
            id: aid,
            name: str(a.name, aid),
            kind,
            mime: str(a.mime, 'application/octet-stream'),
            size: num(a.size, 0),
            addedAt: num(a.addedAt, now),
            file,
            ...(typeof a.thumb === 'string' ? { thumb: a.thumb } : {}),
            // 指向已删除分组的 id 一律丢掉，否则会出现点了没反应的空分组
            groupIds: rawGroups.filter(
              (g): g is string => typeof g === 'string' && groupIds.has(g),
            ),
          },
        ]
      })
    : []

  return {
    schemaVersion: SCHEMA_VERSION,
    id,
    name: str(raw.name, '未命名项目'),
    description: str(raw.description, ''),
    createdAt: num(raw.createdAt, now),
    updatedAt: num(raw.updatedAt, now),
    groups,
    assets,
  }
}

/**
 * 简易 LRU：缩略图与原图都按 key 缓存，避免每次重渲染都重新读盘。
 * 上限按条目数而不是字节数 —— v1 有 16MB 单文件上限，条目数足够约束内存。
 */
export class UrlCache {
  private map = new Map<string, string>()

  constructor(private readonly limit = 24) {}

  get(key: string): string | undefined {
    const hit = this.map.get(key)
    if (hit === undefined) return undefined
    // 重新插入 = 移到队尾（Map 保持插入序）
    this.map.delete(key)
    this.map.set(key, hit)
    return hit
  }

  set(key: string, url: string): void {
    this.map.set(key, url)
    while (this.map.size > this.limit) {
      const oldest = this.map.keys().next()
      if (oldest.done) break
      this.map.delete(oldest.value)
    }
  }

  clear(): void {
    this.map.clear()
  }
}
