# 移动端原生层

`apps/mobile/android/` 与 `apps/mobile/ios/` **不在版本库里**。
它们是 `npx cap add` 的生成物，由 `scripts/setup-native.mjs` 应用本目录下的补丁得到。

仓库里只保存三样东西：补丁片段、原生源码、应用补丁的脚本。

## 为什么这么做

Capacitor 每次大版本升级都会重写原生工程里的模板文件 —— Gradle 版本、AGP 版本、
`variables.gradle`、`MainActivity`、`Info.plist` 的基础键。如果把整个 `android/`
提交进仓库，每次升级都要在「Capacitor 的新模板」和「我们的改动」之间手工三方合并，
而且冲突点分散在十几个文件里。

补丁化的代价是脚本要做字符串插入，收益是：

- diff 里只看得到我们真正改了什么
- 升级 Capacitor 时，模板变更自动生效，补丁照常应用
- 删掉 `android/` 重跑一次 `setup:native` 就能还原，不存在「本地能构建、CI 不行」

## 目录

```
native/
├── android/
│   ├── AndroidManifest.fragment.xml   权限 + specialUse 前台服务声明（含依据说明）
│   ├── app.build.gradle.fragment      签名 / R8 / versionCode 注入 / webDir 校验
│   ├── proguard-rules.pro             R8 规则（缺了会导致插件调用永久挂起）
│   ├── keystore.properties.example    签名配置模板（真实文件已 gitignore）
│   └── kotlin/com/anyframe/app/
│       ├── plugin/LocalServicePlugin.kt    Capacitor 插件：拉起服务、申请权限
│       └── service/LocalHttpService.kt     前台服务 + 127.0.0.1 HTTP 服务
└── ios/
    ├── Info.plist.patch.xml           ATS / 文件共享 / 后台模式 / 出口合规
    ├── ExportOptions.appstore.plist   App Store Connect 上架
    └── ExportOptions.adhoc.plist      Ad Hoc 内部分发
```

## 首次使用

```bash
pnpm install
pnpm --filter @anyframe/mobile build          # 产出 dist/
pnpm --filter @anyframe/mobile setup:native   # cap add + 应用补丁 + cap sync
pnpm --filter @anyframe/mobile open:android   # 或直接 run:android 上真机
```

iOS 部分只在 macOS 上执行；在 Windows / Linux 上运行会自动跳过并给出提示。

## 三处最容易踩的坑

**1. `webDir` 必须是 `dist`**
Capacitor CLI 8.5.3 的 `cap init` 会忽略传入的 webDir 参数，永远写 `"www"`。
写成 `www` 的症状是 App 打开一片空白、或显示上一次构建的旧内容，且没有任何报错。
`setup-native.mjs` 启动时会校验这一项，`app.build.gradle.fragment` 里的
`afterEvaluate` 还会在 Gradle 构建时再拦一次。

**2. `registerPlugin` 必须在 `super.onCreate()` 之前**
放在之后的话插件注册不上，前端调用会永远挂在 promise 上，
既不 resolve 也不 reject，logcat 里也没有任何相关输出。

**3. 前台服务类型必须是 `specialUse`**
Android 15（API 35）给 `dataSync` 加了 6 小时/24 小时的硬时限，超时直接杀服务。
`specialUse` 没有时限，但代价是三项：清单里要写 `<property>` 说明用途、
要申请 `FOREGROUND_SERVICE_SPECIAL_USE` 权限、
并且必须在 Play Console「应用内容 → 前台服务类型」里同步申报 ——
只改代码不申报，提交时会被拒。

即使三项都做对了，小米 / 华为 / OPPO / vivo 的 ROM 仍会在息屏后杀进程。
代码层面无法根治，只能引导用户关闭电池优化
（`LocalServicePlugin.requestBatteryExemption`）。
这就是 `packages/core/src/capabilities.ts` 里把 Android 的 `background`
定为 `foreground-only` 而不是 `persistent` 的原因 —— 别对用户撒谎。

## iOS 的能力上限

`Info.plist.patch.xml` 里 `UIBackgroundModes` **只加了 `fetch`**，没有 `audio`。

常见的「播放无声音频保活」做法违反 App Store 审核指南 2.5.4，
上架后会被自动扫描出来并下架。能合法常驻后台的只有真在放声音的 audio、
真在导航的 location、voip、newsstand、external-accessory、bluetooth-central 等，
一个本地运行时哪个都不沾边。

所以 iOS 端 `background = foreground-transient`：前台正常跑，
切后台数秒即 suspend，回前台自动恢复。UI 会如实告知用户，
而不是假装能做到常驻。

同理，iOS 上 `spawn` 永久不可行（审核指南 2.5.2 禁止下载或执行代码），
有线硬件需要 MFi 认证，实际可用的硬件通道只有 BLE。
