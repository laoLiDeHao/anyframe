import { extensionOf, formatBytes, kindOf, newId, resolveMime } from '../model/media.ts'
import type { Asset, Project } from '../model/types.ts'
import { mediaKey, thumbKey, type MediaStore } from './store.ts'
import { makeThumbnail } from './thumbnail.ts'

/**
 * ─────────────────────────────────────────────────────────────
 * 导入管线：File → 磁盘 + 元数据
 * ─────────────────────────────────────────────────────────────
 * 顺序是有讲究的：
 *
 *   1. 校验大小（超限直接跳过并**记名**，不静默丢）
 *   2. 写 media/（先落文件）
 *   3. 图片再生缩略图写 thumbs/
 *   4. 最后才把元数据交给调用方写进 project.json
 *
 * 反过来的话，一旦写文件失败，索引里就留下一条指向不存在文件的记录 ——
 * 那种项目打开后是一堆破图，而且删不掉（删的时候又找不到文件）。
 *
 * 串行而不是并发：移动端同时解码 8 张 12MP 图片会 OOM，
 * 而且 OOM 发生在 WebView 里，日志什么都看不到。
 */

/** 单文件上限。fs.write 的请求体上限是 32MB，base64 放大 4/3 后留出的余量。 */
export const MAX_IMPORT_BYTES = 16 * 1024 * 1024

const MIME_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/avif': 'avif',
  'image/bmp': 'bmp',
  'image/heic': 'heic',
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
  'video/webm': 'webm',
  'video/x-matroska': 'mkv',
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
  'audio/aac': 'aac',
  'audio/wav': 'wav',
  'audio/flac': 'flac',
  'audio/ogg': 'ogg',
}

function extensionFor(name: string, mime: string): string {
  return extensionOf(name) || MIME_EXT[mime] || 'bin'
}

export interface ImportProgress {
  total: number
  done: number
  /** 正在处理的文件名，用于「3 / 12 · 海边.jpg」 */
  name: string
}

export interface SkippedFile {
  name: string
  reason: string
}

export interface ImportResult {
  assets: Asset[]
  skipped: SkippedFile[]
}

export async function importFiles(opts: {
  store: MediaStore
  projectId: string
  files: readonly File[]
  onProgress?: (p: ImportProgress) => void
}): Promise<ImportResult> {
  const { store, projectId, files, onProgress } = opts
  const assets: Asset[] = []
  const skipped: SkippedFile[] = []

  for (let i = 0; i < files.length; i += 1) {
    const file = files[i]
    if (!file) continue
    onProgress?.({ total: files.length, done: i, name: file.name })

    if (file.size > MAX_IMPORT_BYTES) {
      skipped.push({
        name: file.name,
        reason: `超过 ${formatBytes(MAX_IMPORT_BYTES)} 上限（${formatBytes(file.size)}）`,
      })
      continue
    }

    const mime = resolveMime(file.type, file.name)
    const kind = kindOf(mime, file.name)
    const assetId = newId('a')
    const fileKey = mediaKey(projectId, assetId, extensionFor(file.name, mime))

    try {
      const bytes = new Uint8Array(await file.arrayBuffer())
      await store.putFile(fileKey, bytes)

      let thumb: string | undefined
      if (kind === 'image') {
        const thumbBytes = await makeThumbnail(file)
        if (thumbBytes) {
          const key = thumbKey(projectId, assetId)
          await store.putFile(key, thumbBytes)
          thumb = key
        }
      }

      assets.push({
        id: assetId,
        name: file.name,
        kind,
        mime,
        size: file.size,
        addedAt: Date.now(),
        file: fileKey,
        ...(thumb ? { thumb } : {}),
        groupIds: [],
      })
    } catch (err) {
      // 单个文件失败不影响其余文件；已经写进去的文件尽力清掉
      await store.removeFiles([fileKey])
      skipped.push({
        name: file.name,
        reason: err instanceof Error ? err.message : String(err),
      })
    }
  }

  onProgress?.({ total: files.length, done: files.length, name: '' })
  return { assets, skipped }
}

/** 素材对应的全部文件，删除素材时用 */
export function filesOf(assets: readonly Asset[]): string[] {
  const keys: string[] = []
  for (const a of assets) {
    keys.push(a.file)
    if (a.thumb) keys.push(a.thumb)
  }
  return keys
}

/** 给界面用的一行摘要：跳过了几个、为什么 */
export function describeSkips(skipped: readonly SkippedFile[]): string | null {
  if (skipped.length === 0) return null
  const head = skipped
    .slice(0, 3)
    .map((s) => `${s.name}（${s.reason}）`)
    .join('；')
  return skipped.length > 3
    ? `${skipped.length} 个文件未导入：${head} 等`
    : `${skipped.length} 个文件未导入：${head}`
}

/**
 * 打开系统的媒体选择器。
 *
 * 手机上这正是「访问媒体资源库后选择上传」的实现：WebView 的 file input
 * 在 Android 上唤起系统照片 / 文件选择器，在 iOS 上是照片图库，
 * 不需要任何额外原生插件，也不需要申请存储权限。
 *
 * 用 input 元素而不是 showOpenFilePicker：后者在 Android WebView 上不存在。
 */
export function pickMediaFiles(accept = 'image/*,video/*,audio/*'): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = accept
    input.multiple = true
    input.style.display = 'none'

    let settled = false
    const finish = (files: File[]) => {
      if (settled) return
      settled = true
      input.remove()
      resolve(files)
    }

    input.addEventListener('change', () => {
      finish(input.files ? [...input.files] : [])
    })
    // 用户按返回键 / 点取消时不会触发 change，只会触发 cancel。
    // 不支持 cancel 事件的老 WebView 上这个 Promise 会一直挂着 ——
    // 无副作用（没有定时器、没有监听 window），比用 focus 事件猜时间可靠得多。
    input.addEventListener('cancel', () => finish([]))

    document.body.appendChild(input)
    input.click()
  })
}
