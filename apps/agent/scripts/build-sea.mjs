#!/usr/bin/env node
/**
 * 把 Agent 打成**单文件可执行程序**（Node SEA，Single Executable Application）。
 *
 * 官方流程，Node 22+ 内置支持：
 *   1. tsup 产出单文件 dist/agent.cjs
 *   2. node --experimental-sea-config → 生成 blob
 *   3. 复制 node 二进制
 *   4. 去掉原签名（macOS / Windows）
 *   5. postject 注入 blob
 *   6. 重新 ad-hoc 签名（macOS 必需，否则 Gatekeeper 直接杀）
 *
 * 产物：release/anyframe-agent(.exe)
 *
 * ⚠️ 必须在目标平台上运行 —— Windows 上产出 .exe，Linux 上产出 ELF。
 *    CI 里对应 build.yml 的 agent-windows / agent-linux 两个 job。
 */
import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, rmSync, writeFileSync, chmodSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const appRoot = join(here, '..')
const distDir = join(appRoot, 'dist')
const outDir = join(appRoot, 'release')
const bundle = join(distDir, 'agent.cjs')

const isWin = process.platform === 'win32'
const isMac = process.platform === 'darwin'
const exeName = `anyframe-agent${isWin ? '.exe' : ''}`

function run(cmd, args, opts = {}) {
  console.log(`$ ${cmd} ${args.join(' ')}`)
  execFileSync(cmd, args, { stdio: 'inherit', cwd: appRoot, ...opts })
}

function main() {
  // ── 0. 前置检查 ────────────────────────────────────────────
  if (!existsSync(bundle)) {
    console.error(`✗ 找不到 ${bundle}\n  先运行: pnpm --filter @anyframe/agent build`)
    process.exit(1)
  }
  const nodeMajor = Number(process.versions.node.split('.')[0])
  if (nodeMajor < 20) {
    console.error(`✗ Node SEA 需要 Node 20+，当前 ${process.versions.node}`)
    process.exit(1)
  }

  rmSync(outDir, { recursive: true, force: true })
  mkdirSync(outDir, { recursive: true })

  // ── 1. SEA 配置 ────────────────────────────────────────────
  const seaConfig = join(appRoot, 'sea-config.json')
  writeFileSync(
    seaConfig,
    JSON.stringify(
      {
        main: 'dist/agent.cjs',
        output: 'sea-prep.blob',
        disableExperimentalSEAWarning: true,
        useSnapshot: false,
        useCodeCache: true, // 加快冷启动，Agent 是常驻程序，收益明显
      },
      null,
      2,
    ),
  )
  console.log(`→ 写入 ${seaConfig}`)

  // ── 2. 生成 blob ───────────────────────────────────────────
  run(process.execPath, ['--experimental-sea-config', 'sea-config.json'])
  const blob = join(appRoot, 'sea-prep.blob')
  if (!existsSync(blob)) {
    console.error('✗ sea-prep.blob 未生成')
    process.exit(1)
  }
  console.log(`→ blob 大小: ${(statSync(blob).size / 1024).toFixed(1)} KB`)

  // ── 3. 复制 node 二进制 ────────────────────────────────────
  const target = join(outDir, exeName)
  copyFileSync(process.execPath, target)
  if (!isWin) chmodSync(target, 0o755)
  console.log(`→ 已复制 node → ${target}`)

  // ── 4. 去掉原签名 ──────────────────────────────────────────
  if (isMac) {
    run('codesign', ['--remove-signature', target])
  } else if (isWin) {
    // node.exe 带微软签名，postject 前需移除。
    // signtool 随 Windows SDK 安装；CI 的 windows-latest 已自带。
    try {
      run('signtool', ['remove', '/s', target])
    } catch {
      console.warn('⚠ signtool 不可用，跳过签名移除（多数情况下 postject 仍能成功）')
    }
  }

  // ── 5. 注入 blob ───────────────────────────────────────────
  /**
   * 直接用 process.execPath 跑 postject 的 JS 入口，
   * 而不是 node_modules/.bin 里的 shim。两个原因：
   *
   *  1. Windows 上 .bin 里是 postject.CMD。自 Node 18.20 / 20.12 / 21.7
   *     （CVE-2024-27980 的修复）起，child_process 拒绝在 shell:false 下
   *     spawn .bat/.cmd，直接抛 EINVAL；改成 shell:true 又会把含空格的
   *     路径重新丢给 cmd 解析，等于换一个坑。
   *  2. pnpm 生成的文件名是 postject.CMD（大写扩展名），
   *     靠大小写不敏感的文件系统才能命中，换到 WSL / 某些挂载盘就找不到。
   *
   * 走 node + dist/cli.js 在三个平台上行为完全一致。
   */
  const postjectCli = join(appRoot, 'node_modules', 'postject', 'dist', 'cli.js')
  if (!existsSync(postjectCli)) {
    console.error(`✗ 找不到 postject CLI: ${postjectCli}\n  先运行: pnpm install`)
    process.exit(1)
  }
  const postjectArgs = [
    postjectCli,
    target,
    'NODE_SEA_BLOB',
    blob,
    '--sentinel-fuse',
    'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2',
  ]
  if (isMac) postjectArgs.push('--macho-segment-name', 'NODE_SEA')
  run(process.execPath, postjectArgs)

  // ── 6. macOS 重新 ad-hoc 签名 ──────────────────────────────
  if (isMac) {
    run('codesign', ['--sign', '-', target])
  }

  rmSync(blob, { force: true })
  rmSync(seaConfig, { force: true })

  const size = statSync(target).size / 1024 / 1024
  console.log(`\n✓ 完成: ${target}  (${size.toFixed(1)} MB)`)
  console.log(`  验证: ${isWin ? target : `./${target}`} --help`)
  console.log(`\n⚠ 体积主要来自内嵌的完整 Node 运行时（约 ${size.toFixed(0)}MB）。`)
  console.log(`  若嫌大，改用 dist:portable 产出「依赖用户已装 Node」的轻量包。`)
}

main()
