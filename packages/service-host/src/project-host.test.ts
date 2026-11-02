import { beforeEach, afterEach, describe, it, expect } from 'vitest'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomBytes } from 'node:crypto'
import { zipSync, strToU8 } from 'fflate'
import { ServiceManager, ServiceStartInputSchema, startRpcServer } from '@anyframe/core/node'
import { ProjectServiceHost } from './index.ts'

const entry = `const fs = require('node:fs'); const path = require('node:path'); const http = require('node:http');
exports.start = async ({host, port, projectDir}) => {
 const results = {};
 for (const [name, op] of Object.entries({
   outsideRead: () => fs.readFileSync(path.join(projectDir, '../../outside.txt')),
   outsideWrite: () => fs.writeFileSync(path.join(projectDir, '../../escape.txt'), 'bad'),
   child: () => require('node:child_process').spawnSync(process.execPath, ['-v']),
   worker: () => new (require('node:worker_threads').Worker)('', {eval:true}),
 })) { try { op(); results[name] = 'allowed' } catch(e) { results[name] = e.code } }
 fs.writeFileSync(path.join(projectDir, 'own.txt'), 'inside');
 results.own = fs.readFileSync(path.join(projectDir, 'own.txt'), 'utf8');
 const server = http.createServer((req,res) => res.end(JSON.stringify(results)));
 await new Promise((resolve,reject) => { server.once('error',reject); server.listen(port,host,resolve) });
 return {port, close: () => new Promise(resolve => { server.close(resolve); server.closeAllConnections() })};
}`
const archive = (files: Record<string, string>) => Buffer.from(zipSync(Object.fromEntries(Object.entries(files).map(([name, text]) => [name, strToU8(text)])))).toString('base64')
describe('project packages', () => {
  let root: string, manager: ServiceManager, projects: ProjectServiceHost, builtin: string
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'anyframe-packages-'))
    builtin = join(root, 'builtin'); await mkdir(builtin)
    await writeFile(join(root, 'outside.txt'), 'private')
    manager = new ServiceManager()
    projects = new ProjectServiceHost(manager, { dataRoot: root, builtinRoot: builtin })
    await projects.initialize()
  })
  afterEach(async () => { await manager.stopAll(); await rm(root, { recursive: true, force: true }) })
  it('imports without executing, lists persistently and enforces project-only fs at runtime', async () => {
    await projects.importArchive('my-service', archive({ 'index.js': entry, 'wwwroot/index.html': '<h1>Hello</h1>' }))
    expect(manager.list()).toHaveLength(0)
    expect((await new ProjectServiceHost(manager, { dataRoot: root, builtinRoot: builtin }).catalog()).packages).toEqual([{ id: 'my-service', name: 'my-service', source: 'user' }])
    const info = await projects.start(ServiceStartInputSchema.parse({ name: 'my-service' }))
    const results = await (await fetch(info.urls![0]!)).json()
    expect(results).toEqual({ outsideRead: 'ERR_ACCESS_DENIED', outsideWrite: 'ERR_ACCESS_DENIED', child: 'ERR_ACCESS_DENIED', worker: 'ERR_ACCESS_DENIED', own: 'inside' })
    expect(await readFile(join(root, 'outside.txt'), 'utf8')).toBe('private')
    await manager.stop(info.id)
  })
  it('rejects traversal, Windows paths, metadata injection, missing entry and duplicate installs', async () => {
    for (const path of ['../escape.txt', 'C:/escape.txt', 'wwwroot/../escape', 'wwwroot\\escape', 'wwwroot/con.txt']) {
      await expect(projects.importArchive('bad', archive({ 'index.js': entry, 'wwwroot/index.html': 'x', [path]: 'x' }))).rejects.toThrow()
    }
    await expect(projects.importArchive('bad', archive({ 'wwwroot/index.html': 'x' }))).rejects.toThrow()
    await expect(projects.importArchive('bad', archive({ 'index.js': entry, 'wwwroot/index.html': 'x', 'service.json': '{}' }))).rejects.toThrow()
    const zip = archive({ 'project/index.js': entry, 'project/wwwroot/index.html': 'x' })
    await projects.importArchive('custom', zip)
    await expect(projects.importArchive('custom', zip)).rejects.toThrow('同名')
  })
  it('runs two packages concurrently and stopping one leaves the other accessible', async () => {
    const zip = archive({ 'index.js': entry, 'wwwroot/index.html': 'x' })
    await projects.importArchive('first', zip)
    await projects.importArchive('second', zip)
    const [first, second] = await Promise.all([
      projects.start(ServiceStartInputSchema.parse({ name: 'first' })),
      projects.start(ServiceStartInputSchema.parse({ name: 'second' })),
    ])
    expect(first.port).not.toBe(second.port)
    await manager.stop(first.id)
    expect((await fetch(second.urls![0]!)).status).toBe(200)
    await expect(fetch(first.urls![0]!)).rejects.toThrow()
  })
  it('reports invalid entry startup as crashed and can start another package afterward', async () => {
    await projects.importArchive('broken', archive({ 'index.js': 'exports.wrong = true', 'wwwroot/index.html': 'x' }))
    await expect(projects.start(ServiceStartInputSchema.parse({ name: 'broken' }))).rejects.toThrow('start(context)')
    expect(manager.list()[0]?.status).toBe('crashed')
    await projects.importArchive('valid', archive({ 'index.js': entry, 'wwwroot/index.html': 'x' }))
    expect((await projects.start(ServiceStartInputSchema.parse({ name: 'valid' }))).status).toBe('running')
  })
  it('imports beyond all former ZIP budgets through HTTP RPC', async () => {
    const files: Record<string, Uint8Array> = { 'index.js': strToU8(entry), 'wwwroot/index.html': strToU8('x'), 'large.bin': randomBytes(25 * 1024 * 1024), 'expanded.bin': new Uint8Array(41 * 1024 * 1024) }
    for (let i = 0; i < 2001; i++) files['wwwroot/files/' + i] = strToU8('x')
    const zip = Buffer.from(zipSync(files, { level: 1 })).toString('base64')
    expect(zip.length).toBeGreaterThan(32 * 1024 * 1024)
    const rpc = await startRpcServer({ host: '127.0.0.1', port: 0, token: 'test', handlers: { 'service.import': i => projects.importArchive(i.name, i.archive) } })
    try {
      const response = await fetch(rpc.url + '/rpc/service.import', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-anyframe-token': 'test' }, body: JSON.stringify({ name: 'large', archive: zip }) })
      expect(response.status).toBe(200)
      expect((await readFile(join(root, 'services/large/expanded.bin'))).length).toBe(41 * 1024 * 1024)
      expect((await projects.catalog()).packages.map(p => p.id)).toEqual(['large'])
    } finally { await rpc.close() }
  }, 60000)
  it('persists names and ordering, validates stale ordering, and deletes running services with their data', async () => {
    const zip = archive({ 'index.js': entry, 'wwwroot/index.html': 'x' })
    await projects.importArchive('first', zip); await projects.importArchive('second', zip)
    await projects.update('first', '新名称')
    await projects.reorder(['second', 'first'])
    const restored = new ProjectServiceHost(manager, { dataRoot: root, builtinRoot: builtin })
    expect((await restored.catalog()).packages.map(p => [p.id, p.name])).toEqual([['second', 'second'], ['first', '新名称']])
    await expect(projects.reorder(['first', 'first'])).rejects.toThrow('列表已变化')
    await expect(projects.update('../escape', 'x')).rejects.toThrow('无效')
    const run = await projects.start(ServiceStartInputSchema.parse({ name: 'first' }))
    await projects.remove('first')
    expect(manager.list()).toHaveLength(0)
    await expect(fetch(run.urls![0]!)).rejects.toThrow()
    await expect(readFile(join(root, 'services/first/own.txt'))).rejects.toThrow()
    expect((await restored.catalog()).packages.map(p => p.id)).toEqual(['second'])
    await projects.importArchive('first', zip)
    expect((await projects.start(ServiceStartInputSchema.parse({ name: 'first' }))).status).toBe('running')
  })
  it('discovers new built-ins from folders without a host code change and preserves data on refresh', async () => {
    await mkdir(join(builtin, 'new-default/wwwroot'), { recursive: true })
    await writeFile(join(builtin, 'new-default/index.js'), entry)
    await writeFile(join(builtin, 'new-default/wwwroot/index.html'), 'x')
    await projects.initialize()
    await writeFile(join(root, 'services/new-default/notes.json'), 'saved')
    await projects.initialize()
    expect(await readFile(join(root, 'services/new-default/notes.json'), 'utf8')).toBe('saved')
    await projects.update('new-default', '默认服务新名称')
    await projects.initialize()
    expect((await projects.catalog()).packages[0]?.name).toBe('默认服务新名称')
    await expect(projects.remove('new-default')).rejects.toThrow('不可删除')
  })
})
