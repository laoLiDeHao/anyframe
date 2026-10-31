# AnyFrame 服务宿主开发规范

本文件是后续服务开发、导入、运行和分发的约定。当前产品入口为「首页 / 服务 / 设备 / 设置」；移除原素材项目 Tab、侧栏项目列表和首页素材项目入口。旧素材代码与既有数据保留，不再挂载到主界面。

## 1. 包职责与目录

```text
services/
  builtin/                      # 随软件分发的默认服务；加载器自动扫描一级子目录
    express-demo/
      index.js                  # 已打包的 CommonJS JS 入口
      wwwroot/
        index.html              # 前端生产文件，可附带 assets 等子目录
  src/                          # 本仓库维护的示例源码，不进入运行时加载路径
    express-demo/index.ts
  build.mjs                     # 示例源码 → builtin/express-demo/index.js
packages/
  core/                         # RPC 契约、能力声明、通用 ServiceManager；不含服务业务
  service-host/                 # 包发现、安装、导入校验、权限 Runner、生命周期桥接
apps/
  desktop/                      # Electron 生命周期与资源路径
  agent/                        # 本地助手的配置与进程生命周期
  mobile/                       # Android libnode / JNI / 前台服务与资源复制
```

新增系统默认项目：直接将打包好的文件夹放进 `services/builtin/<id>/`。不修改 core、平台 handler 或 UI 中的服务名称分支。自有服务的源码和依赖归服务自己的构建工程管理，不能放进 core 或依赖管理器里等待设备安装。

服务 ID 为 1–64 位小写字母、数字、连字符、下划线，首位必须是字母或数字。文件夹名就是服务 ID。当前显示名与 ID 一致；将来若增加展示元数据，必须走通用包契约，不添加业务硬编码。

## 2. 最小服务包格式

```text
my-service/
  index.js                      # 必需：CommonJS，导出 start(context)
  wwwroot/
    index.html                  # 必需：前端入口
    assets/                     # 可选：JS/CSS/图片等
  ...                           # 打包器生成的项目内辅助 JS/资源
```

约定使用 `index.js`，输出格式为 CommonJS。不要带 `package.json` 的 `type: module`，不要依赖宿主的 node_modules、TypeScript loader、npm install、全局模块或 CDN。Express、ws 等非 Node 内置依赖由作者预先打包进 JS；静态资源需随包交付。设备不执行构建或安装脚本。

使用 Node 标准模块开发后端，HTTP 框架由项目自行选择。`wwwroot` 是项目自己的前端目录，不是 AnyFrame 管理界面的目录。项目自行提供静态文件路由；不能挂载项目根目录，因为其中有后端代码与运行数据。

原生 `.node` 模块、子进程、额外 Worker、WASI 和调试器不在当前服务包能力范围内。兼容的纯 JS 依赖可以在开发机用 esbuild、Rollup 等工具 bundle；不能把电脑 node_modules 原样复制后宣称 Android 兼容。

## 3. 启动与停止契约

```js
// index.js：作者打包后的 CommonJS 入口
exports.start = async ({ host, port, projectDir, publicDir, log }) => {
  // projectDir：本服务安装及运行目录
  // publicDir：projectDir/wwwroot
  // host：127.0.0.1 或 0.0.0.0；port：宿主分配的端口
  // 此处创建 HTTP/WS 服务，等待 listen 成功后再返回
  log('服务就绪')
  return {
    port,
    async close() {
      // 关闭 HTTP、WebSocket、数据库、连接与定时器，等待写入结束
    },
  }
}
```

只约定一个 `start(context)` 导出；它返回 `{ port, close() }`。不要在顶层自动 listen。必须使用分配的 host/port，不能静默换端口。启动超时为 15 秒；停止最多等待 5 秒，超时终止该服务线程。

服务不得调用 process.chdir 或修改宿主全局环境。配置通过 context 传递，不能要求管理宿主为每个服务修改 process.env。不要调用 process.exit 控制整个宿主；服务只负责自己的生命周期。

ServiceManager 管理运行状态、日志和每次运行的 ID。ProjectServiceHost 按稳定包 ID 发现项目，并对并发重复启动去重。停止后前端不再提供可点击的访问链接；运行器意外退出必须回报 stopped/crashed，不能继续显示 running。

## 4. 目录权限边界

每个项目在宿主私有数据目录的 `services/<id>/` 中拥有自己的目录，入口、wwwroot、业务数据都留在该目录。业务可使用 `projectDir/data/` 保存新数据；现有示例继续在自己的项目根目录保存 notes.json，兼容已有结构。宿主拥有安装元数据 `service.json`，项目不得依赖或修改它。

Runner 为每个服务创建独立 Node Worker，显式使用：

```text
--permission
--allow-fs-read=<当前项目真实路径>
--allow-fs-write=<当前项目真实路径>
```

不继承管理进程的 execArgv 和环境变量。未开放子进程、额外 Worker、原生 addon、WASI 等权限。服务目录递归拒绝符号链接与原生模块，启动前再次检查目录；不能把其他服务目录、用户主目录或管理器目录加入权限白名单。拒绝越界读写必须由测试验证，不以 cwd 或约定代替权限限制。

宿主不支持这些权限参数时必须启动失败，不可回退到管理进程内直接 import。不允许以 vm、自定义 require 白名单或 NodeFsProvider 的管理 RPC 路径限制冒充业务运行权限隔离。

边界说明：Node Permission Model 用于约束正常服务的资源访问，不是对恶意 JS 的完整操作系统安全沙箱。Worker 共享进程，原生崩溃仍可能影响整个 Node 宿主。开放不可信代码市场之前，需独立设计操作系统沙箱、网络/资源配额和平台威胁模型；不得宣称当前实现能安全运行任意恶意包。参考 [Node Permission Model](https://github.com/nodejs/node/blob/main/doc/api/permissions.md)。

## 5. 用户 ZIP 导入

服务页「导入服务」选择 ZIP，输入稳定服务 ID。支持 ZIP 根部直接有 index.js/wwwroot，或只有一层外包项目文件夹。导入只安装，不自动运行；安装后出现在服务列表，再编辑和运行。

管理 RPC：

- `service.catalog` 返回已安装包的 ID、名称和 builtin/user 来源。
- `service.import` 接收服务名称与 ZIP base64，完成校验、暂存、发布。
- `service.start` 以 template/name 指定已安装包，不接收用户提供的任意服务器路径。
- `service.list/stop/logs` 继续复用通用契约。

导入边界：压缩包最大 20 MB，展开总量最大 64 MB、单文件最大 16 MB、最多 2000 个条目。拒绝绝对路径、`..`、反斜线、Windows 盘符/ADS、设备保留名等不安全路径。解压内容写成普通文件，不恢复 ZIP 链接；安装树递归检查符号链接。禁止上传宿主 service.json 和 data/ 运行数据，不允许覆盖同名包。

在目标服务目录同级创建随机暂存目录，全部校验通过后 rename 发布；失败清理暂存目录。任何失败都不能执行上传代码。后续若支持更新、删除与回滚，须另立带版本和事务的契约，不能绕过当前禁止覆盖的规则。

Android 的文件选择与读取经 WebView / 系统选择器完成，ZIP 数据通过已鉴权的管理 RPC 交给 Node；不把 content:// 当作文件系统路径。

## 6. 各端分发

| 平台 | 默认包资源 | 执行方式 |
| --- | --- | --- |
| Desktop 开发 | 仓库 services/builtin | Electron Node → 每服务受限 Worker |
| Desktop 安装包 | resources/services | 同上，复制到应用 userData/services 后执行 |
| Agent | 分发目录 services；开发可指定 ANYFRAME_BUILTIN_ROOT | Node / SEA → 每服务受限 Worker |
| Android | assets/node-runtime/services | Kotlin 复制到私有目录；libnode 中创建受限 Worker |
| Web | 不执行 Node | 连接当前宿主的管理 RPC |

默认包随资源目录分发，不内联到主程序 bundle。桌面 electron-builder、Agent portable/SEA 发布脚本、Android prepare-node 必须带上这些资源。默认服务更新只更新包内代码/前端文件，不删除项目运行数据；遇到同 ID 用户包冲突必须报错。

Android 继续一个 :node 前台服务进程、一次 JNI Node 初始化；停止项目只停止相应 Worker，不反复初始化 libnode。此变更引入了 Worker/Permission Model 能力门槛，需要 Android 实机验证；失败应明确显示错误。固定 SDK 来源和哈希仍见 apps/mobile/node/README.md。iOS 运行服务不在当前实现范围内。

## 7. 服务界面与局域网

主界面不再提供原素材项目 Tab。服务列表显示名称、来源、状态，行尾提供运行/停止、编辑、分享图标与「进入」按钮。端口、监听范围和日志在编辑弹窗；保存运行中服务配置会停止并重新启动。

默认只监听 127.0.0.1；用户开启局域网后才监听 0.0.0.0。分享使用宿主枚举的真实 IPv4 地址，提供复制与本地生成的二维码；多地址可选择。127.0.0.1、localhost、0.0.0.0 不能作为局域网分享链接。本机「进入」使用 loopback 地址。

管理 RPC 保持鉴权、Origin/Host 检查，并与访客业务端口分离。业务不得反向暴露 service.*、fs.* 或宿主令牌。防火墙、AP 客户端隔离、多个网卡、网络切换和手机后台保持需要实际网络测试。

## 8. 每次修改必须验证

- core 不导入业务包；默认业务依赖不回流到 core。
- 新增默认服务只需添加独立目录，目录清单与服务 UI 自动发现。
- ZIP 正常安装、外包目录、重复名称、缺失入口、路径越界和解压预算。
- 服务可读写本项目；越界读取/写入被拒；不能 spawn 或创建额外 Worker。
- HTTP/WS、静态文件、日志、重复启动去重、停止连接与数据跨重启保留。
- 多服务并存、停止一个不影响另一个；启动/运行失败如实上报。
- 共用 UI 类型检查和生产构建；桌面、Agent、Android Node bundle 接线检查。
- Android 真机：受限 Worker、局域网其他设备访问、前后台/熄屏/重启恢复。

当前已在 Windows Node 验证包导入、文件权限、HTTP/WS 和持久化；Android 仍需连接真机验证 Worker/Permission Model 和局域网访问。桌面安装包、SEA 成品和 Android APK 的发布前测试不能用本机 Node 测试结果替代。
