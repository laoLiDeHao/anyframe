# 五端构建矩阵

这份文档是「一张表看懂五个端」的速查手册。
代码里的真相源是 [`packages/core/src/capabilities.ts`](packages/core/src/capabilities.ts)，
两者必须同步修改。

---

## 1. 总览

| 端 | 宿主形态 | 运行时 | 打包工具 | CI runner | 产物 |
| --- | --- | --- | --- | --- | --- |
| Windows 桌面 | Electron 主进程 | Node 24（Electron 44 内置） | electron-builder 26 | `windows-latest` | NSIS 安装包 + 便携版（x64 / arm64） |
| Ubuntu 桌面 | Electron 主进程 | 同上 | electron-builder 26 | `ubuntu-24.04` | deb + rpm + AppImage（x64 / arm64） |
| Web | 浏览器 | 浏览器 JS 引擎 | Vite 8 | `ubuntu-latest` | 静态站点 zip |
| Web（完整能力） | 本机常驻 Agent | Node 22+ | Node SEA + postject | `windows-latest` / `ubuntu-latest` | 单文件可执行程序 |
| Android | Capacitor 8 WebView + 原生前台服务 | Android System WebView | Gradle 8 / AGP 8 | `ubuntu-latest` | AAB + APK |
| iOS | Capacitor 8 WKWebView + 原生内嵌服务 | WKWebView | xcodebuild 26 | `macos-15` | IPA + dSYM |

> **为什么 iOS 端存在但没有 macOS 桌面端**：iOS 的 ipa 只能在 macOS 上打，
> 这是 Apple 的工具链与许可限制，不是配置问题。而 macOS **桌面**端从未在需求里，
> 所以 electron-builder 不产出 dmg —— 但 macOS runner 的分钟数是 Linux 的
> **10 倍**，因此 `mobile-ios` job 默认只在打 tag 或手动触发时跑。

> **为什么桌面端不能交叉打包**：electron-builder 打 Windows 包需要 Windows 上的
> signtool 与 NSIS，打 deb/rpm 需要 dpkg/rpmbuild，打 AppImage 需要 appimagetool。
> 在 Linux 上用 Wine 产出的 exe 常常「装了但跑不起来」。所以五个端 = 八个并行 job。

---

## 2. 能力矩阵

同一套业务代码在五端跑，但能力上限由平台决定。
UI 的策略是 **禁用 + 说明原因**，而不是把按钮藏起来 ——
用户需要知道「这个功能在桌面版有」，否则只会认为产品残缺。

判定入口只有一个：`can(caps, feature)`，文案来自 `reason(caps, feature)`。

| 能力 | Windows | Ubuntu | Web（无 Agent） | Web（有 Agent） | Android | iOS |
| --- | :-: | :-: | :-: | :-: | :-: | :-: |
| 启动外部进程 `spawn` | ✅ | ✅ | ❌ | ✅（Agent 代管） | ❌ | ❌ 永久不可行 |
| 启动内嵌本地服务 | ✅ | ✅ | ❌ | ✅ | ✅ | ✅ |
| 后台常驻 | ✅ 持久 | ✅ 持久 | ❌ | ✅ Agent 常驻 | ⚠️ 仅前台服务 | ❌ 数分钟后挂起 |
| 任意路径文件读写 | ✅ | ✅ | ❌ | ⚠️ 默认限 `--data-root` | ❌ 分区存储 | ❌ 仅沙箱 |
| 授权目录文件读写 | ✅ | ✅ | ✅ FS Access API | ✅ | ✅ | ✅ |
| 串口 Serial | ✅ | ✅ | ⚠️ 仅 Chromium | ✅ | ⚠️ 需原生插件 | ❌ |
| USB | ✅ | ✅ | ⚠️ 仅 Chromium | ✅ | ✅ OTG | ❌ 需 MFi |
| HID | ✅ | ✅ | ⚠️ 仅 Chromium | ✅ | ❌ | ❌ |
| 蓝牙 BLE | ✅ | ✅ | ⚠️ 仅 Chromium | ✅ | ✅ | ✅ |
| 系统托盘 / 开机自启 | ✅ | ✅ | ❌ | ⚠️ Agent 可自启 | ❌ | ❌ |

**BLE 是唯一五端全通的硬件通道。** 如果产品必须支持硬件，优先按 BLE 设计协议。

> **「Web（有 Agent）任意路径」那一格为什么是 ⚠️ 而不是 ✅**：
> Agent 的 `capabilities.get` 如实上报 `fileSystem: 'scoped'` ——
> 默认只允许读写 `--data-root` 指定的目录（相对路径也按它解析）。
> 只有显式加 `--unrestricted` 才上报 `'full'`。
> 表里写 ✅ 会让人以为 Web 版天然等于桌面版，而实际上那是**一个需要
> 用户主动放宽的安全开关**，默认值必须是受限的那个。

### 不可突破的硬约束（附依据）

这些不是「暂时没实现」，是平台层面的禁止，别再去找 API 了：

- **iOS 永远无法 `spawn`** —— App Store 审核指南 **2.5.2** 禁止应用下载或执行代码。
  即使技术上把二进制塞进 ipa，`posix_spawn` 也会被沙箱拒绝。
- **iOS 无法后台常驻** —— 切后台数秒内 suspend；`beginBackgroundTask` 只延长约
  3~10 分钟。无限制后台只开放给 audio / location / VoIP / newsstand /
  background-fetch 五类，且审核指南 **2.5.4** 明确禁止用静音音频保活。
- **Safari 与所有 iOS 浏览器不支持 Web Serial** —— WebKit 的既定策略，
  不是版本落后。iOS 上所有浏览器（含 Chrome）都是 WebKit 内核，一并没有。
  WebUSB / WebHID / Web Bluetooth 同理，仅 Chromium 系可用。
- **iOS 有线串口需要 MFi 认证** —— External Accessory 框架要求配件通过
  Apple 的 MFi 授权，未认证设备连枚举都做不到。
- **Android 15+ 的 `dataSync` 前台服务有 6h/24h 时限** —— 所以本项目用
  `specialUse` + `FOREGROUND_SERVICE_SPECIAL_USE`，并在 manifest 里用
  `<property>` 声明子类型（Play Console 也要填同样的说明）。
- **Android 浏览器沙箱内无法启动任何本地服务** —— 移动端的「本地服务」
  只能是 App 自己进程内的 HTTP 服务，见下面第 4 节。

---

## 3. 工具链要求

| 目标 | 必需 | 版本下限 | 版本错了会怎样 |
| --- | --- | --- | --- |
| 全部 | Node.js | **22** | Capacitor 8 与 Vite 8 直接拒绝启动 |
| 全部 | pnpm | **9.5** | `catalog:` 协议不识别，install 报「无法解析依赖」 |
| 桌面 | Electron | 44.x（≥ 43） | Electron 42 已于 2026-10-20 EOL |
| 桌面 | electron-builder | 26.x | 25.x 不认 Azure Trusted Signing |
| Linux 桌面 | rpm | 任意 | 缺 rpmbuild 时报 "cannot find rpm"，出现在构建第 8 分钟 |
| Web | — | — | 纯静态，任意托管 |
| Agent | Node SEA | 20+ | `--experimental-sea-config` 不存在 |
| Android | JDK | **21** | JDK 17 报 `Unsupported class file major version 65`，看不出是 JDK 问题 |
| Android | Android SDK | platform 36 | Capacitor 8 = compileSdk 36 |
| Android | Android Studio | Otter | 仅本地开发需要 |
| iOS | macOS | 能跑 Xcode 26 的版本 | 无法绕过 |
| iOS | Xcode | **26** | 2026-04-28 起 App Store Connect **直接拒绝**旧 Xcode 构建的包，不给任何提示 |
| iOS | CocoaPods | 最新 | `cap sync ios` 失败 |

TypeScript 停在 **5.9.x**，原因写在 [`pnpm-workspace.yaml`](pnpm-workspace.yaml) 里：
`latest` 已经是 7.0.2（Go 重写的原生编译器），但它的程序化 API 要到 7.1 之后数月才稳定，
会让 `tsup --dts` 生成 core 类型失败；而 5.9 线从 **5.9.2** 开始
（5.9.0 / 5.9.1 从未发布，精确 pin `5.9.0` 会装不上）。

一键自检：

```bash
pnpm check-env              # 人类可读的报告
pnpm check-env --strict     # CI 用，任何 error/warning 都退出码 1
pnpm check-env --target ios # 只看某一个端
```

---

## 4. 架构约定：本地服务是「HTTP 契约」，不是「进程」

四个宿主（`electron` / `agent` / `capacitor` / `browser`）共用一份 TypeScript 契约，
调用方式统一是 `POST http://127.0.0.1:<port>/rpc/<method>`。

**桌面端也不例外** —— Electron renderer 不走 IPC，而是走和 Web 完全一样的
HTTP 客户端。这个决定换来的是：

- 一套集成测试同时覆盖桌面 / Web / 移动端
- 前端代码里没有 `if (isElectron)` 分支
- 换掉 Electron 或换成 Tauri，前端零改动

代价是桌面端也要开一个本地端口，用 token 鉴权 + Origin 白名单 +
Host 头校验（防 DNS rebinding）来补偿，见
[`packages/core/src/runtime/server.ts`](packages/core/src/runtime/server.ts)。

### 移动端怎么实现「本地服务」

移动端不能 `spawn`，所以把服务做成 **App 自己进程内的回环 HTTP 服务**：

- Android：`specialUse` 前台服务里跑一个手写 `ServerSocket`
  （[LocalHttpService.kt](apps/mobile/native/android/kotlin/com/anyframe/app/service/LocalHttpService.kt)）
- iOS：需要在原生侧用 `NWListener` 或 GCDWebServer 实现同等接口
  （模板未生成 Swift，参考路径见 [apps/mobile/native/README.md](apps/mobile/native/README.md)）

这样移动端复用的是**同一个 `RpcClient` 和同一份契约**，只是服务提供方换了实现。

### 端口约定

| 用途 | 端口 | 出处 |
| --- | --- | --- |
| Agent 监听（默认） | `47730` | `apps/agent/src/index.ts` |
| Agent 自动发现扫描范围 | `47730 ~ 47733` | `discoverAgent()` / `AGENT_PORTS` |
| 桌面 ServiceManager 派生服务 | `47800+` | `apps/desktop/src/main/service-host.ts` |
| 移动端内嵌服务 | `47810+` | `apps/mobile/src/host.ts` |
| Agent 派生的外部服务 | `47900+` | `apps/agent/src/index.ts` |

四段互不重叠，这样桌面 Agent 与桌面 App 同时开发时不会互相抢端口。

> ⚠️ 唯一的例外：`pnpm dev:desktop` 的 Electron RPC 端口默认也是 47730，
> 与 Agent 撞车。同时开发两端时用
> `ANYFRAME_RPC_PORT=47740 pnpm dev:desktop` 避开。

---

## 5. CI 流水线

### `ci.yml` —— 每次 push / PR

单个 `ubuntu-latest` job，目标 5 分钟内出结论：
`pnpm typecheck` → `pnpm test` → `pnpm build:all` → 产物体积报告写进 Step Summary。
不打包、不签名、不碰 macOS。

### `build.yml` —— 打 tag 或手动触发

| Job | Runner | 超时 | 触发条件 |
| --- | --- | --- | --- |
| `meta` | ubuntu-latest | 5m | 总是 |
| `desktop-windows` | windows-latest | 45m | `target` 含桌面 |
| `desktop-linux` | ubuntu-24.04 | 45m | `target` 含桌面 |
| `web` | ubuntu-latest | 20m | `target` 含 web |
| `agent-windows` | windows-latest | 25m | `target` 含 agent |
| `agent-linux` | ubuntu-latest | 25m | `target` 含 agent |
| `mobile-android` | ubuntu-latest | 50m | `target` 含 android |
| `mobile-ios` | macos-15 | 60m | `target` 含 ios **且** iOS 密钥齐备 |
| `release` | ubuntu-latest | 20m | `is_release == true` |

设计要点：

- `concurrency.cancel-in-progress: **false**` —— 发布构建跑到一半被取消，会在
  Release 上留下残缺产物，而 `latest.yml` 可能已经指向它，客户端自动更新会失败。
- `release` 用 `always()` 而非默认门禁 —— 一端挂了，其余四端的产物照样发布，
  并在发布说明顶部插入「⚠️ 本次发布不完整」的横幅。
- `mobile-ios` 在密钥缺失时**跳过而不是失败** —— fork 上的 PR 拿不到 secret，
  跳过能让其余七端照常出产物。
- `mapping.txt`（Android R8 混淆映射）与 `dSYM.zip`（iOS 符号表）单独作为
  workflow artifact 保留 **365 天**，并在 `release` job 里主动删除，
  **绝不进公开 Release** —— 那等于公开反混淆字典。

### 需要配置的 Secrets

| Secret | 用于 | 缺失后果 |
| --- | --- | --- |
| `WIN_CSC_LINK_BASE64` | Windows pfx 证书（base64） | 产物未签名，SmartScreen 拦截 |
| `WIN_CSC_KEY_PASSWORD` | pfx 密码 | 同上 |
| `AZURE_TENANT_ID` / `_CLIENT_ID` / `_CLIENT_SECRET` | Azure Trusted Signing（替代 pfx） | 同上 |
| `ANDROID_KEYSTORE_BASE64` | Android keystore（base64） | debug 签名，无法上架 Play |
| `ANDROID_KEYSTORE_PASSWORD` | keystore 密码 | 同上 |
| `ANDROID_KEY_ALIAS` | 密钥别名 | 同上 |
| `ANDROID_KEY_PASSWORD` | 密钥密码 | 同上 |
| `IOS_TEAM_ID` | Apple Team ID（10 位） | `mobile-ios` 跳过 |
| `IOS_ASC_KEY_ID` | App Store Connect API Key ID | 自动签名失败 |
| `IOS_ASC_ISSUER_ID` | API Key 的 Issuer ID | 同上 |
| `IOS_ASC_KEY_BASE64` | `.p8` 私钥（base64） | 同上 |

> 2026 年起 OV/EV 代码签名证书的私钥被强制要求存放在云 HSM 中，
> 新项目基本只能走 Azure Trusted Signing，`WIN_CSC_LINK_BASE64` 是给
> 持有旧式 pfx 的项目留的兼容路径。

### 仓库变量（Variables，非机密）

| 变量 | 默认 | 作用 |
| --- | --- | --- |
| `WEB_BASE_PATH` | `/` | Web 部署到子路径时填 `/<repo>/`（GitHub Pages 常用） |
| `IOS_RUNNER_LABEL` | `macos-15` | runner 镜像里没有 Xcode 26 时改这里 |
| `ANDROID_ABI_SPLIT` | `0` | 设 1 产出按 ABI 拆分的多个 APK（注意 AAB 会忽略该设置） |

---

## 6. 产物命名

| 端 | 文件名 |
| --- | --- |
| Windows | `AnyFrame-Setup-<ver>-win-<arch>.exe`、`AnyFrame-<ver>-portable-win-<arch>.exe`、`latest.yml`、`*.blockmap` |
| Ubuntu | `AnyFrame-<ver>-linux-<arch>.deb` / `.rpm` / `.AppImage`、`latest-linux.yml` |
| Web | `anyframe-web-<ver>.zip` |
| Agent | `anyframe-agent-<ver>-win-x64.exe`、`anyframe-agent-<ver>-linux-x64` |
| Android | `AnyFrame-<ver>.aab`、`AnyFrame-<ver>[-<abi>].apk`、`mapping-<ver>.txt` |
| iOS | `AnyFrame-<ver>-ios.ipa`、`AnyFrame-<ver>-ios.dSYM.zip`、`DistributionSummary-<ver>.plist` |

版本号来自 tag：打 `v1.4.0` 就是 `1.4.0`。
非 tag 构建用 `<package.json 版本>-ci.<run number>`，
其中 run number 同时充当 Android 的 `versionCode` 与 iOS 的 build number
（Google Play 要求 `versionCode` 严格单调递增，用 run number 比用提交数更稳）。

iOS 用的是**去掉后缀**的版本号（`version_ios`），因为
`CFBundleShortVersionString` 只接受点分数字，带 `-ci.42` 会被 App Store Connect 判为无效。

---

## 7. 用户侧安装注意

- **Windows**：未签名时 SmartScreen 会拦截，「更多信息 → 仍要运行」。
- **Ubuntu AppImage**：需要先装 FUSE。Ubuntu 24.04 是 `sudo apt install libfuse2t64`，
  22.04 是 `libfuse2`。缺了会报 `dlopen(): error loading libfuse.so.2`。
- **Ubuntu deb 依赖**：24.04 起 `libasound2` 改名 `libasound2t64`，
  所以必须在 `ubuntu-24.04` 上构建（工作流已固定）。
- **Web**：解压到任意静态托管即可。文件读写与本地服务需要另外安装 Agent，
  装好后页面会自动探测 `47730~47733`。
- **Android APK**：debug 签名的包不能覆盖安装正式签名的包，需要先卸载。
- **iOS adhoc**：设备 UDID 必须已登记在开发者账号里；
  每年只能重置一次设备列表（100 台上限）。
