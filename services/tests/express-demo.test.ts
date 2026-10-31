import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WebSocket } from 'ws'
import { z } from 'zod'
import { ServiceManager } from '../../packages/core/src/runtime/services.ts'
import { ProjectServiceHost } from '../../packages/service-host/src/index.ts'
import { fileURLToPath } from 'node:url'
import { ServiceStartInputSchema } from '../../packages/core/src/contract.ts'

describe('built-in Express HTTP / WS service', () => {
  let root: string, manager: ServiceManager, base: string, id: string, projects: ProjectServiceHost
  const input = ServiceStartInputSchema.parse({ name: 'express-demo', template: 'express-demo' })
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'anyframe-express-'))
    manager = new ServiceManager()
    projects = new ProjectServiceHost(manager, { dataRoot: root, builtinRoot: fileURLToPath(new URL('../builtin', import.meta.url)) })
    await projects.initialize()
    const info = await projects.start(input)
    id = info.id; base = info.urls![0]!
  })
  afterEach(async () => { await manager.stopAll(); await rm(root, { recursive: true, force: true }) })
  async function api(path = '', method = 'GET', body?: unknown) {
    const r = await fetch(base + '/api/notes' + path, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
    return { status: r.status, data: await r.json() }
  }
  it('serves a page, CRUD, concurrent writes and persistent notes after restart', async () => {
    expect((await fetch(base)).status).toBe(200)
    expect(await (await fetch(base + '/healthz')).json()).toEqual({ ok: true })
    expect((await api('', 'POST', { text: 'hello' })).status).toBe(201)
    const note = z.array(z.object({ id: z.string(), text: z.string() })).parse((await api()).data)[0]!
    expect((await api('/' + note.id, 'PUT', { text: 'edited' })).status).toBe(200)
    expect((await api()).data).toEqual([{ ...note, text: 'edited' }])
    await Promise.all(['one', 'two', 'three'].map(text => api('', 'POST', { text })))
    expect((await api()).data).toHaveLength(4)
    await manager.stop(id)
    const next = await projects.start(input)
    base = next.urls![0]!
    expect((await api()).data).toHaveLength(4)
    expect((await api('/' + note.id, 'DELETE')).status).toBe(200)
    expect((await api()).data).toHaveLength(3)
  })
  it('rejects invalid input, unknown notes and cross-origin writes', async () => {
    expect((await api('', 'POST', { text: ' ' })).status).toBe(400)
    expect((await api('', 'POST', { text: 'a'.repeat(2001) })).status).toBe(400)
    expect((await api('/missing', 'DELETE')).status).toBe(404)
    expect((await fetch(base + '/api/notes', { method: 'POST', headers: { origin: 'http://evil.invalid', 'content-type': 'application/json' }, body: '{"text":"bad"}' })).status).toBe(403)
    expect((await api()).data).toEqual([])
  })
  it('broadcasts WS messages to both clients and stops active connections', async () => {
    const a = new WebSocket(base.replace('http:', 'ws:') + '/ws')
    const b = new WebSocket(base.replace('http:', 'ws:') + '/ws')
    const open = (ws: WebSocket) => new Promise<void>((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject) })
    try {
      await Promise.all([open(a), open(b)])
      const receive = (ws: WebSocket) => new Promise(resolve => ws.once('message', data => resolve(JSON.parse(data.toString()))))
      const received = Promise.all([receive(a), receive(b)])
      a.send('invalid json')
      a.send(JSON.stringify({ name: 'Alice', text: 'hello websocket' }))
      expect(await received).toEqual([{ name: 'Alice', text: 'hello websocket' }, { name: 'Alice', text: 'hello websocket' }])
      const closed = Promise.all([a, b].map(ws => new Promise(resolve => ws.once('close', resolve))))
      await manager.stop(id)
      await closed
      await manager.stop(id)
      await expect(fetch(base + '/healthz')).rejects.toThrow()
    } finally { a.terminate(); b.terminate() }
  })
  it('deduplicates repeated starts and exposes logs only after actual listening', async () => {
    const [a, b] = await Promise.all([projects.start(input), projects.start(input)])
    expect(a.id).toBe(id); expect(b.id).toBe(id)
    expect(manager.list()).toHaveLength(1)
    expect(manager.logs(id, 10).some(l => l.text.includes('Express 示例就绪'))).toBe(true)
    expect((await fetch(base + '/healthz')).status).toBe(200)
  })
})
