#!/usr/bin/env node
/**
 * 开发模式：主进程/preload 重新编译后重启 Electron。
 * 由 tsup --onSuccess 触发（见 package.json 的 dev:main）。
 *
 * Renderer 侧由 Vite HMR 处理，不需要重启。
 */
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const appRoot = join(here, '..')

let child = null
let restarting = false

function electronBinary() {
  // 优先用 node_modules 里装好的 electron，避免依赖全局 PATH
  const exe = process.platform === 'win32' ? 'electron.exe' : 'electron'
  return join(appRoot, 'node_modules', 'electron', 'dist', exe)
}

function start() {
  if (child && !child.killed) {
    restarting = true
    child.kill('SIGTERM')
    return
  }

  child = spawn(electronBinary(), ['.'], {
    cwd: appRoot,
    stdio: 'inherit',
    env: {
      ...process.env,
      NODE_ENV: 'development',
      ANYFRAME_VERSION: '0.0.0-dev',
      // 开发期固定端口，省去每次从 preload 取端口的麻烦
      ANYFRAME_RPC_PORT: process.env.ANYFRAME_RPC_PORT ?? '47730',
    },
  })

  child.on('exit', (code, signal) => {
    child = null
    if (restarting) {
      restarting = false
      // 等旧进程彻底退出再起新的，否则 Windows 上会撞单实例锁
      setTimeout(start, 300)
    } else {
      console.log(`[dev] Electron 退出 code=${code} signal=${signal}`)
      process.exit(code ?? 0)
    }
  })
}

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    if (child && !child.killed) child.kill(sig)
    process.exit(0)
  })
}

start()
