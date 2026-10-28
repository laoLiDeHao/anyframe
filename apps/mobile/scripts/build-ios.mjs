#!/usr/bin/env node
/**
 * ─────────────────────────────────────────────────────────────
 * iOS 发布构建
 * ─────────────────────────────────────────────────────────────
 * 用法：
 *   pnpm --filter @anyframe/mobile dist:ios
 *     = vite build && cap sync ios && node scripts/build-ios.mjs
 *
 * ⚠️ 只能在 macOS 上运行。
 *    xcodebuild 与 CocoaPods 都没有跨平台实现，
 *    Linux / Windows 上无论装什么都产不出 ipa。
 *    CI 必须用 macos runner（代价：GitHub Actions 上 macOS 的
 *    分钟数是 Linux 的 10 倍，见 .github/workflows/build.yml）。
 *
 * 环境变量：
 *   ANYFRAME_IOS_FORMAT     appstore | adhoc（默认 adhoc）
 *   ANYFRAME_IOS_TEAM_ID    必填，Apple Developer 后台的 Team ID（10 位）
 *   ANYFRAME_IOS_BUNDLE_ID  默认读 capacitor.config.ts 的 appId
 *   ANYFRAME_IOS_SCHEME     默认 App
 *   ANYFRAME_VERSION_NAME   覆盖 CFBundleShortVersionString
 *   ANYFRAME_VERSION_CODE   覆盖 CFBundleVersion（build number）
 *
 * CI 自动签名（可选，缺了就只能靠本机已登录的 Apple ID）：
 *   ANYFRAME_IOS_ASC_KEY_ID       App Store Connect API Key ID（10 位）
 *   ANYFRAME_IOS_ASC_ISSUER_ID    API Key 的 Issuer ID（UUID）
 *   ANYFRAME_IOS_ASC_KEY_PATH     .p8 路径，默认搜索
 *                                 ~/.appstoreconnect/private_keys/AuthKey_<KEYID>.p8
 *
 * 产物输出到 apps/mobile/release/<version>/：
 *   AnyFrame-<version>-ios.ipa
 *   AnyFrame-<version>-ios.dSYM.zip     符号化崩溃栈必需
 */
import { spawnSync } from 'node:child_process'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const APP_ROOT = resolve(__dirname, '..')
const IOS = join(APP_ROOT, 'ios')
const PKG = JSON.parse(readFileSync(join(APP_ROOT, 'package.json'), 'utf8'))

const log = (...a) => console.log('\x1b[35m[ios]\x1b[0m', ...a)
const warn = (...a) => console.warn('\x1b[33m[ios]\x1b[0m', ...a)
const fail = (msg) => {
  console.error('\x1b[31m[ios]\x1b[0m', msg)
  process.exit(1)
}

function run(cmd, args, opts = {}) {
  log(`$ ${cmd} ${args.join(' ')}`)
  const r = spawnSync(cmd, args, { stdio: 'inherit', shell: false, ...opts })
  if (r.status !== 0) fail(`${cmd} 失败（退出码 ${r.status}）`)
  return r
}

function capture(cmd, args) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', shell: false })
  return (r.stdout ?? '').trim()
}

// ── 前置检查 ────────────────────────────────────────────────

if (process.platform !== 'darwin') {
  fail(
    'iOS 构建只能在 macOS 上进行。\n' +
    '  本地：换一台 Mac。\n' +
    '  CI：用 macos-15 / macos-latest runner（见 .github/workflows/build.yml）。\n' +
    '  云端 Mac：MacStadium / AWS EC2 Mac / GitHub 托管 runner。',
  )
}

if (!existsSync(IOS)) {
  fail('ios/ 工程不存在。先执行 pnpm --filter @anyframe/mobile setup:native')
}
if (!existsSync(join(APP_ROOT, 'dist'))) {
  fail('dist/ 不存在。先执行 pnpm --filter @anyframe/mobile build')
}

// Capacitor 8 要求 Xcode 26+。低版本上 cap sync 能过，
// 但编译会报 Swift 版本或 SDK 缺失，报错信息还特别绕。
function checkXcode() {
  const out = capture('xcodebuild', ['-version'])
  const m = /Xcode\s+(\d+)\.(\d+)/.exec(out)
  if (!m) {
    fail(
      'xcodebuild 不可用。请先执行：\n' +
      '  sudo xcode-select -s /Applications/Xcode.app/Contents/Developer\n' +
      '  sudo xcodebuild -license accept',
    )
  }
  const major = Number(m[1])
  if (major < 26) {
    fail(
      `检测到 Xcode ${major}.${m[2]}，Capacitor 8 需要 Xcode 26 或更高。\n` +
      '  低版本的典型报错是 iOS 部署目标不兼容或 Swift 运行时缺失，\n' +
      '  与真正的原因相距甚远，所以这里提前拦住。',
    )
  }
  log(`Xcode ${major}.${m[2]} ✓`)
}
checkXcode()

if (!existsSync('/usr/local/bin/pod') && capture('which', ['pod']) === '') {
  warn(
    '未检测到 CocoaPods。cap sync ios 会失败。\n' +
    '  brew install cocoapods  （推荐，别用 sudo gem install）',
  )
}

// ── 参数 ────────────────────────────────────────────────────

const format = process.env.ANYFRAME_IOS_FORMAT ?? 'adhoc'
if (format !== 'appstore' && format !== 'adhoc') {
  fail(`ANYFRAME_IOS_FORMAT 只能是 appstore 或 adhoc，收到：${format}`)
}

const teamId = process.env.ANYFRAME_IOS_TEAM_ID
if (!teamId) {
  fail(
    '缺少 ANYFRAME_IOS_TEAM_ID。\n' +
    '  在 https://developer.apple.com/account 右上角 Membership 里能看到，\n' +
    '  形如 A1B2C3D4E5（10 位字母数字）。',
  )
}

const cfgSrc = readFileSync(join(APP_ROOT, 'capacitor.config.ts'), 'utf8')
const bundleId =
  process.env.ANYFRAME_IOS_BUNDLE_ID ??
  /appId\s*:\s*['"]([^'"]+)['"]/.exec(cfgSrc)?.[1] ??
  'com.anyframe.app'

const scheme = process.env.ANYFRAME_IOS_SCHEME ?? 'App'
const versionName = process.env.ANYFRAME_VERSION_NAME ?? PKG.version
const versionCode = process.env.ANYFRAME_VERSION_CODE ?? '1'

const workspace = join(IOS, 'App', 'App.xcworkspace')
if (!existsSync(workspace)) {
  fail(
    `找不到 ${workspace}。\n` +
    '  注意要用 .xcworkspace 而不是 .xcodeproj ——\n' +
    '  有 CocoaPods 依赖时，用 xcodeproj 会漏掉 Pods，链接失败。',
  )
}

log(`scheme=${scheme} bundleId=${bundleId} team=${teamId} format=${format}`)

// ── CI 签名凭据 ─────────────────────────────────────────────
/**
 * `-allowProvisioningUpdates` + `CODE_SIGN_STYLE=Automatic` 在 CI 上
 * 需要一个 App Store Connect API Key 才能自动创建/复用描述文件，
 * 因为 runner 上没有登录态的 Apple ID，也没有可交互解锁的钥匙串。
 *
 * .p8 私钥放在 ~/.appstoreconnect/private_keys/AuthKey_<KEYID>.p8
 * （xcodebuild 的标准搜索路径，由 CI 写入，见 .github/workflows/build.yml）。
 * 显式再传一次 KeyID / IssuerID 是为了避免 runner 上残留多个 key 时选错。
 */
const authArgs = []
if (process.env.ANYFRAME_IOS_ASC_KEY_ID && process.env.ANYFRAME_IOS_ASC_ISSUER_ID) {
  authArgs.push(
    '-authenticationKeyID', process.env.ANYFRAME_IOS_ASC_KEY_ID,
    '-authenticationKeyIssuerID', process.env.ANYFRAME_IOS_ASC_ISSUER_ID,
  )
  if (process.env.ANYFRAME_IOS_ASC_KEY_PATH) {
    authArgs.push('-authenticationKeyPath', process.env.ANYFRAME_IOS_ASC_KEY_PATH)
  }
  log(`使用 App Store Connect API Key ${process.env.ANYFRAME_IOS_ASC_KEY_ID} 签名`)
} else if (process.env.CI) {
  warn(
    'CI 环境但未提供 ANYFRAME_IOS_ASC_KEY_ID / _ASC_ISSUER_ID。\n' +
    '  自动签名很可能报 "No Account for Team" 或 "No profiles for ... were found"。\n' +
    '  解决：在 App Store Connect → Users and Access → Integrations 生成 API Key（.p8），\n' +
    '  作为 secret 注入（见 .github/workflows/build.yml 的 mobile-ios job）。',
  )
}

// ── 解析 ExportOptions ──────────────────────────────────────

/**
 * 模板里用 __TEAM_ID__ / __BUNDLE_ID__ 占位，构建时替换后写到
 * ios/App/AnyFrame/ 下（该目录已被 gitignore）。
 *
 * 为什么不直接把 teamId 提交进仓库：
 * Team ID 本身不算机密，但把它和 bundle id、描述文件名放在一起，
 * 等于把签名拓扑公开了，社工钓鱼时很有用。CI secret 注入更干净。
 */
const tplName = format === 'appstore' ? 'ExportOptions.appstore.plist' : 'ExportOptions.adhoc.plist'
const tplCandidates = [
  join(IOS, 'App', 'AnyFrame', tplName),   // setup-native.mjs 复制过来的
  join(APP_ROOT, 'native', 'ios', tplName), // 直接从模板读
]
const tpl = tplCandidates.find((p) => existsSync(p))
if (!tpl) fail(`找不到 ${tplName}。先执行 setup-native.mjs，或检查 native/ios/`)

const exportOptionsPath = join(IOS, 'App', 'AnyFrame', `ExportOptions.${format}.resolved.plist`)
mkdirSync(dirname(exportOptionsPath), { recursive: true })
writeFileSync(
  exportOptionsPath,
  readFileSync(tpl, 'utf8')
    .replaceAll('__TEAM_ID__', teamId)
    .replaceAll('__BUNDLE_ID__', bundleId),
)
log(`ExportOptions → ${exportOptionsPath.replace(APP_ROOT + '/', '')}`)

// ── archive ─────────────────────────────────────────────────

const buildDir = join(APP_ROOT, 'build')
rmSync(buildDir, { recursive: true, force: true })
mkdirSync(buildDir, { recursive: true })
const archivePath = join(buildDir, 'AnyFrame.xcarchive')

// generic/platform=iOS：不绑定具体设备，产出可分发的 archive。
// 用 destination 'platform=iOS,name=某台设备' 会产出 development 签名，
// 无法上架，这是最常见的错误之一。
run('xcodebuild', [
  '-workspace', workspace,
  '-scheme', scheme,
  '-configuration', 'Release',
  '-destination', 'generic/platform=iOS',
  '-archivePath', archivePath,
  // 版本号从环境变量注入，避免手工改 Info.plist 后忘记提交
  `MARKETING_VERSION=${versionName}`,
  `CURRENT_PROJECT_VERSION=${versionCode}`,
  `DEVELOPMENT_TEAM=${teamId}`,
  // CI 上没有交互式钥匙串解锁，允许 xcodebuild 自行访问已导入的证书
  '-allowProvisioningUpdates',
  'CODE_SIGN_STYLE=Automatic',
  ...authArgs,
  'archive',
])

if (!existsSync(archivePath)) fail('archive 步骤结束但未产出 .xcarchive')

// ── export ──────────────────────────────────────────────────

const exportDir = join(buildDir, 'export')
run('xcodebuild', [
  '-exportArchive',
  '-archivePath', archivePath,
  '-exportPath', exportDir,
  '-exportOptionsPlist', exportOptionsPath,
  '-allowProvisioningUpdates',
  ...authArgs,
])

// ── 收集产物 ────────────────────────────────────────────────

const outDir = join(APP_ROOT, 'release', versionName)
mkdirSync(outDir, { recursive: true })

const ipas = existsSync(exportDir) ? readdirSync(exportDir).filter((f) => f.endsWith('.ipa')) : []
if (ipas.length === 0) fail(`导出目录里没有 ipa：${exportDir}`)

const ipaName = `AnyFrame-${versionName}-ios.ipa`
copyFileSync(join(exportDir, ipas[0]), join(outDir, ipaName))
log(`产物：release/${versionName}/${ipaName}`)

// dSYM 在 archive 里，不在 export 目录。
// 不上传它的话，Xcode Organizer / Crashlytics 里的崩溃栈全是地址。
const dsymRoot = join(archivePath, 'dSYMs')
if (existsSync(dsymRoot)) {
  const out = spawnSync('zip', ['-qry', join(outDir, `AnyFrame-${versionName}-ios.dSYM.zip`), '.'], {
    cwd: dsymRoot,
    stdio: 'inherit',
  })
  if (out.status === 0) {
    log(`产物：release/${versionName}/AnyFrame-${versionName}-ios.dSYM.zip`)
  } else {
    warn('dSYM 打包失败，请手动归档 ' + dsymRoot)
  }
} else {
  warn(`未找到 dSYM（${dsymRoot}）。若开启了 Debug Information Format = Dwarf，需改为 Dwarf with dSYM。`)
}

// DistributionSummary.plist 记录了实际使用的证书与描述文件，
// 排查签名问题时第一个要看的就是它。
const summary = join(exportDir, 'DistributionSummary.plist')
if (existsSync(summary)) {
  copyFileSync(summary, join(outDir, `DistributionSummary-${versionName}.plist`))
}

log('完成。')
if (format === 'appstore') {
  log('ipa 已直接上传到 App Store Connect（destination=upload）。')
  log('到 TestFlight 页面确认构建处理状态，通常需要 5~30 分钟。')
} else {
  log('Ad Hoc 产物。可传到分发平台，或：')
  log(`  xcrun devicectl device install app --device <UDID> ${join(outDir, ipaName)}`)
}
