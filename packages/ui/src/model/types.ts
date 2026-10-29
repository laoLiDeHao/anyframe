/**
 * ─────────────────────────────────────────────────────────────
 * 数据模型：项目 / 分组 / 素材
 * ─────────────────────────────────────────────────────────────
 * 只有类型，没有任何运行时依赖 —— 「纯」是刻意的：
 *
 *   - 模型可以被单测覆盖，不需要 DOM、网络、文件系统；
 *   - 存储层（data/）负责把它序列化成 project.json，
 *     界面层（ui/）只读它，二者都不定义字段。
 *
 * 三层关系里最容易搞错的是「分组」：
 * 它是**元数据**而不是文件夹，同一素材可以同时属于多个分组，
 * 所以 Asset.groupIds 是数组，而不是 Asset.groupId。
 * 删除分组只摘这个 id，素材本身不动（见 operations.deleteGroup）。
 */

export type MediaKind = 'image' | 'video' | 'audio' | 'other'

export interface Group {
  id: string
  name: string
  createdAt: number
}

export interface Asset {
  id: string
  /** 用户看到的原始文件名，导入后不再改 */
  name: string
  kind: MediaKind
  mime: string
  size: number
  addedAt: number
  /**
   * 相对存储根的路径，形如 projects/<pid>/media/<aid>.png。
   * 绝不写绝对路径：桌面端解析到 ~/AnyFrame，移动端解析到应用私有目录，
   * 同一份数据模型因此能跨五端复用（见 data/store.ts 的路径约定）。
   */
  file: string
  /** 缩略图路径，仅图片会生成 */
  thumb?: string
  /** 多对多；空数组 = 未分组 */
  groupIds: string[]
}

export interface Project {
  /** 落盘格式版本。将来改结构时用它做迁移，而不是猜字段在不在 */
  schemaVersion: 1
  id: string
  name: string
  description: string
  createdAt: number
  updatedAt: number
  groups: Group[]
  assets: Asset[]
}

/** 分组条上的过滤维度：全部 / 未分组 / 某个分组 */
export type GroupFilter = 'all' | 'ungrouped' | { groupId: string }

export const SCHEMA_VERSION = 1 as const
