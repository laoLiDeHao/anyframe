import { describe, expect, it } from 'vitest'
import {
  addAssetsToGroup,
  appendAssets,
  clearGroupsOf,
  createGroup,
  createProject,
  deleteAssets,
  deleteGroup,
  filterAssets,
  groupCount,
  normalizeName,
  removeAssetsFromGroup,
  renameProject,
  ungroupedCount,
} from '../operations.ts'
import type { Asset, Project } from '../types.ts'

/**
 * 这一版最容易被改坏的三条业务规则，全部用测试钉死：
 *   1. 加入分组是幂等的（重复点不会出现重复标签）
 *   2. 删除分组不删素材（用户把分组当文件夹时最容易误解）
 *   3. 删除素材会把它从所有分组里一起摘掉
 */

const NOW = 1_700_000_000_000

function asset(id: string): Asset {
  return {
    id,
    name: `${id}.png`,
    kind: 'image',
    mime: 'image/png',
    size: 1024,
    addedAt: NOW,
    file: `AnyFrame/projects/p_abcd1234/media/${id}.png`,
    groupIds: [],
  }
}

function projectWithAssets(...ids: string[]): Project {
  const base = createProject('素材库', NOW)
  return appendAssets(base, ids.map(asset), NOW)
}

describe('normalizeName', () => {
  it('折叠空白并回退到默认名', () => {
    expect(normalizeName('  春季   新品  ', 'x')).toBe('春季 新品')
    expect(normalizeName('   ', '未命名项目')).toBe('未命名项目')
  })

  it('限制长度，避免一个名字撑爆侧边栏', () => {
    expect(normalizeName('a'.repeat(200), 'x')).toHaveLength(80)
  })
})

describe('项目', () => {
  it('创建时带 schemaVersion，改名会更新 updatedAt', () => {
    const project = createProject('新项目', NOW)
    expect(project.schemaVersion).toBe(1)
    expect(project.assets).toEqual([])

    const renamed = renameProject(project, '改名后', NOW + 1000)
    expect(renamed.name).toBe('改名后')
    expect(renamed.updatedAt).toBe(NOW + 1000)
    expect(renamed.createdAt).toBe(NOW)
  })
})

describe('分组', () => {
  it('新建分组不影响素材', () => {
    const project = projectWithAssets('a_one', 'a_two')
    const { project: next, group } = createGroup(project, '海边', NOW + 1)
    expect(next.groups).toHaveLength(1)
    expect(next.assets).toHaveLength(2)
    expect(group.name).toBe('海边')
  })

  it('加入分组是幂等的', () => {
    const project = projectWithAssets('a_one')
    const { project: withGroup, group } = createGroup(project, '海边', NOW + 1)

    const first = addAssetsToGroup(withGroup, group.id, ['a_one'], NOW + 2)
    expect(first.changed).toBe(1)

    const second = addAssetsToGroup(first.project, group.id, ['a_one'], NOW + 3)
    expect(second.changed).toBe(0)
    expect(second.project.assets[0]?.groupIds).toEqual([group.id])
  })

  it('同一素材可以进多个分组', () => {
    const project = projectWithAssets('a_one')
    const g1 = createGroup(project, 'A', NOW + 1)
    const g2 = createGroup(g1.project, 'B', NOW + 2)
    const added = addAssetsToGroup(g2.project, g1.group.id, ['a_one'], NOW + 3)
    const both = addAssetsToGroup(added.project, g2.group.id, ['a_one'], NOW + 4)

    expect(both.project.assets[0]?.groupIds).toEqual([g1.group.id, g2.group.id])
    expect(groupCount(both.project, g1.group.id)).toBe(1)
    expect(groupCount(both.project, g2.group.id)).toBe(1)
  })

  it('删除分组只摘标签，素材仍在', () => {
    const project = projectWithAssets('a_one')
    const created = createGroup(project, '海边', NOW + 1)
    const added = addAssetsToGroup(created.project, created.group.id, ['a_one'], NOW + 2)

    const afterDelete = deleteGroup(added.project, created.group.id, NOW + 3)
    expect(afterDelete.groups).toHaveLength(0)
    expect(afterDelete.assets).toHaveLength(1)
    expect(afterDelete.assets[0]?.groupIds).toEqual([])
    expect(afterDelete.assets[0]?.file).toBe(added.project.assets[0]?.file)
  })

  it('不存在的分组 id 不会造成任何改动（返回原对象）', () => {
    const project = projectWithAssets('a_one')
    expect(addAssetsToGroup(project, 'g_missing', ['a_one']).project).toBe(project)
    expect(deleteGroup(project, 'g_missing')).toBe(project)
  })
})

describe('移出分组', () => {
  it('removeAssetsFromGroup 只摘一个分组', () => {
    const project = projectWithAssets('a_one')
    const g1 = createGroup(project, 'A', NOW + 1)
    const g2 = createGroup(g1.project, 'B', NOW + 2)
    const added = addAssetsToGroup(
      addAssetsToGroup(g2.project, g1.group.id, ['a_one'], NOW + 3).project,
      g2.group.id,
      ['a_one'],
      NOW + 4,
    ).project

    const removed = removeAssetsFromGroup(added, g1.group.id, ['a_one'], NOW + 5)
    expect(removed.changed).toBe(1)
    expect(removed.project.assets[0]?.groupIds).toEqual([g2.group.id])
  })

  it('clearGroupsOf 清空全部分组', () => {
    const project = projectWithAssets('a_one')
    const g1 = createGroup(project, 'A', NOW + 1)
    const added = addAssetsToGroup(g1.project, g1.group.id, ['a_one'], NOW + 2)
    const cleared = clearGroupsOf(added.project, ['a_one'], NOW + 3)
    expect(cleared.project.assets[0]?.groupIds).toEqual([])
    expect(cleared.project.groups).toHaveLength(1)
  })
})

describe('筛选', () => {
  it('全部 / 未分组 / 某个分组', () => {
    const project = projectWithAssets('a_one', 'a_two', 'a_three')
    const { project: withGroup, group } = createGroup(project, '精选', NOW + 1)
    const added = addAssetsToGroup(withGroup, group.id, ['a_one', 'a_three'], NOW + 2).project

    expect(filterAssets(added, 'all')).toHaveLength(3)
    expect(filterAssets(added, 'ungrouped').map((a) => a.id)).toEqual(['a_two'])
    expect(ungroupedCount(added)).toBe(1)
    expect(filterAssets(added, { groupId: group.id }).map((a) => a.id)).toEqual([
      'a_one',
      'a_three',
    ])
  })
})

describe('删除素材', () => {
  it('返回被删条目，交给存储层删文件', () => {
    const project = projectWithAssets('a_one', 'a_two')
    const { project: withGroup, group } = createGroup(project, '精选', NOW + 1)
    const added = addAssetsToGroup(withGroup, group.id, ['a_one'], NOW + 2).project

    const result = deleteAssets(added, ['a_one'], NOW + 3)
    expect(result.removed.map((a) => a.id)).toEqual(['a_one'])
    expect(result.removed[0]?.groupIds).toEqual([group.id])
    expect(result.project.assets.map((a) => a.id)).toEqual(['a_two'])
    expect(result.project.groups).toHaveLength(1)
  })

  it('删不存在的 id 不改动原对象', () => {
    const project = projectWithAssets('a_one')
    expect(deleteAssets(project, ['a_missing']).project).toBe(project)
  })
})
