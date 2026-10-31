import { Worker } from 'node:worker_threads'
import { networkInterfaces } from 'node:os'
import type { EmbeddedFactory } from '@anyframe/core/node'

// Only this trusted bootstrap is evaluated. Project code is loaded from its private directory.
const bootstrap = String.raw`
const { parentPort, workerData } = require('node:worker_threads');
const { join } = require('node:path');
const send = (type, data) => parentPort.postMessage({ type, ...data });
let service;
process.on('uncaughtException', error => { send('failed', { error: error.stack }); process.exit(1); });
process.on('unhandledRejection', error => { send('failed', { error: String(error) }); process.exit(1); });
parentPort.on('message', async message => {
  if (message !== 'stop') return;
  try { await service?.close(); process.exit(0); }
  catch (error) { send('failed', { error: String(error) }); process.exit(1); }
});
(async () => {
  if (!process.permission || !process.permission.has('fs.read', workerData.projectDir)) throw Error('宿主未启用项目文件权限限制');
  const entry = require(join(workerData.projectDir, 'index.js'));
  if (typeof entry.start !== 'function') throw Error('index.js 必须导出 start(context)');
  service = await entry.start({ ...workerData, publicDir: join(workerData.projectDir, 'wwwroot'), log: text => send('log', { text: String(text) }) });
  if (!service || !Number.isInteger(service.port) || service.port !== workerData.port || typeof service.close !== 'function') throw Error('start 必须返回 { port, close() }，并监听分配的端口');
  send('ready', { port: service.port });
})().catch(error => { send('failed', { error: error.stack || String(error) }); process.exit(1); });
`

export function projectFactory(projectDir: string, lanAddresses: string[] = []): EmbeddedFactory {
  return async ({ host, port, log }) => {
    const worker = new Worker(bootstrap, {
      eval: true,
      // Never inherit the supervisor's tokens, env, execArgv or broad filesystem access.
      env: {},
      execArgv: ['--permission', `--allow-fs-read=${projectDir}`, `--allow-fs-write=${projectDir}`],
      workerData: { projectDir, host, port }, stdout: true, stderr: true,
      resourceLimits: { maxOldGenerationSizeMb: 128 },
    })
    worker.stdout?.on('data', data => log(String(data)))
    worker.stderr?.on('data', data => log(String(data)))
    let stopping = false
    let failure: Error | undefined
    const closed = new Promise<void>((resolve, reject) => {
      worker.once('error', error => { failure = error })
      worker.once('exit', code => { if (!stopping && (failure || code !== 0)) reject(failure ?? Error(`服务线程退出: ${code}`)); else resolve() })
    })
    void closed.catch(() => {})
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(Error('服务启动超时（15 秒）')), 15000)
      const fail = (error: Error) => { clearTimeout(timer); reject(error) }
      worker.once('error', fail)
      worker.once('exit', code => fail(failure ?? Error(`服务在就绪前退出: ${code}`)))
      worker.on('message', message => {
        if (message.type === 'log') log(message.text)
        if (message.type === 'failed') { failure = Error(message.error); fail(failure) }
        if (message.type === 'ready') { clearTimeout(timer); resolve() }
      })
    }).catch(async error => { await worker.terminate(); throw error })
    const urls = [`http://127.0.0.1:${port}`]
    if (host === '0.0.0.0') {
      const addresses = new Set(lanAddresses)
      try { for (const entries of Object.values(networkInterfaces())) for (const address of entries ?? []) {
        if (address.family === 'IPv4' && !address.internal) addresses.add(address.address)
      } } catch { log('使用宿主提供的局域网地址') }
      for (const address of addresses) urls.push(`http://${address}:${port}`)
    }
    return { port, urls, closed, async close() {
      stopping = true
      const timer = setTimeout(() => void worker.terminate(), 5000)
      worker.postMessage('stop')
      try { await closed } finally { clearTimeout(timer) }
    } }
  }
}
