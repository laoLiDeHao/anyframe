import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
const require = createRequire(import.meta.url)
const { build } = createRequire(require.resolve('tsup'))('esbuild')
await build({ entryPoints: [fileURLToPath(new URL('./src/express-demo/index.ts', import.meta.url))], outfile: fileURLToPath(new URL('./builtin/express-demo/index.js', import.meta.url)), bundle: true, platform: 'node', format: 'cjs', target: 'node22', external: ['bufferutil', 'utf-8-validate'], legalComments: 'eof' })
