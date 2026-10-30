# Android 内嵌 Node

APK 自带 libnode、JNI 桥和 `host.ts` 的单文件 bundle（含 Express/WS），用户无需安装 Node 或 npm。
桌面示例使用 Electron 自带的 Node；业务实现共用 `packages/core/src/runtime/express-demo.ts`。

运行链路：Capacitor → 前台 `LocalHttpService`（`:node` 独立进程）→ JNI `node::Start` → Node RPC / ServiceManager。
管理 RPC 只监听 `127.0.0.1` 的随机端口；启动时随机生成令牌，通过应用私有状态文件和原生桥交付给 WebView。
HTTP/WS 示例默认本机，可在服务页选择 `0.0.0.0` 向局域网开放；局域网示例无登录，只放测试数据。
笔记保存在 `files/services/express-demo/notes.json`，停止示例或重开应用后保留；聊天仅广播、不保存。

## 固定运行库

- 社区分支：https://github.com/fogtape/nodejs-mobile
- 发布标签：`v24.22.0-0`（上游标为 prerelease，属于本项目技术验证依赖）
- 资产：`nodejs-mobile-android-24.22.0-0.zip`，112769022 bytes
- SHA256：`9b068f4ad4c755f26c04b31883c536f037a4831e6575847a699cdf5fa72dde25`
- ABI：arm64-v8a / armeabi-v7a / x86_64；NDK 27.1.12297006，CMake 3.22.1，C++20。
- 许可证与第三方声明：`../native/android/node/LICENSE`，随 APK 放在 `assets/node-runtime/LICENSE`。

二进制缓存位于仓库 `build-output/node-mobile`，不入 Git。`prepare-node.mjs` 下载固定资产，校验后提取。
原生源码保存在 `native/android`；`android/` 是生成物，不直接维护。

## 构建与验证

```sh
pnpm --filter @anyframe/core build
pnpm --filter @anyframe/mobile build
pnpm --filter @anyframe/mobile setup:native android
pnpm --filter @anyframe/mobile test:node
pnpm --filter @anyframe/mobile dist:android
```

Node bundle 集成测试会在开发机的 Node 上执行，覆盖鉴权、文件范围、示例 HTTP/WS、停止释放与重启持久化；
它不能代替 Android 真机测试。真机需验证：首次启动、同一 Wi-Fi 浏览器 CRUD 与双端聊天、反复启停、后台/熄屏、宿主停止后重启。

关闭 UI 不主动结束前台宿主；系统仍可因省电或资源压力结束它。系统结束后需重新打开应用启动，示例不自动恢复。
停止单个示例会关闭 HTTP/WS 并等待写入完成。停止整个宿主会结束 `:node` 进程以满足 Node 单次初始化要求，
不能在同一进程再次 `node::Start`；下次启动重建进程。管理页首版仅支持内置模板，导入任意 npm 服务包留待后续实现。
