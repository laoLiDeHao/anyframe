import { describe, expect, it } from 'vitest'
import { extensionOf, formatBytes, kindOf, newId, resolveMime } from '../../model/media.ts'
import { appendAssets, createGroup, createProject } from '../../model/operations.ts'
import {
  isSafeId,
  mediaKey,
  parseProject,
  projectFile,
  serializeProject,
  thumbKey,
} from '../store.ts'

/**
 * project.json 是用户可见、可手改、也会被旧版本写过的文件。
 * 这一组测试守的是「一个坏字段不能让整个项目打不开」。
 */

const NOW = 1_700_000_000_000

function sampleProject() {
  const base = createProject('我的项目', NOW)
  const withAssets = appendAssets(
    base,
    [
      {
        id: 'a_abcd1234',
        name: '海边.png',
        kind: 'image',
        mime: 'image/png',
        size: 2048,
        addedAt: NOW,
        file: mediaKey(base.id, 'a_abcd1234', 'png'),
        thumb: thumbKey(base.id, 'a_abcd1234'),
        groupIds: [],
      },
    ],
    NOW,
  )
  return createGroup(withAssets, '精选', NOW).project
}

describe('路径约定', () => {
  it('全部是相对存储根的路径', () => {
    expect(projectFile('p_abcd1234')).toBe('AnyFrame/projects/p_abcd1234/project.json')
    expect(mediaKey('p_abcd1234', 'a_abcd1234', 'png')).toBe(
      'AnyFrame/projects/p_abcd1234/media/a_abcd1234.png',
    )
    expect(thumbKey('p_abcd1234', 'a_abcd1234')).toBe(
      'AnyFrame/projects/p_abcd1234/thumbs/a_abcd1234.jpg',
    )
  })

  it('扩展名不可信时落成 .bin，不拼接可疑字符串', () => {
    expect(mediaKey('p_abcd1234', 'a_abcd1234', '../x')).toBe(
      'AnyFrame/projects/p_abcd1234/media/a_abcd1234.bin',
    )
  })

  it('id 白名单拦住路径穿越', () => {
    expect(isSafeId('p_abcd1234')).toBe(true)
    expect(isSafeId('../etc')).toBe(false)
    expect(isSafeId('p_abcd/1234')).toBe(false)
    expect(isSafeId('p_')).toBe(false)
  })
})

describe('parseProject', () => {
  it('序列化再解析，结构不丢', () => {
    const project = sampleProject()
    const parsed = parseProject(serializeProject(project))
    expect(parsed?.id).toBe(project.id)
    expect(parsed?.name).toBe('我的项目')
    expect(parsed?.groups.map((g) => g.name)).toEqual(['精选'])
    expect(parsed?.assets).toHaveLength(1)
    expect(parsed?.assets[0]?.thumb).toBe(project.assets[0]?.thumb)
  })

  it('坏 JSON 返回 null 而不是抛错', () => {
    expect(parseProject('{ oops')).toBeNull()
    expect(parseProject('[]')).toBeNull()
    expect(parseProject('null')).toBeNull()
  })

  it('id 不合法就整条丢弃', () => {
    expect(parseProject(JSON.stringify({ id: '../../evil', name: 'x' }))).toBeNull()
  })

  it('丢弃指向已删除分组的标签', () => {
    const project = sampleProject()
    const broken = {
      ...project,
      assets: [{ ...project.assets[0], groupIds: ['g_gone', project.groups[0]!.id] }],
    }
    const parsed = parseProject(JSON.stringify(broken))
    expect(parsed?.assets[0]?.groupIds).toEqual([project.groups[0]!.id])
  })

  it('丢弃越界文件路径的素材，但项目本身还能打开', () => {
    const project = sampleProject()
    const broken = {
      ...project,
      assets: [
        { ...project.assets[0], id: 'a_bad00001', file: '/etc/passwd' },
        project.assets[0],
      ],
    }
    const parsed = parseProject(JSON.stringify(broken))
    expect(parsed?.assets).toHaveLength(1)
  })

  it('缺字段时补默认值而不是崩', () => {
    const parsed = parseProject(JSON.stringify({ id: 'p_abcd1234' }))
    expect(parsed?.name).toBe('未命名项目')
    expect(parsed?.groups).toEqual([])
    expect(parsed?.assets).toEqual([])
  })
})

describe('类型识别', () => {
  it('MIME 优先', () => {
    expect(kindOf('video/mp4', 'x.bin')).toBe('video')
    expect(kindOf('audio/mpeg', 'x')).toBe('audio')
    expect(kindOf('image/png', 'x')).toBe('image')
  })

  it('MIME 缺失时用扩展名兜底（手机媒体选择器的常见情况）', () => {
    expect(kindOf('', 'IMG_0001.HEIC')).toBe('image')
    expect(kindOf('application/octet-stream', 'clip.MOV')).toBe('video')
    expect(kindOf('', 'voice.mp3')).toBe('audio')
    expect(kindOf('', 'notes.pdf')).toBe('other')
  })

  it('扩展名提取是白名单式的', () => {
    expect(extensionOf('a.PNG')).toBe('png')
    expect(extensionOf('noext')).toBe('')
    expect(extensionOf('.hidden')).toBe('')
    expect(extensionOf('a.tar.gz')).toBe('gz')
    expect(extensionOf('a.weird name')).toBe('')
  })

  it('补 MIME', () => {
    expect(resolveMime('', 'a.mp4')).toBe('video/mp4')
    expect(resolveMime('application/octet-stream', 'a.unknown')).toBe('application/octet-stream')
    expect(resolveMime('image/png', 'a.png')).toBe('image/png')
  })
})

describe('工具函数', () => {
  it('字节格式化不出现 52.3KB 这种精度', () => {
    expect(formatBytes(900)).toBe('900 B')
    expect(formatBytes(1024)).toBe('1.0 KB')
    expect(formatBytes(52 * 1024)).toBe('52 KB')
    expect(formatBytes(3 * 1024 * 1024)).toBe('3.0 MB')
  })

  it('生成的 id 能过路径白名单', () => {
    expect(isSafeId(newId('p'))).toBe(true)
    expect(isSafeId(newId('a'))).toBe(true)
  })
})
