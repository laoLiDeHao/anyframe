import { ServiceManager, ServiceStartInputSchema } from '../../packages/core/dist/node.js'
import { ProjectServiceHost } from '../../packages/service-host/dist/index.js'
import { fileURLToPath } from 'node:url'
const manager = new ServiceManager()
const projects = new ProjectServiceHost(manager, { dataRoot: process.env.ANYFRAME_DATA_ROOT || '.anyframe-demo', builtinRoot: fileURLToPath(new URL('../../services/builtin', import.meta.url)) })
await projects.initialize()
const service = await projects.start(ServiceStartInputSchema.parse({ name: 'express-demo', host: process.env.HOST || '127.0.0.1', port: Number(process.env.PORT || 8080) }))
console.log(service.urls.join('\n'))
process.on('SIGINT', () => void manager.stopAll())
process.on('SIGTERM', () => void manager.stopAll())
