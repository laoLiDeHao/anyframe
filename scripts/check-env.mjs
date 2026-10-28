#!/usr/bin/env node
/**
 * ─────────────────────────────────────────────────────────────
 * 构建环境检查
 * ─────────────────────────────────────────────────────────────
 *   pnpm check-env              生成报告，缺东西也返回 0
 *   pnpm check-env --strict     缺任何必需项就返回 1（CI 用）
 *   pnpm check-env --target ios 只检查某一端
 *
 * 三级输出的语义：
 *   ✓ 通过      ✗ 阻塞（--strict 下返回 1）      ! 提示（永不失败）
 * 提示项包含「当前平台产不出某某包」这类结构性事实，
 * 任何 runner 上都会出现，所以不能参与 --strict 的判定。
 *
 * 存在的意义：五个目标各有一套完全不同的原生工具链，
 * 缺什么、装什么、在哪配，报错信息通常都不会告诉你。
 * 与其让用户在 electron-builder / gradle / xcodebuild 的
 * 天书输出里猜，不如一开始就把清单摊开。
 *
 * 注意：这个脚本只读，不会安装任何东西、不会改环境变量。
 */
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = process.cwd()
const argv = process.argv.slice(2)
const strict = argv.includes('--strict')
const targetFilter = (() => {
  const i = argv.indexOf('--target')
  return i >= 0 ? argv[i + 1] : null
})()

// ── 输出 ────────────────────────────────────────────────────

const C = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  bold: '\x1b[1m',
}

let hasError = false
let hasWarn = false

const section = (t) => console.log(`\n${C.bold}${C.cyan}${t}${C.reset}`)
const ok = (t, d = '') => console.log(`  ${C.green}✓${C.reset} ${t}${d ? ` ${C.dim}${d}${C.reset}` : ''}`)
const bad = (t, d) => {
  hasError = true
  console.log(`  ${C.red}✗${C.reset} ${t}\n      ${C.red}${d}${C.reset}`)
}
const tip = (t, d) => {
  hasWarn = true
  console.log(`  ${C.yellow}!${C.reset} ${t}\n      ${C.yellow}${d}${C.reset}`)
}

function sh(cmd, args) {
  const r = spawnSync(cmd, args, {
    encoding: 'utf8',
    shell: process.platform === 'win32',
  })
  return { out: `${r.stdout ?? ''}${r.stderr ?? ''}`.trim(), status: r.status }
}

const platform = process.platform
const want = (t) => !targetFilter || targetFilter === t

console.log(`${C.bold}AnyFrame 构建环境检查${C.reset} ${C.dim}(${platform} / node ${process.versions.node})${C.reset}`)

// ── 通用工具链 ──────────────────────────────────────────────

if (want('common')) {
  section('通用')

  const nodeMajor = Number(process.versions.node.split('.')[0])
  if (nodeMajor >= 22) ok('Node', process.versions.node)
  else bad(`Node ${process.versions.node}`, '需要 >= 22（Capacitor 8 与 Electron 44 的下限）')

  const pnpm = sh('pnpm', ['--version'])
  if (pnpm.status === 0) {
    const [maj, min] = pnpm.out.split('.').map(Number)
    if (maj > 9 || (maj === 9 && min >= 5)) ok('pnpm', pnpm.out)
    else bad(`pnpm ${pnpm.out}`, '需要 >= 9.5（catalog: 协议从 9.5 开始支持）')
  } else {
    bad('pnpm 未安装', 'corepack enable && corepack prepare pnpm@9.15.0 --activate')
  }

  const git = sh('git', ['--version'])
  git.status === 0 ? ok('git', git.out.replace('git version ', '')) : tip('git 未安装', 'versionCode 推导与 electron-builder 的 publish 都依赖它')

  if (!existsSync(join(ROOT, 'node_modules'))) {
    bad('依赖未安装', 'pnpm install')
  }

  // electron-builder 从 git remote 推断 GitHub owner/repo，
  // 没配 remote 的话 publish: github 会在打包最后一步失败，
  // 而前面十几分钟都白跑了 —— 所以提前检查。
  const remote = sh('git', ['config', '--get', 'remote.origin.url'])
  if (remote.status === 0 && remote.out) {
    ok('git remote', remote.out)
  } else {
    tip('未配置 git remote origin', 'electron-builder.yml 的 publish: github 靠它推断 owner/repo；只出包不发布可以忽略')
  }
}

// ── Electron 桌面（Windows / Ubuntu）────────────────────────

if (want('desktop')) {
  section('桌面端（Electron → Windows / Ubuntu）')

  const bin = join(ROOT, 'apps', 'desktop', 'node_modules', 'electron', 'dist',
    platform === 'win32' ? 'electron.exe' : 'electron')
  if (existsSync(bin)) {
    ok('Electron 二进制')
  } else if (existsSync(join(ROOT, 'apps', 'desktop', 'node_modules', 'electron'))) {
    bad(
      'Electron 二进制缺失',
      '国内网络常见。设 ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ 后 pnpm install --force，' +
      '或取消 .npmrc 里 electron_mirror 两行的注释',
    )
  } else {
    bad('electron 未安装', 'pnpm install')
  }

  const eb = join(ROOT, 'apps', 'desktop', 'node_modules', '.bin',
    platform === 'win32' ? 'electron-builder.CMD' : 'electron-builder')
  existsSync(eb) ? ok('electron-builder') : bad('electron-builder 未安装', 'pnpm install')

  // 跨平台构建限制。这条是 CI 矩阵设计的根本原因。
  if (platform === 'win32') {
    ok('可产出', 'Windows NSIS / portable')
    tip('不可产出', 'Linux deb/rpm/AppImage。electron-builder 不支持在 Windows 上构建 Linux 包，CI 需用 ubuntu runner')
  } else if (platform === 'linux') {
    ok('可产出', 'Linux deb / rpm / AppImage')
    tip('不可产出', 'Windows NSIS 需要 Wine；portable 目标同样。CI 需用 windows runner')
    // AppImage 在 CI 容器里运行时依赖 FUSE，但**构建**不需要。
    // 常见误报是 "dlopen(): error loading libfuse.so.2" —— 那是在**运行**
    // 打好的 AppImage，不是构建阶段。
  } else {
    ok('可产出', 'macOS dmg/zip（本项目未配置，需要时在 electron-builder.yml 加 mac 段）')
    tip('不可产出', 'Windows 与 Linux 包均需在对应平台构建')
  }

  // 代码签名。不签名也能出包，只是用户装的时候会看到 SmartScreen / Gatekeeper 警告。
  if (process.env.CSC_LINK || process.env.AZURE_CODE_SIGNING_NAME) {
    ok('签名凭据', 'CSC_LINK / Azure Trusted Signing 已配置')
  } else {
    tip('未配置代码签名', 'Windows 会触发 SmartScreen「未知发布者」，Ubuntu 无影响。签名配置见 apps/desktop/electron-builder.yml 注释')
  }
}

// ── Web ─────────────────────────────────────────────────────

if (want('web')) {
  section('Web 端（静态站点）')
  ok('无额外依赖', 'vite build 产出 apps/web/dist，可部署到任意静态托管')

  // Agent 是 Web 端获得完整能力的必要条件，
  // 但它不是 Web 构建的依赖，所以只提示。
  const sea = sh('node', ['--version'])
  const major = Number(sea.out.replace('v', '').split('.')[0])
  if (major >= 20) {
    ok('Node SEA（本地助手单文件产物）', `Node ${sea.out} 支持 --experimental-sea-config`)
  } else {
    tip('Node SEA 需要 Node >= 20', '当前版本无法产出单文件 Agent，可改用 build-portable.mjs（要求用户自装 Node）')
  }
}

// ── Android ─────────────────────────────────────────────────

if (want('android')) {
  section('Android 端（Capacitor）')

  // JDK：Capacitor 8 / AGP 8.x 要求 21。
  // 用 17 的典型报错是 "Unsupported class file major version 65"，
  // 完全看不出是 JDK 版本问题。
  const javaHome = process.env.JAVA_HOME
  const java = sh('java', ['-version'])
  const jm = /version "(\d+)/.exec(java.out)
  if (jm && Number(jm[1]) >= 21) {
    ok('JDK', `${jm[1]}${javaHome ? ` (JAVA_HOME=${javaHome})` : ''}`)
  } else if (jm) {
    bad(`JDK ${jm[1]}`, 'Capacitor 8 需要 JDK 21。Ubuntu: apt install openjdk-21-jdk / macOS: brew install --cask temurin@21 / Windows: winget install EclipseAdoptium.Temurin.21.JDK')
  } else {
    bad('未检测到 java', '安装 JDK 21 并配置 JAVA_HOME 与 PATH')
  }

  const sdk = process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT
  if (sdk && existsSync(sdk)) {
    ok('Android SDK', sdk)
    // compileSdk 由 Capacitor 的 variables.gradle 决定（Capacitor 8 = 36）。
    // 缺对应 platform 时 gradle 会自动下载，但离线环境会卡死，
    // 所以这里只做提示不做断言。
    const platforms = join(sdk, 'platforms')
    if (!existsSync(platforms)) {
      tip('SDK 里没有 platforms 目录', '首次构建会联网下载；离线环境请用 sdkmanager 预先装好')
    }
  } else {
    bad(
      '未检测到 Android SDK',
      '装 Android Studio，或单独用 cmdline-tools + sdkmanager。\n' +
      '      然后设 ANDROID_HOME（Windows 通常是 %LOCALAPPDATA%\\Android\\Sdk）',
    )
  }

  const adb = sh('adb', ['version'])
  adb.status === 0
    ? ok('adb', '真机调试可用')
    : tip('adb 不可用', '只影响真机调试与 cap run，不影响出包')

  if (!existsSync(join(ROOT, 'apps', 'mobile', 'android'))) {
    tip('android/ 工程未生成', 'pnpm --filter @anyframe/mobile setup:native')
  } else {
    ok('android/ 工程')
    if (!existsSync(join(ROOT, 'apps', 'mobile', 'android', 'keystore.properties')) &&
        !process.env.ANYFRAME_ANDROID_STORE_FILE) {
      tip('未配置发布签名', 'release 包会用 debug 签名，可安装但不能上架。见 native/android/keystore.properties.example')
    }
  }
}

// ── iOS ─────────────────────────────────────────────────────

if (want('ios')) {
  section('iOS 端（Capacitor）')

  if (platform !== 'darwin') {
    tip('当前不是 macOS', 'iOS 只能在 macOS 上构建 —— xcodebuild 与 CocoaPods 都没有跨平台实现。CI 里用 macos runner')
  } else {
    const xv = sh('xcodebuild', ['-version'])
    const xm = /Xcode (\d+)\.(\d+)/.exec(xv.out)
    if (!xm) {
      bad('xcodebuild 不可用', 'sudo xcode-select -s /Applications/Xcode.app/Contents/Developer && sudo xcodebuild -license accept')
    } else if (Number(xm[1]) < 26) {
      bad(`Xcode ${xm[1]}.${xm[2]}`, 'Capacitor 8 需要 Xcode 26+')
    } else {
      ok('Xcode', `${xm[1]}.${xm[2]}`)
    }

    const pod = sh('pod', ['--version'])
    pod.status === 0
      ? ok('CocoaPods', pod.out)
      : bad('CocoaPods 未安装', 'brew install cocoapods（别用 sudo gem install，会污染系统 Ruby）')

    // 自 2026-04-28 起，App Store Connect 拒绝用旧 Xcode 构建的上传。
    // 这条是硬性的，不是建议。
    tip('上传限制', 'App Store Connect 会拒绝过旧 Xcode 构建的产物；升级 Xcode 后记得同步升级 CI runner 镜像')

    if (!process.env.ANYFRAME_IOS_TEAM_ID) {
      tip('未设 ANYFRAME_IOS_TEAM_ID', 'build-ios.mjs 需要它。Apple Developer 后台 → Membership 里的 10 位 ID')
    } else {
      ok('Team ID', process.env.ANYFRAME_IOS_TEAM_ID)
    }

    if (!existsSync(join(ROOT, 'apps', 'mobile', 'ios'))) {
      tip('ios/ 工程未生成', 'pnpm --filter @anyframe/mobile setup:native ios')
    } else {
      ok('ios/ 工程')
    }
  }
}

// ── 汇总 ────────────────────────────────────────────────────

section('汇总')
const matrix = [
  ['Windows 桌面', platform === 'win32' ? '本机可构建' : '需 windows runner'],
  ['Ubuntu 桌面', platform === 'linux' ? '本机可构建' : '需 ubuntu runner'],
  ['Web', '本机可构建'],
  ['Android', '本机可构建（需 JDK 21 + SDK）'],
  ['iOS', platform === 'darwin' ? '本机可构建' : '需 macos runner'],
]
for (const [name, note] of matrix) {
  const local = note === '本机可构建'
  console.log(`  ${local ? C.green + '●' : C.dim + '○'}${C.reset} ${name.padEnd(14)} ${C.dim}${note}${C.reset}`)
}
console.log(`\n${C.dim}electron-builder 不支持跨平台构建，这就是 CI 必须按平台拆 runner 的原因。${C.reset}`)
console.log(`${C.dim}GitHub Actions 上 macOS 的分钟计费是 Linux 的 10 倍，iOS 任务建议只在 tag 上触发。${C.reset}\n`)

if (hasError) {
  console.log(`${C.red}${C.bold}存在阻塞项，请按上面的提示修复。${C.reset}`)
  if (strict) process.exit(1)
} else if (hasWarn) {
  console.log(`${C.yellow}${C.bold}可以构建，但有若干提示项。${C.reset}`)
  // 提示项**不**让 --strict 失败，这是有意的，别「顺手」加上：
  // 提示里包含「当前平台产不出某某包」这类结构性事实 ——
  // windows runner 永远会提示产不出 deb，macOS 计费提示也永远在。
  // 若 --strict 对提示也返回 1，CI 里任何 runner 都过不了，
  // 这个开关就废了。硬失败只留给真正缺东西的 hasError。
} else {
  console.log(`${C.green}${C.bold}环境完整。${C.reset}`)
}
