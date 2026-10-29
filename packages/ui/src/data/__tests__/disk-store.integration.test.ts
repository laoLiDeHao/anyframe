import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { RpcClient } from '@anyframe/core'
import { NodeFsProvider, startRpcServer, type RpcServerHandle } from '@anyframe/core/node'
import { DiskStore } from '../disk-store.ts'
import { mediaKey, projectFile } from '../store.ts'
import { addAssetsToGroup, createGroup, createProject } from '../../model/operations.ts'

/**
 * ─────────────────────────────────────────────────────────────
 * DiskStore 的端到端测试：真的起一个 RPC 服务、真的写临时目录
 * ─────────────────────────────────────────────────────────────
 * 单测覆盖不到的正是最容易出错的那部分：
 *   - 「相对路径以宿主 dataRoot 为基准」这条约定到底成不成立
 *   - 写下去的 project.json 能不能再读回来
 *   - 删除项目是不是真的把目录删了
 *
 * 用的是和生产完全一样的三件套：NodeFsProvider + startRpcServer + RpcClient。
 * 只把端口换成自动分配、根目录换成临时目录，所以不存在「测试通过、线上失败」
 * 的配置差异。
 *
 * ⚠️ 本文件刻意被 tsconfig 排除：packages/ui 的 tsconfig 不给 node 类型
 * （浏览器包里不该出现 node:*），而这个测试必须在 Node 里跑。
 * 它由 vitest 直接执行，不参与 tsc。
 */

let dir: string
let server: RpcServerHandle
let store: DiskStore

describe('DiskStore（真实 RPC + 真实磁盘）', () => {
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'anyframe-store-'))
    const fsProvider = new NodeFsProvider({ allowedRoots: [dir] })
    server = await startRpcServer({
      port: 0,
      handlers: {
        'fs.read': (input) => fsProvider.read(input),
        'fs.write': (input) => fsProvider.write(input),
        'fs.list': (input) => fsProvider.list(input),
        'fs.remove': (input) => fsProvider.remove(input),
      },
    })
    store = new DiskStore(new RpcClient({ baseUrl: server.url }))
  })

  afterAll(async () => {
    await server?.close()
    if (dir) await rm(dir, { recursive: true, force: true })
  })

  it('目录还不存在时返回空列表，而不是报错', async () => {
    expect(await store.list()).toEqual([])
  })

  it('保存项目后能在磁盘上找到 project.json，也能再读回来', async () => {
    const project = createProject('端到端项目')
    await store.save(project)

    const file = join(dir, projectFile(project.id))
    const raw = JSON.parse(await readFile(file, 'utf8'))
    expect(raw.name).toBe('端到端项目')
    expect(raw.schemaVersion).toBe(1)

    const [loaded] = await store.list()
    expect(loaded?.id).toBe(project.id)
    expect(loaded?.name).toBe('端到端项目')
  })

  it('素材文件按字节往返，导入后图片能变成 data URL', async () => {
    const project = createProject('素材往返')
    await store.save(project)

    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff, 0x10])
    const key = mediaKey(project.id, 'a_abcd1234', 'png')
    await store.putFile(key, bytes)

    const onDisk = await readFile(join(dir, key))
    expect([...onDisk]).toEqual([...bytes])

    const { url } = await store.getUrl(key, 'image/png')
    expect(url.startsWith('data:image/png;base64,')).toBe(true)
    const decoded = Buffer.from(url.split(',')[1] ?? '', 'base64')
    expect([...decoded]).toEqual([...bytes])
  })

  it('分组改动会落盘（刷新后还在）', async () => {
    const project = createProject('分组持久化')
    await store.save(project)

    const created = createGroup(project, '海边')
    const added = addAssetsToGroup(created.project, created.group.id, ['a_abcd1234'])
    await store.save(
      addAssetsToGroup(
        {
          ...added.project,
          assets: [
            {
              id: 'a_abcd1234',
              name: '海边.png',
              kind: 'image',
              mime: 'image/png',
              size: 8,
              addedAt: Date.now(),
              file: mediaKey(project.id, 'a_abcd1234', 'png'),
              groupIds: [],
            },
          ],
        },
        created.group.id,
        ['a_abcd1234'],
      ).project,
    )

    const loaded = (await store.list()).find((p) => p.id === project.id)
    expect(loaded?.groups.map((g) => g.name)).toEqual(['海边'])
    expect(loaded?.assets[0]?.groupIds).toEqual([created.group.id])
  })

  it('删除项目会连目录一起删掉', async () => {
    const project = createProject('待删除')
    await store.save(project)
    const projectDir = join(dir, 'AnyFrame', 'projects', project.id)
    await stat(projectDir)

    await store.remove(project.id)
    let gone = false
    await stat(projectDir).catch(() => {
      gone = true
    })
    expect(gone).toBe(true)
    expect((await store.list()).some((p) => p.id === project.id)).toBe(false)
  })
})
