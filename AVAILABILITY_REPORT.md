# App / Windows 桌面端 / Web 可用性检查

检查日期：2026-10-28。基于本次工作区代码与本机实际执行结果；未以 README 的历史验证记录代替本次验证。

> 后续 0.0.1 打包更新：已在瑞士军刀工作区的 `C:/projects/dev/lan-chat-lab/.build-tools/android-sdk` 找到现有 Android 36 SDK；首次自检只检查环境变量，未发现此项目内安装。已修复下文的 Kotlin 编译接线、权限 API 和测试签名兜底，Android Release APK/AAB 已真实构建并通过签名、版本、原生类及内嵌资源检查。Windows 安装包/便携版与 Web 包亦已生成，统一位于 `release/0.0.1`，详见其中的 `README.md`、`build-info.json` 和 `SHA256SUMS.txt`。下文保留首次检查时的记录；移动端业务 RPC、硬件能力和 Web 无令牌假连接问题仍存在，Android 未真机运行。

## 结论

| 端 | 本次验证结果 | 可用范围 |
| --- | --- | --- |
| Windows x64 | **基础运行链路可用，功能展示有误导** | 打包程序实际启动；renderer → preload → HTTP RPC 正常；文件操作、子服务启停、退出清理通过。界面主要是构建自检，尚无完整业务操作入口。 |
| Web | **静态页面可用；本地能力需正确配置 Agent + token** | 无 Agent 时正常降级；携带正确 token 后通过浏览器访问 Agent，并完成文件、服务 RPC。默认自动发现存在“显示已连接，实际 401”缺陷。 |
| Android App | **前端可构建；原生端不能确认可用，且存在代码阻塞** | Capacitor 原生工程生成和 sync 成功；本机缺 Android SDK/adb，未产出 APK、未真机验证。生成工程缺 Kotlin 编译接线，插件还有 API 名称错误；RPC 文件/服务接口未实现。 |
| iOS App | **核心本地服务未实现** | 只有配置补丁，没有 AnyFrameLocalService 的 Swift 插件/服务实现；本机 Windows 也无法执行 iOS 原生构建。 |

因此目前可以验收 **Windows / Web 的基础运行框架**，不能认定三端已达到完整产品可用状态。

## 主要问题（按优先级）

### P1：Android 原生工程没有启用 Kotlin 编译，Java 主入口引用 Kotlin 插件

- 位置：`apps/mobile/scripts/setup-native.mjs:214`、`:257`、`:298`，`apps/mobile/native/android/app.build.gradle.fragment`。
- 实际执行 `setup:native android` 后，脚本复制了 `.kt` 文件，并在 `MainActivity.java` 中注册 `LocalServicePlugin.class`。
- 生成的 `android/build.gradle` 只声明 Android / Google Services 插件；`android/app/build.gradle` 只应用 `com.android.application`。全链路没有 Kotlin Gradle 插件。
- 当前锁定的 AGP 是 8.13.0；仅将 Kotlin 源文件放到 `src/main/java` 并不会启用 Kotlin 编译。因此 Java 引用的插件类无法由当前工程生成。
- 建议：在生成脚本/补丁中补齐匹配版本的 Kotlin 插件配置，再实际执行 debug/release 原生构建。
- 证据性质：**生成工程检查与依赖源码核对**；因 SDK 缺失，未取得 Gradle 编译器报错日志。

### P1：Android 插件调用不存在的权限方法

- 位置：`apps/mobile/native/android/kotlin/com/anyframe/app/plugin/LocalServicePlugin.kt:117`、`:128`。
- 两处调用 `permissionState(ALIAS_NOTIFICATIONS)`；本次安装的 Capacitor 8.5.3 `Plugin.java:612` 提供的方法是 `getPermissionState(String alias)`，没有前者。
- 即使补齐 Kotlin 编译，这两处仍需更正，否则无法编译插件。
- 证据性质：**项目源码与已安装依赖 API 核对**。

### P1：App 的文件和服务 RPC 尚未实现，iOS 插件也缺失

- Android 位置：`apps/mobile/native/android/kotlin/com/anyframe/app/service/LocalHttpService.kt:299`。
- Android HTTP 分发只实现 `capabilities.get`；`fs.read/write/list/remove`、`service.start/stop/list/logs` 全部进入默认分支，返回 HTTP 501 / `UNSUPPORTED`。
- `apps/mobile/src/native/fs.ts` 虽有 Capacitor 文件系统适配器，但没有接入上述 HTTP 分发或当前页面的业务操作。
- iOS 位置：`apps/mobile/scripts/setup-native.mjs:383`；`apps/mobile/native/ios` 中没有 Swift 服务/插件实现。前端 `ensureLocalService()` 仍调用 `LocalService.start()`，无法完成原生启动链路。
- 建议：明确移动端需要支持的契约，补齐实现和能力降级；不要用平台能力基线表示已经实现的产品能力。

### P1：Web 默认发现会把鉴权失败误报为已连接

- 位置：`apps/web/src/agent-bootstrap.ts:67`、`:78`；同一问题也在 `packages/ui/src/host/web.ts:62`、`:75`。
- 复现：启动默认要求 token 的 Agent；直接打开 Web，不传 `?token=`。`GET /healthz` 返回 200，随后 `POST /rpc/capabilities.get` 返回 401，但前端吞掉错误并回退 `WEB_WITH_AGENT`，仍显示绿色“已连接本地助手”。
- 本次真实浏览器已复现，截图 `build-output/availability/web-false-connected.png`。携带正确 token 后连接及 RPC 均成功。
- 影响：用户看到成功状态，实际文件和服务调用全部失败；能力查询失败时还会错误显示完整文件/硬件能力。
- 建议：以鉴权成功的能力查询作为连接成功条件；鉴权失败显示配对/令牌配置入口，不能用成功能力表兜底。

### P2：Web 的“安装 / 启动本地助手”缺少闭环

- 位置：`apps/web/src/agent-bootstrap.ts:113`、`apps/desktop/build/installer.nsh:33`、`apps/desktop/src/main/index.ts`。
- 页面尝试打开 `anyframe://install`；安装器把协议交给桌面 `AnyFrame.exe`。
- 桌面入口没有处理协议参数并启动独立 Agent 的逻辑；桌面 RPC 使用随机端口，默认也不在 Web 的 Agent Origin 白名单/端口探测方案里。没有看到向浏览器完成 token 配对的实现。
- 该按钮不能据此认定会完成安装、Agent 启动、鉴权配对和重新连接。协议安装与系统浏览器唤起未作真实安装验收。

### P2：Windows 能力上报与实际实现不一致

- 位置：`apps/desktop/src/main/service-host.ts:43`、`:56`，`packages/core/src/capabilities.ts:23`、`:24`。
- 默认文件提供器受 `ANYFRAME_DATA_ROOT ?? homedir()` 限制，但上报 `fileSystem: full`，界面说明为“任意路径”。本次使用隔离数据目录实测：上报 `full`，越界路径返回 `PERMISSION_DENIED`。
- 桌面基线将 serial / USB / HID / BLE 全部设为 `true`，当前没有对应设备实现和 RPC 接口，页面却显示可用。
- 建议：参考 Agent 已有做法，根据运行时真实配置返回 `scoped/full`，设备能力只在实际实现并可用时开启。

### P2：页面仍为能力展示，测试没有功能覆盖

- 桌面入口自称“构建自检”，展示信息和功能可用标记；没有文件管理、服务启动等用户操作。
- 移动端及共享 UI 的多个能力按钮没有 `onClick`；移动端仅“查看服务状态”有实际点击逻辑。
- `packages/ui` 虽然注释声称一份产物供三端使用，但当前各端 Vite 仍构建自己的入口，没有接入共享 UI 的分发过程。
- 六个包的 `vitest run --passWithNoTests` 全部显示 `No test files found`。`pnpm test` 成功不能证明任何业务流程已被测试。

## 本次已执行的验证

环境：Windows x64、Node 24.13.0、项目指定 pnpm 9.15.0；安装锁文件中的依赖，Electron 44.9.3、Capacitor 8.5.3。

| 检查 | 结果 |
| --- | --- |
| `pnpm install --frozen-lockfile` | 成功；Electron 二进制最初缺失，后单独运行安装脚本并使用文档镜像补齐。没有修改依赖版本/锁文件。 |
| `pnpm typecheck` | 六个工作区包全部通过。该检查仅覆盖 TypeScript，不覆盖 Kotlin/Swift。 |
| `pnpm test` | 命令成功，实际测试文件数为 0。 |
| `pnpm build:all` | core、ui、agent、desktop、web、mobile 全部构建成功；mobile 此处仅为 Web 资源。 |
| Web 生产资源 + Edge | 无 Agent 正常降级；有 token 正常连接；无 token 的错误成功态已复现。 |
| Agent 文件 RPC | UTF-8 / 256 种字节的 base64 往返、list、remove、路径穿越拒绝通过。 |
| Agent 服务 RPC | 启动真实 Node HTTP 子服务 → 请求响应 → 查询列表/日志 → 停止，通过。 |
| Agent 边界检查 | 无 token 401、非法 Origin 403、非法 Host 421、无效输入拒绝、CORS/PNA 预检响应通过。 |
| Windows 可运行目录打包 | 成功，使用本地 Electron 分发目录，关闭可执行文件资源编辑/签名，仅生成 x64 测试目录。 |
| Windows 打包程序实跑 | 从 `app.asar` 加载页面，preload 和能力 RPC 成功；文本/二进制文件操作、子服务启停/日志、退出清理通过。 |
| 三端 Vite 开发页面 | Web / mobile 正常渲染降级页；desktop 在普通浏览器中正常显示“缺少 preload”的错误页，此为预期，桌面桥在打包应用中另行验证通过。 |
| `pnpm --filter @anyframe/mobile setup:native android` | 工程生成、补丁、插件注册文本和资源 sync 成功；暴露前述原生编译接线问题。 |
| `pnpm check-env --strict --target android` | 返回 1；JDK 21 已有，Android SDK 缺失，adb 不可用。 |

本地运行时脚本含 18 项检查，其中 2 项用于确认缺陷（Web 假连接、桌面文件能力误报），其余 16 项正常链路检查通过。开发页面另作检查。没有把“复现了缺陷”计作产品功能通过。

## 尚未验证的边界

- Android APK/AAB 构建、安装、前后台切换、通知/电池权限、真机 WebView 到回环服务的访问；iOS 原生构建与真机运行。
- Windows NSIS 安装/卸载、portable 自解压包、arm64、协议处理器安装、签名和 SmartScreen。默认远端下载打包流程曾等待网络，本次改用本地 Electron 目录验证运行内容。
- Web 真实 HTTPS 部署域名、生产 Origin 配置、不同浏览器的本地网络授权、系统协议唤起。浏览器验证使用本机 Edge。
- 串口、USB、HID、BLE，以及长时间后台运行、自启动、自动更新。

## 复查产物

- `build-output/availability-smoke.cjs`：Web / Agent RPC / mobile 浏览器预览检查脚本。
- `build-output/desktop-smoke.cjs`：Windows 打包产物集成检查脚本。
- `build-output/dev-smoke.cjs`：开发服务器页面检查脚本。
- `build-output/availability/results.json`、`desktop-results.json`、`dev-results.json`：结构化结果。
- `build-output/availability/*.png`：本次浏览器和桌面程序截图。
- `apps/desktop/release/availability/win-unpacked/AnyFrame.exe`：实际启动验证的 Windows x64 程序。

脚本使用本机 Codex 依赖中的 Playwright，属于本地检查产物，未加入项目正式 CI。`build-output`、原生生成工程、打包产物均被现有 `.gitignore` 忽略。本次未修改业务源码；本报告是唯一新增的可提交文件。检查创建的服务与浏览器/桌面进程已关闭。
