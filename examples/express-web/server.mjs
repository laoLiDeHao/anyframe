// Run from the repository after `pnpm build:core`.
import { demoFactory } from '../../packages/core/dist/node.js'

const service = await demoFactory(process.env.ANYFRAME_DATA_ROOT || '.anyframe-demo')({
  host: process.env.HOST || '127.0.0.1',
  port: Number(process.env.PORT || 8080),
  serviceId: 'express-demo',
  log: console.log,
})
console.log(service.urls.join('\n'))
let stopping = false
async function stop() {
  if (stopping) return
  stopping = true
  await service.close()
}
process.on('SIGINT', () => void stop())
process.on('SIGTERM', () => void stop())
