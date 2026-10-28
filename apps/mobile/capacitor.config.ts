import type { CapacitorConfig } from '@capacitor/cli'

/**
 * ═══════════════════════════════════════════════════════════════
 *  Capacitor 8 配置
 *  产物：Android .aab/.apk 、iOS .ipa
 *
 *  工具链硬要求（Capacitor 8）：
 *    Node.js >= 22
 *    JDK 21
 *    Android Studio Otter（compileSdk 36）
 *    Xcode 26+   ← 2026-04-28 起 App Store Connect 拒绝旧 Xcode 构建的包
 * ═══════════════════════════════════════════════════════════════
 */

const config: CapacitorConfig = {
  appId: 'com.anyframe.app',
  appName: 'AnyFrame',

  // ── ⚠️ 必须显式写 'dist' ────────────────────────────────────
  // Capacitor CLI 8.5.3 存在已知问题：`npx cap init` 的第三个位置参数
  // （webDir）不生效，永远写成 "www"。而 Vite 的产物在 dist/。
  // 症状：cap sync 后 App 打开是空白页或旧内容。
  // 这里硬编码，并在 scripts/setup-native.mjs 中做校验。
  webDir: 'dist',

  // ── Android WebView scheme ─────────────────────────────────
  // 默认是 http://localhost。桌面 Chrome 会把 localhost 视作安全上下文，
  // 但 Android WebView 的实现并不一致，实测会导致：
  //   - crypto.subtle 不可用
  //   - Service Worker 注册失败
  //   - 部分需要安全上下文的设备 API 被禁用
  // 设为 https 后 WebView 源变成 https://localhost，上述限制一律解除。
  //
  // 副作用只有一个，而且是可控的：页面成了 https，明文 http 子资源会被
  // 混合内容策略拦截。但**本地回环地址是例外**（见下面 allowMixedContent
  // 的注释），所以本地服务仍然可以直接 fetch，不需要退回 Capacitor 桥。
  android: {
    // NEVER_ALLOW：https 页面里的明文 http 子资源一律拦截。
    // 这不影响本地服务 —— loopback（127.0.0.1 / localhost）在 W3C Mixed
    // Content 规范里属于 potentially trustworthy origin，Chromium 在走到
    // 混合内容检查之前就把它放行了，所以 WebView 里 fetch http://127.0.0.1:47810
    // 完全合法。真正的门槛是 CSP 的 connect-src（见 index.html）和
    // iOS 的 ATS（见 native/ios/Info.plist.patch.xml 的 NSAllowsLocalNetworking）。
    allowMixedContent: false,
    captureInput: true,
    webContentsDebuggingEnabled: process.env.NODE_ENV !== 'production',
    backgroundColor: '#0f1115',
    // 关闭 WebView 的过度滚动辉光，观感更接近原生
    overrideUserAgent: undefined,
  },

  ios: {
    contentInset: 'automatic',
    scrollEnabled: true,
    backgroundColor: '#0f1115',
    // WKWebView 源为 capacitor://localhost（或 Ionic 的 https://localhost）
    // 同样是安全上下文，无需额外配置
    limitsNavigationsToAppBoundDomains: false,
  },

  // ── 生产环境禁用明文 HTTP ──────────────────────────────────
  server: {
    androidScheme: 'https',
    // 若需让 App 加载远端 Web 版（热更新场景），取消下面注释。
    // 注意：iOS 上加载远端内容受审核指南 2.5.2 约束，
    // 只能更新 HTML/CSS/JS，不能改变应用的主要功能形态。
    // url: 'https://app.anyframe.local',
    // cleartext: false,
  },

  plugins: {
    SplashScreen: {
      launchShowDuration: 800,
      backgroundColor: '#0f1115',
      showSpinner: true,
      spinnerColor: '#2563eb',
      androidScaleType: 'CENTER_CROP',
      splashFullScreen: true,
      splashImmersive: true,
    },
    StatusBar: {
      style: 'DARK',
      backgroundColor: '#0f1115',
      overlaysWebView: false,
    },
    Keyboard: {
      resizeOnFullScreen: true,
    },
    Filesystem: {
      // iOS 沙箱根目录。所有 fs 操作都必须落在这里或 Documents 下，
      // 与 capabilities.ts 中 IOS.fileSystem = 'sandbox' 对应。
      ios: {
        // 允许 iCloud 备份用户数据目录
        iCloudBackUp: true,
      },
    },
  },

  // ── 构建产物中排除的源文件 ─────────────────────────────────
  // Capacitor 会把 webDir 整个拷进原生工程，
  // sourcemap 不要带进发布包（会泄露源码结构）。
  // 由 scripts/build-android.mjs / build-ios.mjs 在 sync 前清理。
}

export default config
