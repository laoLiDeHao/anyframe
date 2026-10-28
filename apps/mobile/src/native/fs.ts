import { Directory, Filesystem } from '@capacitor/filesystem'
import {
  ErrCode,
  type FsEntry,
  type FsListInput,
  type FsProvider,
  type FsReadInput,
  type FsRemoveInput,
  type FsWriteInput,
} from '@anyframe/core'

/**
 * ─────────────────────────────────────────────────────────────
 * CapacitorFsProvider —— FsProvider 的移动端实现
 * ─────────────────────────────────────────────────────────────
 * 与 NodeFsProvider 实现同一个接口（定义在 @anyframe/core 的
 * contract.ts，纯类型 + zod，不含任何 node:* 依赖），
 * 因此五端的 fs.* 方法签名、错误码、默认值完全一致。
 *
 * ── 平台限制（写代码前必须知道的三件事）──────────────────
 * 1. 没有绝对路径。所有 path 都是相对于某个 Directory 的相对路径。
 *    iOS 是严格沙箱；Android 自 10 起是分区存储，
 *    Directory.External 也只是「应用专属外部目录」，
 *    不是 /sdcard。要访问任意目录得申请 MANAGE_EXTERNAL_STORAGE，
 *    Google Play 审核极严，默认不开。
 *
 * 2. 不支持分片读。readFile 只能整文件读，offset/length 要在
 *    读完之后自己切。所以这里设了一个比桌面端低得多的上限 ——
 *    base64 字符串进 WebView 堆，32MB 文件会变成 ~43MB 字符串，
 *    低端机直接 OOM 崩溃，而且崩在原生侧，日志里什么都看不到。
 *
 * 3. readFile 不传 encoding 时返回 base64（原生侧行为），
 *    传 Encoding.UTF8 才返回文本。别想当然。
 */

/** 移动端单文件读取上限。桌面端是 64MB，这里必须收紧，理由见上。 */
const MAX_READ_BYTES = 16 * 1024 * 1024

/**
 * 允许访问的目录白名单。超出即 PERMISSION_DENIED。
 * 类型必须是 Directory 而不是 string —— Capacitor 的 API 签名
 * 收的是枚举，传裸字符串编译不过（枚举不接受 string 反向赋值）。
 */
const ALLOWED_DIRS: Directory[] = [
  Directory.Data,
  Directory.Documents,
  Directory.Cache,
  Directory.External,
]

function rpcError(code: string, message: string): Error {
  return Object.assign(new Error(message), { code })
}

/**
 * 规范化并校验相对路径。
 * 拦两种越界：以 / 开头的绝对路径，以及含 .. 的上跳。
 * Capacitor 原生侧对 .. 的处理在各版本并不一致，不能依赖它兜底。
 */
function assertPath(rawPath: string, directory: Directory): string {
  if (!ALLOWED_DIRS.includes(directory)) {
    throw rpcError(ErrCode.PERMISSION_DENIED, `目录不被允许: ${directory}`)
  }
  if (rawPath.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(rawPath)) {
    throw rpcError(
      ErrCode.PERMISSION_DENIED,
      `移动端不支持绝对路径（${rawPath}）。请传相对于应用目录的路径。`,
    )
  }
  const segments = rawPath.split(/[\\/]/)
  if (segments.some((s) => s === '..')) {
    throw rpcError(ErrCode.PERMISSION_DENIED, `路径不得包含 ..（${rawPath}）`)
  }
  return segments.filter(Boolean).join('/')
}

function utf8ByteLength(text: string): number {
  return new TextEncoder().encode(text).byteLength
}

function base64ByteLength(b64: string): number {
  const padding = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0
  return Math.floor((b64.length * 3) / 4) - padding
}

export interface CapacitorFsProviderOptions {
  /** 默认目录，调用方不传 directory 时使用 */
  defaultDirectory?: Directory
}

export class CapacitorFsProvider implements FsProvider {
  private readonly defaultDir: Directory

  constructor(opts: CapacitorFsProviderOptions = {}) {
    this.defaultDir = opts.defaultDirectory ?? Directory.Data
  }

  /**
   * 从 "documents:notes/a.md" 这种带目录前缀的路径里拆出 directory。
   * 契约里的 FsReadInput.path 只有一个字符串字段，
   * 移动端需要额外携带目录信息，用前缀是最不破坏契约的做法。
   */
  private split(input: { path: string }): { path: string; directory: Directory } {
    const m = /^([a-zA-Z]+):(.*)$/.exec(input.path)
    if (!m?.[1] || m[2] === undefined) {
      return { path: assertPath(input.path, this.defaultDir), directory: this.defaultDir }
    }
    const prefix = m[1].toUpperCase()
    const known = ALLOWED_DIRS.find((d) => d.toUpperCase() === prefix)
    if (!known) {
      throw rpcError(ErrCode.PERMISSION_DENIED, `未知目录前缀: ${m[1]}`)
    }
    return { path: assertPath(m[2], known), directory: known }
  }

  async read(input: FsReadInput) {
    const { path, directory } = this.split(input)

    const info = await Filesystem.stat({ path, directory }).catch(() => {
      throw rpcError(ErrCode.NOT_FOUND, `文件不存在: ${directory}/${path}`)
    })
    if (info.type === 'directory') {
      throw rpcError(ErrCode.VALIDATION, `目标是目录: ${path}`)
    }
    if (info.size > MAX_READ_BYTES) {
      throw rpcError(
        ErrCode.VALIDATION,
        `文件 ${info.size} 字节超过移动端读取上限 ${MAX_READ_BYTES}。` +
          '请在桌面端处理，或先分卷。',
      )
    }

    // 一律按 base64 读，再在 JS 侧解码 —— 这样 offset/length 才有意义，
    // 也避免二进制文件被当成 UTF-8 文本读成乱码。
    const res = await Filesystem.readFile({ path, directory })
    const b64 = typeof res.data === 'string' ? res.data : ''

    const raw = base64ToBytes(b64)
    const offset = input.offset ?? 0
    const length = input.length ?? Math.max(0, raw.byteLength - offset)
    const slice = raw.subarray(offset, offset + length)

    return {
      path: `${directory}:${path}`,
      data:
        input.encoding === 'utf8'
          ? new TextDecoder().decode(slice)
          : bytesToBase64(slice),
      size: raw.byteLength,
      truncated: offset + slice.byteLength < raw.byteLength,
    }
  }

  async write(input: FsWriteInput) {
    const { path, directory } = this.split(input)

    if (input.createDirs) {
      const parent = path.split('/').slice(0, -1).join('/')
      if (parent) {
        await Filesystem.mkdir({ path: parent, directory, recursive: true }).catch(() => {
          // 目录已存在时原生侧会抛错，这里吞掉即可
        })
      }
    }

    // Capacitor 的 writeFile 在原生侧就是「写临时文件 + rename」，
    // 所以 input.atomic 不需要额外处理；但契约里有这个字段，
    // 显式忽略比悄悄改变语义更好。
    const data =
      input.encoding === 'base64'
        ? input.data
        : bytesToBase64(new TextEncoder().encode(input.data))

    await Filesystem.writeFile({
      path,
      directory,
      data,
      recursive: input.createDirs,
    })

    return {
      path: `${directory}:${path}`,
      bytesWritten:
        input.encoding === 'base64' ? base64ByteLength(input.data) : utf8ByteLength(input.data),
    }
  }

  async list(input: FsListInput): Promise<{ entries: FsEntry[] }> {
    const { path, directory } = this.split(input)
    const out: FsEntry[] = []

    const walk = async (dir: string, depth: number): Promise<void> => {
      if (depth > 6) return // 移动端目录树浅，6 层足够，同时防递归爆栈
      const res = await Filesystem.readdir({ path: dir, directory }).catch(() => {
        throw rpcError(ErrCode.NOT_FOUND, `目录不存在: ${directory}/${dir}`)
      })

      for (const entry of res.files) {
        // Capacitor 6 起 readdir 返回 FileInfo 对象（含 type/size/mtime），
        // 不再是纯字符串数组。本项目锁 Capacitor 8，按对象处理。
        const full = dir ? `${dir}/${entry.name}` : entry.name
        const isDir = entry.type === 'directory'

        out.push({
          name: entry.name,
          path: `${directory}:${full}`,
          isDir,
          size: entry.size ?? 0,
          mtime: entry.mtime ?? 0,
        })

        if (isDir && input.recursive) await walk(full, depth + 1)
      }
    }

    await walk(path, 0)
    return { entries: out }
  }

  async remove(input: FsRemoveInput): Promise<void> {
    const { path, directory } = this.split(input)
    await Filesystem.deleteFile({ path, directory }).catch((err) => {
      const msg = String((err as Error)?.message ?? err)
      if (/not exist|ENOENT|no such file/i.test(msg)) {
        throw rpcError(ErrCode.NOT_FOUND, `路径不存在: ${directory}/${path}`)
      }
      throw err
    })
  }
}

// ── base64 编解码 ───────────────────────────────────────────
// 不能用 Buffer（移动端没有 Node），也不能只用 atob/btoa
// （它们只处理 Latin-1，遇到多字节 UTF-8 会错位）。

function base64ToBytes(b64: string): Uint8Array {
  const clean = b64.replace(/^data:[^,]*,/, '')
  const binary = atob(clean)
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
  return out
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  // 分块拼接，避免 String.fromCharCode(...大数组) 触发参数个数上限
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(binary)
}
