#!/usr/bin/env node
/**
 * ─────────────────────────────────────────────────────────────
 * postinstall
 * ─────────────────────────────────────────────────────────────
 * pnpm install 之后自动执行。
 *
 * 设计原则：**绝不以非 0 退出**。
 * postinstall 失败会让整个 install 失败，而它做的事全是「提醒」，
 * 提醒失败不该拦住依赖安装。所有异常都吞掉并打印警告。
 *
 * 真正的硬校验放在 scripts/check-env.mjs（手动或 CI 里跑）。
 */
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = process.cwd()

function warn(msg) {
  console.warn(`\x1b[33m[postinstall]\x1b[0m ${msg}`)
}
function info(msg) {
  console.log(`\x1b[36m[postinstall]\x1b[0m ${msg}`)
}

try {
  // ── 1. Node 版本 ──────────────────────────────────────────
  // Capacitor 8 要求 Node >= 22，Electron 44 内置 Node 24.18。
  // 用 Node 20 装依赖不会报错，但 cap sync 会在运行时炸，
  // 且报错信息（多为 optional chaining / structuredClone 相关）
  // 完全看不出是版本问题，所以在这里提前拦。
  const nodeMajor = Number(process.versions.node.split('.')[0])
  if (nodeMajor < 22) {
    warn(
      `当前 Node ${process.versions.node}，本仓库需要 Node >= 22。\n` +
      '             Capacitor 8 与 Electron 44 都以此为下限。\n' +
      '             建议用 fnm / nvm / volta 切换：fnm use 22',
    )
  }

  // ── 2. Electron 二进制是否下载成功 ────────────────────────
  // 国内网络下 electron 的 postinstall 经常静默失败：
  // node_modules/electron 目录在，但 dist/ 是空的，
  // 运行时报 "Electron failed to install correctly, please delete
  // node_modules/electron and try reinstalling"。
  // 这里直接检查产物，给出可执行的解决办法。
  // pnpm 的 isolated linker 下，electron 装在 apps/desktop/node_modules 里，
  // 不在仓库根目录 —— 按根目录找会永远报「未安装」。
  const electronPkg = join(ROOT, 'apps', 'desktop', 'node_modules', 'electron')
  if (existsSync(electronPkg)) {
    const dist = join(electronPkg, 'dist')
    const marker = join(dist, process.platform === 'win32' ? 'electron.exe' : 'electron')
    if (!existsSync(marker)) {
      warn(
        'Electron 二进制未下载完整（node_modules/electron/dist 缺可执行文件）。\n' +
        '             这在国内网络下很常见。两种解决办法：\n' +
        '             1) 设置镜像后重装：\n' +
        '                  $env:ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/"   # PowerShell\n' +
        '                  export ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/    # bash\n' +
        '                  pnpm install --force\n' +
        '             2) 或在 .npmrc 里取消 electron_mirror 那两行的注释\n' +
        '             electron-builder 的二进制（winCodeSign / nsis）同理，\n' +
        '             需要 ELECTRON_BUILDER_BINARIES_MIRROR。',
      )
    } else {
      info('Electron 二进制 ✓')
    }
  }

  // ── 3. 原生工程是否已生成 ─────────────────────────────────
  // android/ 与 ios/ 是生成物（不进版本库），
  // 新克隆仓库的人直接跑 dist:android 会得到一句
  // "android/ 工程不存在"，这里提前指路。
  const hasAndroid = existsSync(join(ROOT, 'apps', 'mobile', 'android'))
  const hasIos = existsSync(join(ROOT, 'apps', 'mobile', 'ios'))
  if (!hasAndroid && !hasIos) {
    info('移动端原生工程尚未生成。需要时执行：pnpm --filter @anyframe/mobile setup:native')
  }

  // ── 4. 本机可构建的目标 ───────────────────────────────────
  // 只提示，不阻断。完整报告见 scripts/check-env.mjs（pnpm check-env）。
  const platform = process.platform
  const lines = []
  lines.push(platform === 'win32' ? '  ✓ Windows 桌面' : '  ✗ Windows 桌面（需在 Windows 上构建）')
  lines.push(platform === 'linux' ? '  ✓ Ubuntu 桌面' : '  ✗ Ubuntu 桌面（需在 Linux 上构建）')
  lines.push('  ✓ Web（任意平台）')
  lines.push('  ✓ Android（任意平台，需 JDK 21 + Android SDK）')
  lines.push(platform === 'darwin' ? '  ✓ iOS' : '  ✗ iOS（只能在 macOS 上构建）')

  // electron-builder 无法跨平台构建：
  // 在 Windows 上产不出 deb/rpm/AppImage，在 Linux 上产不出 NSIS（需 Wine）。
  // 这条限制决定了 CI 必须按平台拆 runner，见 .github/workflows/build.yml。
  info('本机可构建的目标：\n' + lines.filter(Boolean).join('\n'))
  info('完整环境检查：pnpm check-env')

  // ── 5. git hooks（可选）───────────────────────────────────
  // 仓库里如果有 .husky/ 就装 hooks；没有就跳过。
  // 不用 husky 依赖，避免为了一个 pre-commit 引入额外的安装步骤。
  if (existsSync(join(ROOT, '.husky'))) {
    const r = spawnSync('git', ['config', 'core.hooksPath', '.husky'], { cwd: ROOT })
    if (r.status === 0) info('git hooks 已指向 .husky/')
  }
} catch (err) {
  // 见文件头：postinstall 失败不该让 install 失败
  warn(`postinstall 检查出现异常（不影响依赖安装）：${err?.message ?? err}`)
}
