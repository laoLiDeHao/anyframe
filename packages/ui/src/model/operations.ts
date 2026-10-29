import { newId } from './media.ts'
import { SCHEMA_VERSION, type Asset, type Group, type GroupFilter, type Project } from './types.ts'

/**
 * ─────────────────────────────────────────────────────────────
 * 项目 / 分组 / 素材的**不可变**操作
 * ─────────────────────────────────────────────────────────────
 * 每个函数都返回新的 Project，绝不原地改。
 *
 * 原因不是「函数式更优雅」，而是具体的一条需求：
 * 写盘失败时界面必须能回滚到上一个状态。
 * 如果直接改对象，React 的引用比较看不出变化，回滚就无从谈起 ——
 * 这类 bug 的表现是「提示导入失败，但列表里确实多了一张图」。
 *
 * 这一层不碰 IO、不碰 React，所有行为都能用单测钉死（见 __tests__）。
 */

export function normalizeName(raw: string, fallback: string): string {
  // 连续空白折叠成一个空格：用户从别处粘贴名字时经常带换行
  const name = raw.replace(/\s+/g, ' ').trim()
  return name.length === 0 ? fallback : name.slice(0, 80)
}

export function createProject(name: string, now = Date.now()): Project {
  return {
    schemaVersion: SCHEMA_VERSION,
    id: newId('p'),
    name: normalizeName(name, '未命名项目'),
    description: '',
    createdAt: now,
    updatedAt: now,
    groups: [],
    assets: [],
  }
}

/** 统一出口：任何写操作都要走一次，保证 updatedAt 不会漏 */
function touch(project: Project, now: number): Project {
  return { ...project, updatedAt: now }
}

export function renameProject(project: Project, name: string, now = Date.now()): Project {
  return touch({ ...project, name: normalizeName(name, project.name) }, now)
}

export function setDescription(project: Project, description: string, now = Date.now()): Project {
  return touch({ ...project, description: description.slice(0, 500) }, now)
}

// ── 分组 ────────────────────────────────────────────────────

export function createGroup(
  project: Project,
  name: string,
  now = Date.now(),
): { project: Project; group: Group } {
  const group: Group = {
    id: newId('g'),
    name: normalizeName(name, `分组 ${project.groups.length + 1}`),
    createdAt: now,
  }
  return { project: touch({ ...project, groups: [...project.groups, group] }, now), group }
}

export function renameGroup(
  project: Project,
  groupId: string,
  name: string,
  now = Date.now(),
): Project {
  const group = project.groups.find((g) => g.id === groupId)
  if (!group) return project
  const groups = project.groups.map((g) =>
    g.id === groupId ? { ...g, name: normalizeName(name, g.name) } : g,
  )
  return touch({ ...project, groups }, now)
}

/**
 * 删除分组：**只摘元数据，绝不删素材**。
 * 这是 v1 最重要的一条不变量 —— 用户把分组当成「文件夹」时，
 * 删文件夹会以为素材也没了。界面上还要再说明一次。
 */
export function deleteGroup(project: Project, groupId: string, now = Date.now()): Project {
  if (!project.groups.some((g) => g.id === groupId)) return project
  const groups = project.groups.filter((g) => g.id !== groupId)
  const assets = project.assets.map((a) =>
    a.groupIds.includes(groupId)
      ? { ...a, groupIds: a.groupIds.filter((id) => id !== groupId) }
      : a,
  )
  return touch({ ...project, groups, assets }, now)
}

// ── 素材 + 分组的多对多 ─────────────────────────────────────

export function addAssetsToGroup(
  project: Project,
  groupId: string,
  assetIds: readonly string[],
  now = Date.now(),
): { project: Project; changed: number } {
  if (!project.groups.some((g) => g.id === groupId)) return { project, changed: 0 }
  const target = new Set(assetIds)
  let changed = 0
  const assets = project.assets.map((a) => {
    if (!target.has(a.id) || a.groupIds.includes(groupId)) return a
    changed += 1
    return { ...a, groupIds: [...a.groupIds, groupId] }
  })
  return { project: changed ? touch({ ...project, assets }, now) : project, changed }
}

export function removeAssetsFromGroup(
  project: Project,
  groupId: string,
  assetIds: readonly string[],
  now = Date.now(),
): { project: Project; changed: number } {
  const target = new Set(assetIds)
  let changed = 0
  const assets = project.assets.map((a) => {
    if (!target.has(a.id) || !a.groupIds.includes(groupId)) return a
    changed += 1
    return { ...a, groupIds: a.groupIds.filter((id) => id !== groupId) }
  })
  return { project: changed ? touch({ ...project, assets }, now) : project, changed }
}

/** 「移出分组」在选择态下不指定具体分组时的语义：清空全部分组 */
export function clearGroupsOf(
  project: Project,
  assetIds: readonly string[],
  now = Date.now(),
): { project: Project; changed: number } {
  const target = new Set(assetIds)
  let changed = 0
  const assets = project.assets.map((a) => {
    if (!target.has(a.id) || a.groupIds.length === 0) return a
    changed += 1
    return { ...a, groupIds: [] }
  })
  return { project: changed ? touch({ ...project, assets }, now) : project, changed }
}

export function appendAssets(
  project: Project,
  incoming: readonly Asset[],
  now = Date.now(),
): Project {
  if (incoming.length === 0) return project
  return touch({ ...project, assets: [...project.assets, ...incoming] }, now)
}

/**
 * 删除素材：返回被移除的条目，调用方据此删文件。
 *
 * 顺序上必须「先改索引、再删文件」还是反过来？
 * 这里选择先返回、由存储层删文件 —— 文件删失败最多留个孤儿文件，
 * 而先删文件再改索引的话，一旦改索引失败，列表里就会留下打不开的破图。
 */
export function deleteAssets(
  project: Project,
  assetIds: readonly string[],
  now = Date.now(),
): { project: Project; removed: Asset[] } {
  const target = new Set(assetIds)
  const removed = project.assets.filter((a) => target.has(a.id))
  if (removed.length === 0) return { project, removed }
  const assets = project.assets.filter((a) => !target.has(a.id))
  return { project: touch({ ...project, assets }, now), removed }
}

// ── 查询 ────────────────────────────────────────────────────

export function filterAssets(project: Project, filter: GroupFilter): Asset[] {
  if (filter === 'all') return project.assets
  if (filter === 'ungrouped') return project.assets.filter((a) => a.groupIds.length === 0)
  return project.assets.filter((a) => a.groupIds.includes(filter.groupId))
}

export function ungroupedCount(project: Project): number {
  return project.assets.filter((a) => a.groupIds.length === 0).length
}

export function groupCount(project: Project, groupId: string): number {
  return project.assets.filter((a) => a.groupIds.includes(groupId)).length
}

/** 列表排序：最近改过的在前；项目列表的默认顺序 */
export function sortProjects(projects: readonly Project[]): Project[] {
  return [...projects].sort((a, b) => b.updatedAt - a.updatedAt)
}

/** 封面：第一个有缩略图的素材，没有就用第一个图片 */
export function coverAsset(project: Project): Asset | undefined {
  return (
    project.assets.find((a) => a.thumb !== undefined) ??
    project.assets.find((a) => a.kind === 'image') ??
    project.assets[0]
  )
}
