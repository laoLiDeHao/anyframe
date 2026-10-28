#!/usr/bin/env node
/**
 * ─────────────────────────────────────────────────────────────
 * Android 发布构建
 * ─────────────────────────────────────────────────────────────
 * 用法：
 *   pnpm --filter @anyframe/mobile dist:android
 *     = vite build && cap sync android && node scripts/build-android.mjs
 *
 * 环境变量：
 *   ANYFRAME_ANDROID_FORMAT   bundle | apk | both（默认 both）
 *   ANYFRAME_ANDROID_STORE_FILE / _STORE_PASSWORD / _KEY_ALIAS / _KEY_PASSWORD
 *   ANYFRAME_REQUIRE_SIGNING  1 = 缺签名配置就失败（CI 用）
 *   ANYFRAME_ABI_SPLIT        1 = 按 ABI 拆分 APK
 *   ANYFRAME_VERSION_CODE     覆盖自动推导的 versionCode
 *   ANYFRAME_VERSION_NAME     覆盖 package.json 里的 version
 *
 * 产物输出到 apps/mobile/release/<version>/：
 *   AnyFrame-<version>-release.aab        上传 Google Play 用这个
 *   AnyFrame-<version>-release.apk        直装 / 内部分发用
 *   AnyFrame-<version>-arm64-v8a.apk      开了 ABI_SPLIT 才有
 *   mapping-release.txt                   R8 混淆映射，还原崩溃栈必需
 */
import { spawnSync } from 'node:child_process'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
} from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const APP_ROOT = resolve(__dirname, '..')
const ANDROID = join(APP_ROOT, 'android')
const PKG = JSON.parse(readFileSync(join(APP_ROOT, 'package.json'), 'utf8'))

const log = (...a) => console.log('\x1b[36m[android]\x1b[0m', ...a)
const warn = (...a) => console.warn('\x1b[33m[android]\x1b[0m', ...a)
const fail = (msg) => {
  console.error('\x1b[31m[android]\x1b[0m', msg)
  process.exit(1)
}

const isWindows = process.platform === 'win32'

// ── 前置检查 ────────────────────────────────────────────────

if (!existsSync(ANDROID)) {
  fail('android/ 工程不存在。先执行 pnpm --filter @anyframe/mobile setup:native')
}
if (!existsSync(join(APP_ROOT, 'dist'))) {
  fail('dist/ 不存在。先执行 pnpm --filter @anyframe/mobile build')
}
if (!existsSync(join(ANDROID, 'app', 'src', 'main', 'assets', 'public'))) {
  fail('未同步 Web 产物。先执行 npx cap sync android')
}

// JAVA_HOME 检查。Capacitor 8 要求 JDK 21，
// 用 JDK 17 会在 AGP 8.x 上报 "Unsupported class file major version" 之类的问题。
function checkJava() {
  const r = spawnSync('java', ['-version'], { encoding: 'utf8' })
  const out = `${r.stderr ?? ''}${r.stdout ?? ''}`
  const m = /version "(\d+)/.exec(out)
  if (!m) {
    warn('检测不到 java 版本。请确认已安装 JDK 21 并配好 JAVA_HOME / PATH。')
    return
  }
  const major = Number(m[1])
  if (major < 21) {
    fail(
      `检测到 JDK ${major}，Capacitor 8 / AGP 8.x 需要 JDK 21。\n` +
      '  Ubuntu: sudo apt install openjdk-21-jdk\n' +
      '  macOS : brew install --cask temurin@21\n' +
      '  Windows: winget install EclipseAdoptium.Temurin.21.JDK',
    )
  }
  log(`JDK ${major} ✓`)
}
checkJava()

// ── 版本号 ──────────────────────────────────────────────────

/**
 * versionCode 推导策略（Google Play 要求严格单调递增）：
 *   1. 环境变量显式指定（CI 里用 workflow run number 最稳）
 *   2. git 提交总数
 *   3. 距 2024-01-01 的小时数
 *
 * 用提交数的前提是历史线性；若有大量 merge，可能不严格递增，
 * 所以 CI 里更推荐直接注入 run number。
 */
function deriveVersionCode() {
  if (process.env.ANYFRAME_VERSION_CODE) return Number(process.env.ANYFRAME_VERSION_CODE)

  const r = spawnSync('git', ['rev-list', '--count', 'HEAD'], {
    cwd: APP_ROOT,
    encoding: 'utf8',
  })
  const n = Number((r.stdout ?? '').trim())
  if (Number.isFinite(n) && n > 0) {
    log(`versionCode 由 git 提交数推导：${n}`)
    return n
  }

  const fallback = Math.floor(
    (Date.now() - Date.UTC(2024, 0, 1)) / 3_600_000,
  )
  warn(`无法从 git 推导 versionCode，回退为小时计数：${fallback}`)
  return fallback
}

const versionName = process.env.ANYFRAME_VERSION_NAME ?? PKG.version
const versionCode = deriveVersionCode()
log(`版本：${versionName} (${versionCode})`)

// ── 签名检查 ────────────────────────────────────────────────

const canSign = Boolean(
  process.env.ANYFRAME_ANDROID_STORE_FILE &&
  process.env.ANYFRAME_ANDROID_STORE_PASSWORD &&
  process.env.ANYFRAME_ANDROID_KEY_ALIAS &&
  process.env.ANYFRAME_ANDROID_KEY_PASSWORD,
)

const keystoreProps = join(ANDROID, 'keystore.properties')
if (!canSign && !existsSync(keystoreProps)) {
  if (process.env.ANYFRAME_REQUIRE_SIGNING === '1') {
    fail(
      '缺少 Android 签名配置（CI 模式）。需要注入：\n' +
      '  ANYFRAME_ANDROID_STORE_FILE / _STORE_PASSWORD / _KEY_ALIAS / _KEY_PASSWORD',
    )
  }
  warn(
    '未配置签名，release 包将使用 debug 签名。\n' +
    '  可以安装测试，但**不能**上传 Google Play，也不能覆盖安装已签名的正式包。\n' +
    '  配置方法见 native/android/keystore.properties.example',
  )
} else if (!canSign) {
  log('使用 android/keystore.properties 签名')
} else {
  log('使用环境变量注入的签名配置')
}

// ── 执行构建 ────────────────────────────────────────────────

const format = process.env.ANYFRAME_ANDROID_FORMAT ?? 'both'
const tasks = []
if (format === 'bundle' || format === 'both') tasks.push('bundleRelease')
if (format === 'apk' || format === 'both') tasks.push('assembleRelease')
if (tasks.length === 0) fail(`ANYFRAME_ANDROID_FORMAT 无效：${format}`)

const gradlew = join(ANDROID, isWindows ? 'gradlew.bat' : 'gradlew')
if (!existsSync(gradlew)) fail(`找不到 ${gradlew}`)

// 非 Windows 下 gradlew 需要可执行位。
// 从 zip 解包或某些 git 配置下会丢失 +x，报 "Permission denied"。
if (!isWindows) {
  spawnSync('chmod', ['+x', gradlew])
}

log(`$ gradlew ${tasks.join(' ')}（首次构建需下载 Gradle 与依赖，可能数分钟）`)

const env = {
  ...process.env,
  ANYFRAME_VERSION_NAME: versionName,
  ANYFRAME_VERSION_CODE: String(versionCode),
  // Gradle 守护进程在 CI 上反而更慢（每次都要预热 JVM），关掉
  ...(process.env.CI ? { GRADLE_OPTS: '-Dorg.gradle.daemon=false' } : {}),
}

const r = spawnSync(gradlew, [...tasks, '--stacktrace'], {
  cwd: ANDROID,
  stdio: 'inherit',
  env,
  shell: isWindows, // Windows 下 .bat 必须经 shell 才能执行
})
if (r.status !== 0) {
  fail(`Gradle 构建失败（退出码 ${r.status}）`)
}

// ── 收集产物 ────────────────────────────────────────────────

const outDir = join(APP_ROOT, 'release', versionName)
rmSync(outDir, { recursive: true, force: true })
mkdirSync(outDir, { recursive: true })

const apkDir = join(ANDROID, 'app', 'build', 'outputs', 'apk', 'release')
const aabDir = join(ANDROID, 'app', 'build', 'outputs', 'bundle', 'release')
const mappingDir = join(ANDROID, 'app', 'build', 'outputs', 'mapping', 'release')

const copied = []

function collect(dir, pattern, rename) {
  if (!existsSync(dir)) return
  for (const name of readdirSync(dir)) {
    if (!pattern.test(name)) continue
    const target = join(outDir, rename ? rename(name) : name)
    copyFileSync(join(dir, name), target)
    copied.push(target)
  }
}

// Gradle 产出的默认名字是 app-release.aab / app-arm64-v8a-release.apk，
// 五个端的产物汇总到一起后完全分不清谁是谁，统一重命名成
// AnyFrame-<version>-<abi?>-<format>。
collect(aabDir, /\.aab$/, (name) => {
  const abi = /-(arm64-v8a|armeabi-v7a|x86_64|x86|universal)-/.exec(name)?.[1]
  return `AnyFrame-${versionName}${abi ? `-${abi}` : ''}.aab`
})
collect(apkDir, /\.apk$/, (name) => {
  const abi = /-(arm64-v8a|armeabi-v7a|x86_64|x86|universal)-/.exec(name)?.[1]
  return `AnyFrame-${versionName}${abi ? `-${abi}` : ''}.apk`
})
collect(mappingDir, /^mapping\.txt$/, () => `mapping-${versionName}.txt`)

if (copied.length === 0) {
  fail(
    '构建成功但没找到产物。检查：\n' +
    `  ${aabDir}\n  ${apkDir}`,
  )
}

log(`产物已输出到 ${outDir.replace(APP_ROOT + '/', '')}/`)
for (const f of copied) log(`  · ${f.split(/[\\/]/).pop()}`)

// mapping.txt 是 R8 混淆映射，线上崩溃栈还原全靠它。
// 丢了就等于这个版本的崩溃日志永久不可读，所以这里专门提醒。
if (existsSync(join(mappingDir, 'mapping.txt'))) {
  warn('请归档 mapping.txt（CI 里已作为 artifact 上传）。丢失后该版本的崩溃栈无法还原。')
}
