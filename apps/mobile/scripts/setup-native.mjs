#!/usr/bin/env node
/**
 * ─────────────────────────────────────────────────────────────
 * 移动端原生工程初始化 / 补丁应用
 * ─────────────────────────────────────────────────────────────
 * 用法：
 *   pnpm --filter @anyframe/mobile setup:native            # 按当前系统能做的都做
 *   pnpm --filter @anyframe/mobile setup:native android    # 只处理 Android
 *   pnpm --filter @anyframe/mobile setup:native ios        # 只处理 iOS
 *   pnpm --filter @anyframe/mobile setup:native --reset    # 删掉原生工程重建
 *
 * 设计前提：android/ 与 ios/ 是**生成物**，不进版本库（见 .gitignore）。
 * 仓库里只保存 native/ 下的补丁片段与本脚本。
 * 这样 Capacitor 升级重写模板时不会产生冲突，
 * 也让 code review 只看得到我们真正改了什么。
 *
 * 全流程可重复执行：每一步都先检查标记，已应用则跳过。
 */
import { spawnSync } from 'node:child_process'
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const APP_ROOT = resolve(__dirname, '..')
const NATIVE = join(APP_ROOT, 'native')
const ANDROID = join(APP_ROOT, 'android')
const IOS = join(APP_ROOT, 'ios')

/** 幂等标记。出现在目标文件里就说明补丁已应用过。 */
const MARKER = 'anyframe:native-patch'

const argv = process.argv.slice(2)
const wantReset = argv.includes('--reset')
const targets = argv.filter((a) => a === 'android' || a === 'ios')
const isDarwin = process.platform === 'darwin'

// ── 工具 ────────────────────────────────────────────────────

const log = (...a) => console.log('\x1b[36m[setup]\x1b[0m', ...a)
const warn = (...a) => console.warn('\x1b[33m[setup]\x1b[0m', ...a)
const fail = (msg) => {
  console.error('\x1b[31m[setup]\x1b[0m', msg)
  process.exit(1)
}

function run(cmd, args, opts = {}) {
  log(`$ ${cmd} ${args.join(' ')}`)
  const r = spawnSync(cmd, args, { stdio: 'inherit', shell: false, ...opts })
  if (r.status !== 0) fail(`${cmd} 退出码 ${r.status}`)
}

function patched(text) {
  return text.includes(MARKER)
}

/** 把 fragment 文件里的 XML 注释保留、只取需要的节点 */
function read(f) {
  return readFileSync(f, 'utf8')
}

// ── 前置校验 ────────────────────────────────────────────────

/**
 * 校验 capacitor.config.ts 的 webDir。
 *
 * Capacitor CLI 8.5.3 有个已知问题：`npx cap init` 的第三个位置参数
 * （webDir）不生效，永远写成 "www"。而 Vite 的产物在 dist/。
 * 症状是 cap sync 之后 App 打开一片空白，或者显示上一次构建的旧内容，
 * 且不会有任何报错 —— 所以这里主动拦一道。
 */
function assertWebDir() {
  const cfgPath = join(APP_ROOT, 'capacitor.config.ts')
  if (!existsSync(cfgPath)) fail(`缺少 ${cfgPath}`)
  const src = read(cfgPath)

  const m = /webDir\s*:\s*['"]([^'"]+)['"]/.exec(src)
  if (!m) fail('capacitor.config.ts 里找不到 webDir，必须显式设为 "dist"')
  if (m[1] !== 'dist') {
    fail(
      `capacitor.config.ts 的 webDir 是 "${m[1]}"，应为 "dist"。\n` +
      '  Vite 产物在 dist/，写成 www 会让 App 加载空目录 → 白屏。',
    )
  }
  log('webDir = dist ✓')
}

/**
 * 校验依赖是否装了。
 * pnpm 的 isolated linker 不会把 @capacitor/cli 提升到根目录，
 * 在 monorepo 子包里直接敲 npx cap 有时找不到，这里明确检查。
 */
function assertDeps() {
  const pkg = JSON.parse(read(join(APP_ROOT, 'package.json')))
  const need = ['@capacitor/core', '@capacitor/android']
  for (const n of need) {
    if (!pkg.dependencies?.[n]) fail(`package.json 缺少依赖 ${n}`)
  }
  if (!existsSync(join(APP_ROOT, 'node_modules', '@capacitor', 'cli'))) {
    fail('未找到 @capacitor/cli，请先在仓库根目录执行 pnpm install')
  }
}

// ── 生成原生工程 ────────────────────────────────────────────

function cap(...args) {
  // 用 node 直接跑 CLI 入口，避免 npx 在 pnpm workspace 下的解析歧义
  const cli = join(APP_ROOT, 'node_modules', '@capacitor', 'cli', 'bin', 'capacitor')
  run(process.execPath, [cli, ...args], { cwd: APP_ROOT })
}

function ensureAndroid() {
  if (wantReset && existsSync(ANDROID)) {
    warn('--reset：删除现有 android/ 工程')
    rmSync(ANDROID, { recursive: true, force: true })
  }
  if (!existsSync(ANDROID)) {
    log('生成 Android 工程…')
    cap('add', 'android')
  } else {
    log('android/ 已存在，跳过 cap add')
  }
}

function ensureIos() {
  if (!isDarwin) {
    warn('当前不是 macOS，跳过 iOS 工程生成。')
    warn('iOS 只能在 macOS 上构建（xcodebuild + CocoaPods 均无跨平台实现）。')
    warn('CI 里请用 macos runner，见 .github/workflows/build.yml。')
    return false
  }
  if (wantReset && existsSync(IOS)) {
    warn('--reset：删除现有 ios/ 工程')
    rmSync(IOS, { recursive: true, force: true })
  }
  if (!existsSync(IOS)) {
    log('生成 iOS 工程…')
    cap('add', 'ios')
  } else {
    log('ios/ 已存在，跳过 cap add')
  }
  return true
}

// ── Android 补丁 ────────────────────────────────────────────

const ANDROID_PERMISSIONS = `
    <!-- ${MARKER}:permissions -->
    <uses-permission android:name="android.permission.FOREGROUND_SERVICE" />
    <uses-permission android:name="android.permission.FOREGROUND_SERVICE_SPECIAL_USE" />
    <uses-permission android:name="android.permission.POST_NOTIFICATIONS" />
    <uses-permission android:name="android.permission.INTERNET" />
    <uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />
    <uses-permission android:name="android.permission.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS" />
`

const ANDROID_SERVICE = `
        <!-- ${MARKER}:service -->
        <!--
          foregroundServiceType 必须是 specialUse。
          Android 15（API 35）给 dataSync 加了 6 小时/24 小时 硬时限，
          超时系统直接杀服务；specialUse 没有时限。
          代价：<property> 里的说明必填，且要在 Play Console
          「应用内容 → 前台服务类型」同步申报，只改代码不申报会被拒。
        -->
        <service
            android:name="com.anyframe.app.service.LocalHttpService"
            android:exported="false"
            android:foregroundServiceType="specialUse"
            android:stopWithTask="false"
            tools:targetApi="34">
            <property
                android:name="android.app.PROPERTY_SPECIAL_USE_FGS_SUBTYPE"
                android:value="Runs a loopback-only (127.0.0.1) local runtime that serves the app's own WebView. The user explicitly starts and stops it from the UI, and a persistent notification reports whether it is running. No user data leaves the device." />
        </service>
`

function patchAndroidManifest() {
  const f = join(ANDROID, 'app', 'src', 'main', 'AndroidManifest.xml')
  if (!existsSync(f)) return fail(`找不到 ${f}`)
  let src = read(f)
  if (patched(src)) return log('AndroidManifest.xml 已打过补丁，跳过')

  // xmlns:tools 是 <property tools:targetApi> 必需的命名空间。
  // Capacitor 模板里不一定带，缺了会报 "unexpected element <property>"。
  if (!src.includes('xmlns:tools')) {
    src = src.replace(
      '<manifest',
      '<manifest\n    xmlns:tools="http://schemas.android.com/tools"',
    )
  }

  // 权限插到 <application 之前（必须是 <manifest> 的直接子节点）
  const appIdx = src.search(/<application[\s>]/)
  if (appIdx < 0) fail('AndroidManifest.xml 里找不到 <application>')
  src = src.slice(0, appIdx) + ANDROID_PERMISSIONS + '\n    ' + src.slice(appIdx)

  // service 插到 </application> 之前
  const endApp = src.lastIndexOf('</application>')
  if (endApp < 0) fail('AndroidManifest.xml 里找不到 </application>')
  src = src.slice(0, endApp) + ANDROID_SERVICE + '    ' + src.slice(endApp)

  writeFileSync(f, src)
  log('AndroidManifest.xml ✓（权限 + specialUse 前台服务）')
}

function patchAndroidGradle() {
  const f = join(ANDROID, 'app', 'build.gradle')
  if (!existsSync(f)) {
    // Capacitor 8 仍用 Groovy DSL；若将来切到 kts，这里会先报错而不是静默失败
    const kts = join(ANDROID, 'app', 'build.gradle.kts')
    return fail(
      existsSync(kts)
        ? 'android/app/build.gradle.kts 存在：Capacitor 已切到 Kotlin DSL，本脚本的 Groovy 片段需要改写。'
        : `找不到 ${f}`,
    )
  }
  let src = read(f)
  const fragment = read(join(NATIVE, 'android', 'app.build.gradle.fragment'))
  const marker = `\n// ${MARKER}\n`
  const previous = src.indexOf(marker)
  // 该尾部由本脚本生成；重跑时更新它，保证旧工程也能得到签名/编译修复。
  if (previous >= 0) src = src.slice(0, previous)

  // 追加而不是原地改。Gradle 允许 `android { ... }` 出现多次，
  // 配置是累加的 —— 这比用正则去改模板内部结构稳得多，
  // Capacitor 升级重排了 build.gradle 也不会失效。
  src += marker + fragment + '\n'

  writeFileSync(f, src)
  log('app/build.gradle ✓（签名 / R8 / versionCode 注入 / webDir 校验）')
}

function patchAndroidKotlin() {
  const rootFile = join(ANDROID, 'build.gradle')
  let root = read(rootFile)
  if (!root.includes('org.jetbrains.kotlin:kotlin-gradle-plugin:')) {
    const next = root.replace(
      /(classpath\s+['"]com\.android\.tools\.build:gradle:[^'"]+['"])/,
      `$1\n        classpath 'org.jetbrains.kotlin:kotlin-gradle-plugin:2.1.20'`,
    )
    if (next === root) fail('无法在根 build.gradle 中定位 Android Gradle 插件')
    writeFileSync(rootFile, next)
  }
  const appFile = join(ANDROID, 'app', 'build.gradle')
  let app = read(appFile)
  if (!app.includes("apply plugin: 'org.jetbrains.kotlin.android'")) {
    app = app.replace(
      "apply plugin: 'com.android.application'",
      "apply plugin: 'com.android.application'\napply plugin: 'org.jetbrains.kotlin.android'",
    )
    writeFileSync(appFile, app)
  }
  log('Kotlin 编译插件 ✓（JVM 21）')
}

function patchProguard() {
  const f = join(ANDROID, 'app', 'proguard-rules.pro')
  mkdirSync(dirname(f), { recursive: true })
  const existing = existsSync(f) ? read(f) : ''
  if (patched(existing)) return log('proguard-rules.pro 已打过补丁，跳过')

  const rules = read(join(NATIVE, 'android', 'proguard-rules.pro'))
  writeFileSync(f, `${existing}\n# ${MARKER}\n${rules}\n`)
  log('proguard-rules.pro ✓')
}

/**
 * 复制 Kotlin 源码。
 *
 * 放在 app/src/main/java/ 下而不是 kotlin/ —— 这是 AGP 的默认 sourceSet，
 * 启用 Kotlin 插件后，java/ 下的 Kotlin 文件也会被编译。
 * 反过来若放 kotlin/ 目录，就得在 build.gradle 里加 sourceSets 声明。
 */
function copyKotlin() {
  const srcRoot = join(NATIVE, 'android', 'kotlin')
  if (!existsSync(srcRoot)) return warn('native/android/kotlin 不存在，跳过')

  const dstRoot = join(ANDROID, 'app', 'src', 'main', 'java')
  cpSync(srcRoot, dstRoot, { recursive: true })
  log(`Kotlin 源码 → ${dstRoot.replace(APP_ROOT + '/', '')}`)
}

/**
 * 在 MainActivity 里注册插件。
 *
 * ⚠️ registerPlugin 必须在 super.onCreate() **之前**调用。
 *    放在之后插件注册不上，前端调用会永远挂在 promise 上，
 *    既不 resolve 也不 reject，也没有任何日志 —— 极难排查。
 *
 * Capacitor 生成的是 Java 文件（不是 Kotlin），所以这里按 Java 改。
 */
function patchMainActivity() {
  const java = join(ANDROID, 'app', 'src', 'main', 'java', 'com', 'anyframe', 'app', 'MainActivity.java')
  const kt = java.replace(/\.java$/, '.kt')
  const f = existsSync(java) ? java : existsSync(kt) ? kt : null

  if (!f) {
    return warn(
      '找不到 MainActivity（appId 可能不是 com.anyframe.app）。' +
      '请手动在其中注册 LocalServicePlugin，且必须在 super.onCreate() 之前。',
    )
  }

  let src = read(f)
  if (patched(src)) return log('MainActivity 已注册插件，跳过')

  if (f.endsWith('.java')) {
    const replaced = src.replace(
      /public\s+class\s+MainActivity\s+extends\s+BridgeActivity\s*\{\s*\}/,
      `public class MainActivity extends BridgeActivity {
    // ${MARKER}
    @Override
    public void onCreate(android.os.Bundle savedInstanceState) {
        // 必须在 super.onCreate() 之前，否则插件注册不上且无任何报错
        registerPlugin(com.anyframe.app.plugin.LocalServicePlugin.class);
        super.onCreate(savedInstanceState);
    }
}`,
      )
    if (replaced === src) {
      return warn(
        'MainActivity.java 的结构与预期不符，未能自动插入 registerPlugin。' +
        '请手动添加（位置：super.onCreate() 之前）。',
      )
    }
    src = replaced
  } else {
    const replaced = src.replace(
      /class\s+MainActivity\s*:\s*BridgeActivity\(\)\s*\{?\s*\}?/,
      `// ${MARKER}
class MainActivity : BridgeActivity() {
    override fun onCreate(savedInstanceState: android.os.Bundle?) {
        registerPlugin(com.anyframe.app.plugin.LocalServicePlugin::class.java)
        super.onCreate(savedInstanceState)
    }
}`,
      )
    if (replaced === src) {
      return warn('MainActivity.kt 的结构与预期不符，请手动注册 LocalServicePlugin。')
    }
    src = replaced
  }

  writeFileSync(f, src)
  log('MainActivity ✓（已注册 AnyFrameLocalService 插件）')
}

// ── iOS 补丁 ────────────────────────────────────────────────

/**
 * 合并 Info.plist。
 *
 * 做法：取 patch 文件里最外层 <dict> 的内容，插到目标 plist 的
 * 最后一个 </dict> 之前。plist 是扁平的 key/value 序列，
 * 后出现的同名 key 会覆盖前面的 —— 但为了可读性，
 * 我们在插入前先把目标里已存在的同名 key 删掉是不现实的
 * （plist 的值可能是嵌套 dict），所以用标记做整体幂等：
 * 打过一次就不再打。
 */
function patchInfoPlist() {
  const f = join(IOS, 'App', 'App', 'Info.plist')
  if (!existsSync(f)) return warn(`找不到 ${f}，跳过 Info.plist 补丁`)

  let src = read(f)
  if (patched(src)) return log('Info.plist 已打过补丁，跳过')

  const patch = read(join(NATIVE, 'ios', 'Info.plist.patch.xml'))
  const start = patch.indexOf('<dict>')
  const end = patch.lastIndexOf('</dict>')
  if (start < 0 || end < 0) fail('Info.plist.patch.xml 结构异常')
  const inner = patch.slice(start + '<dict>'.length, end)

  const insertAt = src.lastIndexOf('</dict>')
  if (insertAt < 0) fail('目标 Info.plist 结构异常：找不到 </dict>')

  src =
    src.slice(0, insertAt) +
    `\t<!-- ${MARKER} -->\n` +
    inner +
    '\t<!-- /' + MARKER + ' -->\n' +
    src.slice(insertAt)

  writeFileSync(f, src)
  log('Info.plist ✓（ATS 本地明文 / 文件共享 / 后台模式 / 出口合规）')
}

function copyIosAssets() {
  const dst = join(IOS, 'App', 'AnyFrame')
  mkdirSync(dst, { recursive: true })
  for (const name of ['ExportOptions.appstore.plist', 'ExportOptions.adhoc.plist']) {
    const from = join(NATIVE, 'ios', name)
    if (existsSync(from)) cpSync(from, join(dst, name))
  }
  log('ExportOptions.plist ✓')
}

/**
 * iOS 的本地服务实现说明。
 *
 * 这里刻意**不**生成 Swift 代码：
 * iOS 上「内嵌 HTTP 服务」用 Swift 实现和 Android 那份 Kotlin 是两套代码，
 * 且 iOS 端服务切后台数秒即挂起，实用价值远低于 Android。
 * 默认策略是 iOS 端把 service 能力报成 embedded 但不常驻，
 * 由 packages/core/src/capabilities.ts 的 IOS 基线如实反映。
 *
 * 若确实需要，参考实现路径：
 *   - NWListener（Network.framework）监听 127.0.0.1，比自建 socket 省事
 *   - 用 GCDWebServer / Swifter 这类库处理 HTTP 解析
 *   - 注册为 Capacitor 插件：@objc(AnyFrameLocalService)
 *     并在 AppDelegate 或 CapacitorBuilder 里 registerPluginType
 */

// ── 主流程 ──────────────────────────────────────────────────

function main() {
  log(`应用目录: ${APP_ROOT}`)
  assertWebDir()
  assertDeps()

  const doAndroid = targets.length === 0 || targets.includes('android')
  const doIos = targets.length === 0 || targets.includes('ios')

  if (doAndroid) {
    ensureAndroid()
    copyKotlin()
    patchAndroidManifest()
    patchAndroidGradle()
    patchAndroidKotlin()
    patchProguard()
    patchMainActivity()
  }

  let iosReady = false
  if (doIos) {
    iosReady = ensureIos()
    if (iosReady) {
      patchInfoPlist()
      copyIosAssets()
    }
  }

  // sync 会把 dist/ 拷进原生工程的 assets/public（Android）
  // 或 App/public（iOS），并执行 pod install。
  // 必须先 pnpm build，否则拷的是空目录 —— gradle 片段里有对应校验。
  const dist = join(APP_ROOT, 'dist')
  if (!existsSync(dist)) {
    warn('dist/ 不存在，跳过 cap sync。请先执行 pnpm build。')
  } else {
    if (doAndroid) cap('sync', 'android')
    if (iosReady) cap('sync', 'ios')
  }

  log('完成。')
  if (doAndroid) log('  下一步：pnpm --filter @anyframe/mobile open:android  （或 run:android 直接上真机）')
  if (iosReady) log('  下一步：pnpm --filter @anyframe/mobile open:ios')
  if (doIos && !iosReady) log('  iOS 需在 macOS 上执行，或交给 CI 的 macos runner。')
}

main()
