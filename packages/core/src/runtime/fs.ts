import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, resolve, sep } from 'node:path'
import { ErrCode } from '../contract.ts'
import type {
  FsEntry,
  FsListInput,
  FsProvider,
  FsReadInput,
  FsRemoveInput,
  FsWriteInput,
} from '../contract.ts'

/**
 * 文件系统实现（Node 宿主：Electron 主进程 / Agent）。
 *
 * 关键安全点：allowedRoots 限制可访问范围。
 * 桌面端可以放开为用户主目录或整个磁盘，但 Agent 模式务必收紧 ——
 * Agent 暴露在本机端口上，任何拿到 token 的网页都能读写文件。
 */

export interface FsProviderOptions {
  /** 允许访问的根目录白名单。为空表示不限制（仅建议桌面端使用） */
  allowedRoots?: string[]
  /** 单文件读取上限，默认 64MB */
  maxReadBytes?: number
}

function httpError(code: string, message: string): Error {
  return Object.assign(new Error(message), { code })
}

const IS_WIN = process.platform === 'win32'

function withTrailingSep(p: string): string {
  return p.endsWith(sep) ? p : p + sep
}

/**
 * FsProvider 接口定义在 contract.ts（浏览器安全层），
 * 这里只是为了让 Node 宿主的导入路径保持顺手而转出一次。
 * 移动端 apps/mobile/src/native/fs.ts 实现的也是同一个接口。
 */
export type { FsProvider }

export class NodeFsProvider implements FsProvider {
  private readonly roots: string[]
  /**
   * 白名单的「比较形态」：统一补上尾分隔符，Windows 下再小写化。
   * 预先算好，避免每次请求都重复做字符串处理。
   */
  private readonly guardRoots: string[]
  private readonly maxReadBytes: number

  constructor(opts: FsProviderOptions = {}) {
    this.roots = (opts.allowedRoots ?? []).map((r) => resolve(r))
    this.guardRoots = this.roots.map((r) => withTrailingSep(IS_WIN ? r.toLowerCase() : r))
    this.maxReadBytes = opts.maxReadBytes ?? 64 * 1024 * 1024
  }

  /**
   * 解析成绝对路径，并确认落在白名单内。
   *
   * ⚠️ 相对路径的基准是 **第一个 allowedRoot**，不是 process.cwd()。
   * 用 cwd 当基准有两个实际问题：
   *   1. Agent 的 cwd 取决于用户怎么启动它 —— 双击快捷方式、在某个目录
   *      下敲命令、被 systemd / 计划任务拉起，三种情况完全不同。
   *      同一个请求会时而成功时而 PERMISSION_DENIED，几乎无法排查。
   *   2. Web 端根本无从得知 cwd，它只知道 dataRoot。发 'notes/a.txt'
   *      这种相对路径才是前端的自然写法，却会被解析到宿主进程的 cwd 上
   *      然后拒绝 —— 表现为「文件管理页面永远是空的」。
   *
   * Windows 下比较必须忽略大小写：用户用 --data-root=C:\Users\X 启动，
   * 网页发来 c:\users\x\a.txt，大小写敏感比较会把它误判成越界。
   * 8.3 短名（C:\Users\FLAMBE~1）与长名不等价，那属于另一层问题，
   * 由调用方统一传长名规避。
   */
  private assertAllowed(rawPath: string): string {
    const primary = this.roots[0]
    const abs =
      !isAbsolute(rawPath) && primary ? resolve(primary, rawPath) : resolve(rawPath)

    if (this.guardRoots.length === 0) return abs

    // 补尾分隔符后再 startsWith：既覆盖「正好等于根目录」，
    // 又不会把 C:\data-evil 误判成 C:\data 的子路径
    const target = withTrailingSep(IS_WIN ? abs.toLowerCase() : abs)
    const ok = this.guardRoots.some((root) => target.startsWith(root))
    if (!ok) {
      throw httpError(ErrCode.PERMISSION_DENIED, `路径不在允许范围内: ${abs}`)
    }
    return abs
  }

  async read(input: FsReadInput) {
    const path = this.assertAllowed(input.path)
    const info = await stat(path).catch(() => {
      throw httpError(ErrCode.NOT_FOUND, `文件不存在: ${path}`)
    })
    if (info.isDirectory()) {
      throw httpError(ErrCode.VALIDATION, `目标是目录: ${path}`)
    }

    const length = input.length ?? info.size
    if (length > this.maxReadBytes) {
      throw httpError(
        ErrCode.VALIDATION,
        `读取长度 ${length} 超过上限 ${this.maxReadBytes}，请分片读取`,
      )
    }

    const buf = await readFile(path)
    const offset = input.offset ?? 0
    const slice = buf.subarray(offset, offset + length)
    const data =
      input.encoding === 'utf8'
        ? slice.toString('utf8')
        : slice.toString('base64')

    return {
      path,
      data,
      size: info.size,
      truncated: offset + slice.length < info.size,
    }
  }

  async write(input: FsWriteInput) {
    const path = this.assertAllowed(input.path)
    if (input.createDirs) await mkdir(dirname(path), { recursive: true })

    const buf = Buffer.from(input.data, input.encoding === 'base64' ? 'base64' : 'utf8')

    if (input.atomic) {
      // 先写临时文件再 rename，避免进程被杀时留下半个文件
      const tmp = `${path}.tmp-${process.pid}-${Date.now()}`
      await writeFile(tmp, buf)
      await rename(tmp, path)
    } else {
      await writeFile(path, buf)
    }

    return { path, bytesWritten: buf.byteLength }
  }

  async list(input: FsListInput): Promise<{ entries: FsEntry[] }> {
    const path = this.assertAllowed(input.path)
    const out: FsEntry[] = []

    const walk = async (dir: string, depth: number): Promise<void> => {
      if (depth > 8) return // 防御性深度上限
      const items = await readdir(dir, { withFileTypes: true }).catch(() => {
        throw httpError(ErrCode.NOT_FOUND, `目录不存在: ${dir}`)
      })
      for (const item of items) {
        const full = resolve(dir, item.name)
        const s = await stat(full).catch(() => null)
        if (!s) continue
        out.push({
          name: item.name,
          path: full,
          isDir: item.isDirectory(),
          size: s.size,
          mtime: s.mtimeMs,
        })
        if (item.isDirectory() && input.recursive) await walk(full, depth + 1)
      }
    }

    await walk(path, 0)
    return { entries: out }
  }

  async remove(input: FsRemoveInput): Promise<void> {
    const path = this.assertAllowed(input.path)
    await rm(path, { recursive: input.recursive, force: false }).catch((err) => {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        throw httpError(ErrCode.NOT_FOUND, `路径不存在: ${path}`)
      }
      throw err
    })
  }
}
