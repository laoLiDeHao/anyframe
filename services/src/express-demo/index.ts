import express from 'express'
import { WebSocketServer, WebSocket } from 'ws'
import { createServer } from 'node:http'
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'

const noteSchema = z.object({ id: z.string(), text: z.string().min(1).max(2000) })
const contentSchema = noteSchema.pick({ text: true }).extend({ text: z.string().trim().min(1).max(2000) })
const chatSchema = z.object({ name: z.string().trim().max(20), text: z.string().trim().min(1).max(500) })

export async function start({ host, port, log, projectDir, publicDir }: { host: string; port: number; log: (text: string) => void; projectDir: string; publicDir: string }) {
    const dir = projectDir
    await mkdir(dir, { recursive: true })
    const file = join(dir, 'notes.json')
    let notes: z.infer<typeof noteSchema>[] = []
    try { notes = z.array(noteSchema).max(1000).parse(JSON.parse(await readFile(file, 'utf8'))) }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    let pending = Promise.resolve()
    const app = express()
    app.disable('x-powered-by')
    app.use((req, res, next) => {
      const origin = req.headers.origin
      if (origin) {
        try { if (new URL(origin).host !== req.headers.host) { res.status(403).json({ error: '不允许跨站请求' }); return } }
        catch { res.status(403).json({ error: '无效来源' }); return }
      }
      log(req.method + ' ' + req.path)
      next()
    })
    app.use(express.json({ limit: '16kb' }))
    app.use(express.static(publicDir, { dotfiles: 'deny' }))
    app.get('/healthz', (_req, res) => res.json({ ok: true }))
    app.get('/api/notes', (_req, res) => res.json(notes))
    app.all(['/api/notes', '/api/notes/:id'], async (req, res, next) => {
      if (!['POST', 'PUT', 'DELETE'].includes(req.method)) { res.status(405).json({ error: '不支持该方法' }); return }
      const task = pending.then(async () => {
        const id = typeof req.params.id === 'string' ? req.params.id : undefined
        const index = notes.findIndex(n => n.id === id)
        if (req.method !== 'POST' && index < 0) { res.status(404).json({ error: '笔记不存在' }); return }
        if (req.method === 'POST' && (id || notes.length >= 1000)) { res.status(400).json({ error: '无法新增笔记' }); return }
        if (req.method !== 'POST' && !id) { res.status(400).json({ error: '需要笔记 ID' }); return }
        const nextNotes = notes.map(n => ({ ...n }))
        if (req.method === 'DELETE') nextNotes.splice(index, 1)
        else {
          const body = contentSchema.safeParse(req.body)
          if (!body.success) { res.status(400).json({ error: '请输入 1–2000 字的笔记' }); return }
          if (req.method === 'POST') nextNotes.push({ id: randomUUID(), text: body.data.text })
          else nextNotes[index] = { id: id!, text: body.data.text }
        }
        await writeFile(file + '.tmp', JSON.stringify(nextNotes), 'utf8')
        await rename(file + '.tmp', file)
        notes = nextNotes
        res.status(req.method === 'POST' ? 201 : 200).json({ ok: true })
      })
      pending = task.catch(() => {})
      try { await task } catch (error) { next(error) }
    })
    app.use((_req, res) => { res.status(404).json({ error: '不存在' }) })
    app.use((error: Error & { status?: number }, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      log('请求失败: ' + error.message)
      res.status(error.status && error.status < 500 ? error.status : 500).json({ error: error.status && error.status < 500 ? '请求格式错误或内容过大' : '服务处理失败' })
    })
    const server = createServer(app)
    const wss = new WebSocketServer({ noServer: true, maxPayload: 4096 })
    server.on('upgrade', (req, socket, head) => {
      let allowed = req.url === '/ws'
      try { if (req.headers.origin && new URL(req.headers.origin).host !== req.headers.host) allowed = false }
      catch { allowed = false }
      if (!allowed) { socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); return }
      wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, req))
    })
    wss.on('connection', ws => {
      log('WS 客户端连接')
      ws.on('error', error => log('WS: ' + error.message))
      ws.on('message', (data, binary) => {
        if (binary) return
        try {
          const parsed = chatSchema.safeParse(JSON.parse(data.toString()))
          if (!parsed.success) return
          const message = JSON.stringify({ name: parsed.data.name || '访客', text: parsed.data.text })
          for (const client of wss.clients) if (client.readyState === WebSocket.OPEN && client.bufferedAmount < 65536) client.send(message)
        } catch { /* Invalid messages are ignored; the connection remains usable. */ }
      })
    })
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(port, host, () => { server.off('error', reject); resolve() })
    }).catch(error => { wss.close(); throw error })
    const boundPort = (server.address() as { port: number }).port
    log('Express 示例就绪；记事本保存到 ' + file)
    return { port: boundPort, async close() {
      for (const client of wss.clients) client.terminate()
      await new Promise<void>(resolve => wss.close(() => resolve()))
      const closing = new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
      server.closeAllConnections()
      await closing
      await pending
    } }
  }
