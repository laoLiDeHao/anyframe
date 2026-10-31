import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, mkdir, rm, cp } from 'node:fs/promises'
import { resolve, join, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { once } from 'node:events'
import { setTimeout as delay } from 'node:timers/promises'

const repo = resolve(fileURLToPath(new URL('../../../', import.meta.url)))
const require = createRequire(join(repo, 'services/package.json'))
const { WebSocket } = require('ws')
const bundle = join(repo, 'apps/mobile/android/app/src/main/assets/node-runtime/bootstrap.cjs')

test('Android Node bundle: authenticated RPC, scoped fs, Express CRUD, WS and restart persistence', { timeout: 25000 }, async () => {
  const parent = join(repo, 'build-output/node-host-test')
  await mkdir(parent, { recursive: true })
  const root = await mkdtemp(join(parent, 'run-'))
  let child
  const sockets = []
  const token = 'test-native-bridge-token'
  let rpcUrl
  async function launch() {
    await cp(join(repo, 'services/builtin'), join(root, 'node-runtime/services'), { recursive: true })
    const ready = join(root, 'node-ready.json')
    await rm(ready, { force: true })
    child = spawn(process.execPath, [bundle, root, ready, token, '0.0.2', '["192.0.2.1"]'], { stdio: ['ignore', 'ignore', 'pipe'] })
    let errors = ''
    child.stderr.on('data', data => { errors += data })
    for (let i = 0; i < 100; i++) {
      if (child.exitCode !== null) throw Error(`Node startup failed: ${errors}`)
      try {
        const state = JSON.parse(await readFile(ready, 'utf8'))
        assert.equal(state.token, token)
        rpcUrl = state.url
        return
      } catch { await delay(50) }
    }
    throw Error(`Node startup timed out: ${errors}`)
  }
  async function rpc(method, input = null, auth = token) {
    const response = await fetch(`${rpcUrl}/rpc/${method}`, { method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-AnyFrame-Token': auth, Origin: 'https://localhost' }, body: JSON.stringify(input) })
    return { status: response.status, body: await response.json() }
  }
  async function terminate() {
    if (child && child.exitCode === null) { const exited = once(child, 'exit'); child.kill(); await exited }
  }
  try {
    await launch()
    assert.equal((await rpc('service.list', null, 'wrong')).status, 401)
    const capability = await rpc('capabilities.get')
    assert.equal(capability.body.ok, true, JSON.stringify(capability.body))
    const caps = capability.body.data
    assert.equal(caps.platform, 'android')
    assert.deepEqual(caps.serviceTemplates, ['express-demo'])
    assert.equal((await rpc('fs.list', { path: '..' })).status, 403)
    assert.equal((await rpc('service.start', { name: 'external', command: 'node' })).status, 404)
    const started = await rpc('service.start', { name: 'express-demo', template: 'express-demo', host: '0.0.0.0' })
    assert.equal(started.body.ok, true, JSON.stringify(started.body))
    const service = started.body.data
    assert.ok(service.urls.includes(`http://192.0.2.1:${service.port}`))
    const url = `http://127.0.0.1:${service.port}`
    assert.match(await (await fetch(url)).text(), /WebSocket|聊天室/)
    const created = await (await fetch(url + '/api/notes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: '中文笔记验证' }) })).json()
    const a = new WebSocket(url.replace('http:', 'ws:') + '/ws')
    const b = new WebSocket(url.replace('http:', 'ws:') + '/ws')
    sockets.push(a, b)
    await Promise.all([once(a, 'open'), once(b, 'open')])
    const received = once(b, 'message')
    a.send(JSON.stringify({ name: '手机', text: '内嵌 Node 测试' }))
    assert.equal(JSON.parse(String((await received)[0])).text, '内嵌 Node 测试')
    const closed = Promise.all(sockets.map(socket => once(socket, 'close')))
    assert.equal((await rpc('service.stop', { id: service.id })).body.ok, true)
    await closed
    await assert.rejects(fetch(url + '/healthz'))
    await terminate()
    await launch()
    const again = (await rpc('service.start', { name: 'express-demo', template: 'express-demo' })).body.data
    const notes = await (await fetch(`http://127.0.0.1:${again.port}/api/notes`)).json()
    assert.ok(JSON.stringify(notes).includes('中文笔记验证'), JSON.stringify({ created, notes }))
  } finally {
    for (const socket of sockets) socket.terminate()
    await terminate()
    if (!root.startsWith(parent + sep)) throw Error('Unexpected cleanup path')
    await rm(root, { recursive: true, force: true })
  }
})
