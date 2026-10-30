import { unlink } from 'node:fs/promises'
import { writeFileSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import { isIP } from 'node:net'
import { ANDROID, NodeFsProvider, ServiceManager, startManagedService, startRpcServer } from '@anyframe/core/node'

const [root, ready, token, version] = process.argv.slice(2) as [string, string, string, string]
const stage = (text: string) => writeFileSync(join(root, 'node-stage.txt'), `${new Date().toISOString()} ${text}`)
stage('业务模块已加载，初始化管理器')
const lanAddresses = JSON.parse(process.argv[6] ?? '[]') as string[]
const files = new NodeFsProvider({ allowedRoots: [root] })
const manager = new ServiceManager({ portRangeStart: 47820 })
async function main() {
  stage('开始监听管理 RPC：127.0.0.1 随机端口')
  const rpc = await startRpcServer({
    host: '127.0.0.1', port: 0, token,
    allowedOrigins: ['https://localhost', 'http://localhost'],
    handlers: {
      'capabilities.get': () => ({ ...ANDROID, arch: process.arch, version, serviceTemplates: ['express-demo'] }),
      'fs.read': i => files.read(i), 'fs.write': i => files.write(i),
      'fs.list': i => files.list(i), 'fs.remove': i => files.remove(i),
      'service.start': i => {
        if (i.template !== 'express-demo') throw Object.assign(Error('Android 首版只支持内置 Express 示例'), { code: 'UNSUPPORTED' })
        return startManagedService(manager, i, root, lanAddresses.filter(address => isIP(address) === 4))
      },
      'service.stop': i => manager.stop(i.id, i.timeoutMs),
      'service.list': () => ({ services: manager.list() }),
      'service.logs': i => ({ lines: manager.logs(i.id, i.tail) }),
    },
  })
  stage('管理 RPC 已监听，发布就绪状态：' + rpc.url)
  writeFileSync(ready + '.tmp', JSON.stringify({ url: rpc.url, port: rpc.port, token, pid: process.pid }))
  renameSync(ready + '.tmp', ready)
  stage('Node 已就绪：' + rpc.url)
  let quitting = false
  async function stop() {
    if (quitting) return
    quitting = true
    await unlink(ready).catch(() => {})
    await manager.stopAll()
    await rpc.close()
  }
  process.on('SIGTERM', () => void stop().finally(() => process.exit(0)))
  process.on('SIGINT', () => void stop().finally(() => process.exit(0)))
}
main().catch(error => {
  writeFileSync(join(root, 'node-error.txt'), String(error?.stack ?? error))
  console.error(error)
  process.exitCode = 1
})
