import type { RpcClient } from '@anyframe/core'
import { BrowserStore } from './browser-store.ts'
import { DiskStore } from './disk-store.ts'
import { PROJECTS_DIR, type MediaStore } from './store.ts'

/**
 * 选一个能用的存储实现。
 *
 * 判定顺序：
 *   1. 没有本地服务          → IndexedDB（Web 无 Agent / 移动端服务没起来）
 *   2. 有服务但 fs.* 不可用  → IndexedDB（移动端原生侧目前只实现了
 *                              capabilities.get，这是已知待修项）
 *   3. 其余                  → 磁盘
 *
 * 为什么第 2 步要真的调一次而不是看 capabilities：能力表描述的是「平台能不能」，
 * 而 fs.* 是「宿主实现了没有」，两者不是一回事。探一次是唯一可靠的判断，
 * 代价只有一次请求，换来的是「不会打开应用就看到一堆打不开的素材」。
 */
export interface StorePick {
  store: MediaStore
  warnings: string[]
}

function message(err: unknown): string {
  if (typeof err === 'object' && err !== null && 'message' in err) {
    return String((err as { message: unknown }).message)
  }
  return String(err)
}

export async function createMediaStore(client: RpcClient | null): Promise<StorePick> {
  if (!client) {
    return {
      store: new BrowserStore(),
      warnings: [
        '未连接本地服务，素材暂存在当前设备的浏览器数据库里；' +
          '不会写入磁盘目录，也不会出现在别的设备上。',
      ],
    }
  }

  const store = new DiskStore(client)
  try {
    // 目录不存在是正常的（还没建过项目），只有真正的「不支持」才降级
    await client.call('fs.list', { path: PROJECTS_DIR })
    return { store, warnings: [] }
  } catch (err) {
    if (isNotFoundLike(err)) return { store, warnings: [] }
    return {
      store: new BrowserStore(),
      warnings: [
        `本地服务当前不支持文件读写（${message(err)}），已降级为浏览器本地存储。` +
          '素材不会出现在项目目录里，重装应用前请先导出。',
      ],
    }
  }
}

function isNotFoundLike(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false
  const code = (err as { code?: unknown }).code
  return code === 'NOT_FOUND'
}
