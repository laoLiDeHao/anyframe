# AnyFrame 内嵌 Node 服务与局域网发布规划

决策：统一使用随软件分发的 Node 运行时；取消 QuickJS 和自定义 JS 运行时方案。
目标：维护一份 Node/TypeScript 后端业务代码，各平台只适配运行与生命周期。
当前已接入：服务管理页、共用 Express 记事本/聊天室、桌面 Electron Node、Android libnode/JNI/独立前台进程。
Android 已构建 release；真机后台与局域网验证待连接设备后执行。首版仅支持内置模板，服务包导入和媒体挂载仍属后续规划。iOS 不在范围内。

## 1. 各端运行方式

| 平台 | 运行方案 | 业务代码 |
| --- | --- | --- |
| Windows / Linux | 当前示例使用 Electron 自带 Node；后续可扩展独立进程 | 共用 Node 业务包 |
| Android | Capacitor 插件 → 原生前台服务 → JNI → libnode.so | 共用 Node 业务包 |
| Web | 连接本机 Agent 或已配对远程宿主 | 由所选设备执行 |

“内嵌”指运行时随产品分发，不要求用户另装 Node；桌面无需把业务直接放进 Electron 主进程。
独立 Agent 也携带对应运行时；现有 SEA 助手 EXE 不默认当作通用 node.exe 使用。
浏览器不能自行监听局域网端口，必须显示实际运行设备。

## 2. Android 依赖选择与验证门槛

原 nodejs-mobile 仓库的 Latest 当前指向 18.20.4，Node 18 已结束官方维护，不作为正式版基线。
社区 fogtape/nodejs-mobile 提供 Node 24 / 26 移植与 Android 原生库，可以作为技术验证候选。
当前固定采用其 `v24.22.0-0` full Android SDK（上游 prerelease），以 SHA256 校验资产；不是 Node 官方 Android 发行版。
版本、许可证、构建方式与验证边界见 [Android 宿主说明](apps/mobile/node/README.md)。

优先验证 Node 24 系列，固定通过测试的源码提交、发行资产与 SHA256；桌面采用对应的官方 Node 24 补丁版本。
需检查源码来源、补丁、构建记录、ABI、16 KB 页兼容、许可证与后续更新来源。
如果现有资产不能通过验证，先量化修复成本；不要为了接入而长期维护一份大型 Node 分叉。

首次验证只做 arm64 Android 真机：

1. 从 JNI 在专用线程启动 Node，确认实际版本、模块加载、fs、http 和 HTTPS 客户端可用。
2. 跑与桌面相同的 Express 示例，提供 JSON API、静态网页与媒体 Range。
3. 从另一台局域网设备访问，验证接口、上传和页面，不只验证 APK 能编译。
4. 连续启停业务、重启宿主、切后台、熄屏、网络切换后恢复。
5. 检查内存、CPU、日志，以及原生库 16 KB 页兼容性。

这一步通过后再投入完整服务管理 UI。首版不承诺运行任意 npm 工程。

## 3. Android 宿主结构

```text
Capacitor 管理界面
    ↓ 插件桥接 / 进程间管理通道
Android 前台服务（独立 :node 进程）
    ↓ JNI 专用线程，进程内启动一次 Node
Node Supervisor
    ├── 静态站点 A
    ├── API 服务 B
    └── API + 页面服务 C
```

按 nodejs-mobile 的单实例约束设计：一个 Android 宿主进程只初始化一个 Node 实例。
停止业务是关闭该业务的 server、连接、定时器和资源，不是反复调用 Node 启动入口。
必须重启 Node 时，结束并重新创建 :node 宿主进程，而不尝试在同一进程重新初始化。
Java Service 生命周期与该进程的 Node 生命周期分开管理。

多个业务可以各开端口，也可以挂在共享网关下；首版每个服务一个端口，减少前端 base 路径问题。
它们在 Android 共用 Node 进程，process.exit、原生崩溃或阻塞事件循环会影响全部业务。
异常时重启宿主、根据配置恢复服务，并明确记录原因，不宣称每服务完全隔离。
首版不使用 child_process、cluster 或 worker_threads 作为 Android 必备能力。

前台服务显示运行通知，提供停止全部服务入口；不承诺所有 ROM 下永久存活。
退出管理页面可继续运行；明确执行“停止宿主”才关闭全部业务。
系统中断后保留服务定义与数据，恢复时展示服务真实状态。

## 4. 一份后端代码的最小约定

HTTP 框架、文件操作和依赖仍使用 Node API，不另造一套 HTTP/存储 SDK。
只约定两个生命周期方法：start(context) 和 stop()。

context 至少包含 host、port、dataDir、publicDir 和该服务的配置。
start 返回实际运行信息，stop 负责关闭 HTTP server、WebSocket、数据库、连接和定时器。
每个服务持有独立配置对象，不在 Android 共用进程里为不同服务修改 process.env 或 process.chdir。

普通 Express 工程只需把 app 创建、listen 和关闭资源封装成这两个方法。
已经写成独立入口且无法调整的 Node 项目可在桌面使用脚本模式；Android 首版要求生命周期约定。
TypeScript 在开发机编译成 JS；依赖在开发机安装并随服务包交付，不在手机运行 npm install。
可打包兼容的纯 JS 依赖，无法静态打包的资源/模块显式保留，不能假设所有工程都能变成单个 JS。

兼容范围：

- 优先：Express、Node 标准 HTTP/fs/path、经过验证的纯 JS npm 依赖。
- 单独验证：TLS 证书、原生数据库模块、WebSocket、大文件与长连接。
- 不默认跨端：child_process、系统命令、Windows 路径、桌面二进制和原生 .node 模块。
- 原生扩展需要匹配 Android ABI、Node 接口与构建工具链，不能直接复制电脑 node_modules。

## 5. 服务包与数据

```text
service-package/
  service.json        # ID、版本、入口、运行时范围、配置 schema
  server/             # 编译后的后端代码和资源
  node_modules/       # 必要生产依赖；打包进 JS 的依赖可省略
  public/             # 前端生产构建资源，可选
```

服务定义、运行数据和日志在 AnyFrame 数据目录中单独保存，不写回源码包。
Android 从 SAF / 系统选择器导入后，复制到应用私有目录，再交给 Node 访问。
content:// 不是普通文件路径；项目媒体按授权复制或通过适配层读取。
配置含服务 ID、运行设备、端口、监听范围、数据目录、重启策略与挂载设置。
serviceId 稳定，每次启动生成 runId；持久化定义，运行状态通过当前宿主重新确认。

## 6. 局域网访问与静态挂载

Node 统一处理 HTTP、静态网页与 API，Kotlin 只管理进程、权限、文件导入和通知。
现有 Kotlin 自检 HTTP 不作为业务 JS 请求的必经转发层。

```text
http://192.168.1.20:8080/
  /          前端静态页面
  /api/*     Node 后端接口
  /media/*   授权挂载的多媒体项目
```

通过“仅本机 / 局域网”选择监听范围，默认本机；局域网模式由 Node 监听 0.0.0.0。
UI 展示真实局域网 IP，提供复制和二维码。固定端口被占用就报错，不静默换端口。
支持静态文件 MIME、流式传输、Range 与可配置 SPA 回退；缺失资源与 API 不回退 index.html。
管理 RPC 与业务入口分离，不直接将 service.start、fs.* 暴露给访客。
远程管理需独立配对和鉴权；业务入口可配置访问口令。
验证 Windows 私有网络防火墙、Wi-Fi 客户端隔离、多网卡与 IP 变化。

导入后端相当于运行本机程序，只运行可信代码。进程隔离不是安全沙箱，
现有 NodeFsProvider 的目录限制也不会自动限制业务自己调用 node:fs。

## 7. 服务管理与界面

复用现有 ServiceManager 的日志、启停和退避重启，新增运行适配器、持久化定义、健康检查。
状态包括 stopped、starting、running、unhealthy、stopping、failed；健康通过后才显示可访问。
进程启动成功不代表端口已经监听，停止后要验证端口释放。

导航增加“服务”：

- 列表：名称、运行设备、状态、端口和启停按钮。
- 新建：导入服务包 → 选择设备 → 配置端口/页面/参数 → 校验 → 启动。
- 详情：概览、配置与挂载、日志。
- 概览：访问地址、二维码、健康状态、运行时版本与启停重启。
- 配置：静态目录、授权媒体项目、密钥参数和退出策略。
- 日志：按服务与 runId 展示，可复制、导出并限制保留量。

“项目”保存素材与分组，“服务”保存可运行部署，两者通过媒体挂载关联。
桌面侧栏与手机底部导航沿用共享 UI，不按平台重写管理页面。

## 8. 分阶段落地

阶段 A：Android Node 技术验证，同时用同一示例验证桌面；输出可安装 APK、依赖锁定记录和测试结果。
先确认 Android 运行时可维护，再开展完整产品接入。

阶段 B：抽出 packages/service-host，集中维护 Node Supervisor、服务包加载、静态挂载、健康与日志。
桌面/Agent 使用子进程 Runner，Android 使用 libnode 适配器；业务与管理协议共享。
Android 不加载包含 node:child_process 必需依赖的桌面运行适配器。

阶段 C：接入配置持久化和服务 UI，完成导入、启停、重启、局域网发布与媒体挂载。
至少验证两个服务共存、停止一个不影响另一个、异常恢复、重启后数据保留、端口冲突和日志。

阶段 D：按实际需要增加远程配对、原生数据库、后台系统服务和更多 Android ABI。
Windows Service / Linux systemd 属于独立后台宿主模式，不与桌面重复拉起同一部署。

维护策略：统一业务源码和依赖锁文件，版本升级先过 Windows/Linux/Android 回归；
Android 原生补丁限制在 JNI、生命周期和构建接线，不维护自定义 JS 标准库或 Node API 模拟层。
统一运行时主版本，分别锁定桌面与移动构建来源；依赖升级周期不能等同于每次业务更新。

## 9. 依据与待验证项

- 原 nodejs-mobile 与 FAQ：https://github.com/nodejs-mobile/nodejs-mobile/blob/main/doc_mobile/FAQ.md
- 原仓库 Latest（当前指向 18.20.4）：https://github.com/nodejs-mobile/nodejs-mobile/releases/latest
- Node 官方 EOL：https://nodejs.org/en/about/eol
- 社区 Node 24 / 26 移植候选：https://github.com/fogtape/nodejs-mobile/blob/recipe/README.md
- 社区发行资产与状态：https://github.com/fogtape/nodejs-mobile/releases
- Android 原生库页大小：https://developer.android.com/guide/practices/page-sizes
- Android 前台服务：https://developer.android.com/develop/background-work/services/fgs/service-types

上述社区移植尚未在本项目下载、构建或真机验证，不能据此承诺 npm 全兼容或后台永久运行。
