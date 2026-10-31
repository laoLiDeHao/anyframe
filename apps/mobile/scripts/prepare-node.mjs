// Fixed SDK artifact; never fetch "latest" or accept an unverified native binary.
import { createHash } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'

const app = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const repo = resolve(app, '../..')
const cache = join(repo, 'build-output/node-mobile')
const version = '24.22.0-0'
const name = `nodejs-mobile-android-${version}.zip`
const sha256 = '9b068f4ad4c755f26c04b31883c536f037a4831e6575847a699cdf5fa72dde25'
const archive = join(cache, name)
mkdirSync(cache, { recursive: true })
function run(cmd, args) {
  const result = spawnSync(cmd, args, { stdio: 'inherit' })
  if (result.status !== 0) throw Error(`${cmd} failed: ${result.status ?? result.error}`)
}
if (!existsSync(archive)) {
  run('curl', ['--fail', '--location', '--retry', '3', '--connect-timeout', '30',
    `https://github.com/fogtape/nodejs-mobile/releases/download/v${version}/${name}`, '--output', archive + '.tmp'])
  renameSync(archive + '.tmp', archive)
}
if (createHash('sha256').update(readFileSync(archive)).digest('hex') !== sha256) {
  throw Error(`Node SDK SHA256 mismatch: ${archive}. Remove the corrupt archive and retry.`)
}
const sdk = join(cache, 'extracted')
const stamp = join(sdk, '.sha256')
if (!existsSync(stamp) || readFileSync(stamp, 'utf8') !== sha256) {
  mkdirSync(sdk, { recursive: true })
  if (process.platform === 'win32') {
    run('tar.exe', ['-xf', archive, '-C', sdk])
  } else {
    run('unzip', ['-qo', archive, '-d', sdk])
  }
  if (!existsSync(join(sdk, 'include/node/node.h'))) throw Error('Node SDK headers missing')
  writeFileSync(stamp, sha256)
}
const main = join(app, 'android/app/src/main')
cpSync(join(app, 'native/android/node'), join(main, 'node'), { recursive: true })
cpSync(join(sdk, 'include'), join(main, 'node/include'), { recursive: true })
for (const abi of ['arm64-v8a', 'armeabi-v7a', 'x86_64']) {
  mkdirSync(join(main, 'jniLibs', abi), { recursive: true })
  cpSync(join(sdk, 'bin', abi, 'libnode.so'), join(main, 'jniLibs', abi, 'libnode.so'))
}
// Resolve the bundler from core's existing build dependency; no device-side npm install.
const coreRequire = createRequire(join(repo, 'packages/core/package.json'))
const tsupRequire = createRequire(coreRequire.resolve('tsup'))
const { build } = tsupRequire('esbuild')
await build({
  absWorkingDir: app,
  entryPoints: [join(app, 'node/host.ts')], outfile: join(main, 'assets/node-runtime/main.cjs'),
  bundle: true, platform: 'node', format: 'cjs', target: 'node24',
  external: ['bufferutil', 'utf-8-validate'], // ws falls back to its included JS implementation
})
cpSync(join(app, 'native/android/node/LICENSE'), join(main, 'assets/node-runtime/LICENSE'))
cpSync(join(app, 'node/bootstrap.cjs'), join(main, 'assets/node-runtime/bootstrap.cjs'))
cpSync(join(repo, 'services/builtin'), join(main, 'assets/node-runtime/services'), { recursive: true })
console.log(`[node] Embedded Node ${version}: SHA256 verified, three ABIs + independent service packages ready`)
