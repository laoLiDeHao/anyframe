import { cp, mkdir, readdir, readFile, writeFile, rename, rm, lstat, realpath } from 'node:fs/promises'
import { join, resolve, relative, isAbsolute } from 'node:path'
import { randomUUID } from 'node:crypto'
import { unzipSync } from 'fflate'
import type { ServiceManager, ServiceInfo, ServiceStartInput, ServicePackage } from '@anyframe/core/node'
import { projectFactory } from './runner.ts'

const validId = /^[a-z0-9][a-z0-9-_]{0,63}$/
const invalid = (text: string) => Object.assign(Error(text), { code: 'VALIDATION' })
export interface ProjectHostOptions { dataRoot: string; builtinRoot: string; lanAddresses?: string[] }

async function validateTree(root: string, requireEntry = true): Promise<void> {
  if ((await lstat(root)).isSymbolicLink()) throw invalid('服务目录不允许符号链接')
  const realRoot = await realpath(root)
  async function visit(dir: string) {
    for (const item of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, item.name)
      const stat = await lstat(path)
      if (stat.isSymbolicLink()) throw invalid('服务目录不允许符号链接')
      const rel = relative(realRoot, await realpath(path))
      if (rel.startsWith('..') || isAbsolute(rel)) throw invalid('服务文件超出项目目录')
      if (stat.isDirectory()) await visit(path)
      else if (!stat.isFile() || item.name.endsWith('.node')) throw invalid('服务包仅允许普通文件，不支持原生扩展')
    }
  }
  await visit(root)
  if (requireEntry) for (const file of ['index.js', 'wwwroot/index.html']) {
    try { if (!(await lstat(join(root, file))).isFile()) throw invalid(`服务包缺少 ${file}`) }
    catch { throw invalid(`服务包缺少 ${file}`) }
  }
}

export class ProjectServiceHost {
  private readonly root: string
  private readonly starts = new Map<string, Promise<ServiceInfo>>()
  private launches: Promise<unknown> = Promise.resolve()
  constructor(private readonly manager: ServiceManager, private readonly options: ProjectHostOptions) {
    this.root = resolve(options.dataRoot, 'services')
  }
  async initialize() {
    await mkdir(this.root, { recursive: true })
    // Built-ins are deployable files. No business imports or hard-coded service IDs here.
    for (const entry of await readdir(this.options.builtinRoot, { withFileTypes: true })) {
      if (!entry.isDirectory() || !validId.test(entry.name)) continue
      const source = join(this.options.builtinRoot, entry.name)
      await validateTree(source)
      const target = join(this.root, entry.name)
      await mkdir(target, { recursive: true })
      await validateTree(target, false)
      try {
        const previous = JSON.parse(await readFile(join(target, 'service.json'), 'utf8'))
        if (previous.source === 'user') throw invalid(`默认服务与用户服务重名: ${entry.name}`)
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
      // Only code/static assets are refreshed. Runtime data stays in this project directory.
      for (const file of await readdir(source)) {
        if (file === 'data' || file === 'service.json') throw invalid('默认服务包不得包含运行数据或宿主元数据')
        await cp(join(source, file), join(target, file), { recursive: true, force: true })
      }
      await writeFile(join(target, 'service.json'), JSON.stringify({ id: entry.name, name: entry.name, source: 'builtin' }))
    }
  }
  async catalog(): Promise<{ packages: ServicePackage[] }> {
    const packages: ServicePackage[] = []
    for (const entry of await readdir(this.root, { withFileTypes: true })) {
      if (!entry.isDirectory() || !validId.test(entry.name)) continue
      try {
        const info = JSON.parse(await readFile(join(this.root, entry.name, 'service.json'), 'utf8'))
        if (info.id === entry.name && ['builtin', 'user'].includes(info.source)) packages.push({ id: entry.name, name: String(info.name), source: info.source })
      } catch { /* Incomplete installs and legacy data-only directories aren't runnable. */ }
    }
    return { packages }
  }
  async start(input: ServiceStartInput): Promise<ServiceInfo> {
    const id = input.template ?? input.name
    const pending = this.starts.get(id)
    if (pending) return pending
    // Serialize allocation through listen, so simultaneous services cannot probe the same port.
    const work = this.launches.then(async () => {
      if (!validId.test(id) || !(await this.catalog()).packages.some(p => p.id === id)) throw Object.assign(Error('服务包不存在，请先导入'), { code: 'NOT_FOUND' })
      const active = this.manager.list().find(s => s.name === id && ['starting', 'running', 'stopping'].includes(s.status))
      if (active) return active
      const dir = join(this.root, id)
      await validateTree(dir)
      return this.manager.start({ ...input, name: id, command: undefined }, projectFactory(await realpath(dir), this.options.lanAddresses))
    })
    this.launches = work.catch(() => {})
    this.starts.set(id, work)
    try { return await work } finally { this.starts.delete(id) }
  }
  async importArchive(name: string, archive: string): Promise<ServicePackage> {
    if (!validId.test(name)) throw invalid('服务名称只能包含小写字母、数字、连字符和下划线')
    const bytes = Buffer.from(archive, 'base64')
    if (bytes.length === 0 || bytes.length > 20 * 1024 * 1024) throw invalid('ZIP 文件需小于 20 MB')
    let total = 0, count = 0
    const files = unzipSync(bytes, { filter(file) {
      count++; total += file.originalSize
      if (count > 2000 || total > 64 * 1024 * 1024 || file.originalSize > 16 * 1024 * 1024) throw invalid('ZIP 解压大小或文件数量超限')
      const parts = file.name.replace(/\/$/, '').split('/')
      if (parts.some(part => !part || part === '.' || part === '..' || /[\\:<>"|?*\x00-\x1f]/.test(part) || /[. ]$/.test(part) || /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\.|$)/i.test(part))) throw invalid('ZIP 包含不安全路径')
      return true
    } })
    // Accept either root files or one enclosing project directory.
    const entries = Object.keys(files).filter(file => !file.endsWith('/'))
    const prefix = entries.includes('index.js') ? '' : entries[0]?.split('/')[0] + '/'
    if (!entries.every(file => file.startsWith(prefix))) throw invalid('ZIP 必须只包含一个项目目录')
    const target = join(this.root, name)
    try { await lstat(target); throw invalid('同名服务已存在，请换一个名称') }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    const stage = join(this.root, `.import-${randomUUID()}`)
    await mkdir(stage)
    try {
      for (const file of entries) {
        const path = file.slice(prefix.length)
        if (path === 'service.json' || path.startsWith('data/')) throw invalid('ZIP 不得包含宿主元数据或运行数据')
        const output = join(stage, path)
        await mkdir(resolve(output, '..'), { recursive: true })
        await writeFile(output, files[file]!)
      }
      await validateTree(stage)
      const info: ServicePackage = { id: name, name, source: 'user' }
      await writeFile(join(stage, 'service.json'), JSON.stringify(info))
      await rename(stage, target)
      return info
    } finally { await rm(stage, { recursive: true, force: true }) }
  }
}
