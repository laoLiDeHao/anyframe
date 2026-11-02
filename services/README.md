# 默认服务与用户服务包

开发约定见 [SERVICE_HOST_PLAN.md](../SERVICE_HOST_PLAN.md)。

将预打包的 CommonJS `index.js` 与 `wwwroot/index.html` 放进 `builtin/<id>/`，宿主会自动发现。业务依赖由作者打包，不在设备安装依赖。用户可将相同目录结构打成 ZIP，在服务页导入。

本仓库记事本/聊天室源码为 `src/express-demo/index.ts`，前端为 `builtin/express-demo/wwwroot/index.html`。修改源码后运行 `pnpm --filter @anyframe/default-services build` 更新独立 JS 产物；无需重写宿主逻辑。

`index.js` 导出异步 `start({ host, port, projectDir, publicDir, log })`，等待监听完成后返回 `{ port, close() }`。业务只访问自己的项目目录，不能创建子进程或额外 Worker；宿主不具备文件权限限制能力时应拒绝运行。

ZIP 导入不设固定压缩大小、解压总量、单文件大小或文件数量上限；导入请求也不受普通 RPC 的 32 MiB 请求体与客户端超时限制。路径穿越、非法文件名、符号链接、原生扩展、宿主元数据与运行数据注入等校验继续生效。当前导入仍在内存中处理 ZIP/base64，实际可导入大小取决于设备可用内存和磁盘空间。

服务列表支持修改显示名称（服务 ID 和数据目录不变）、上移/下移，名称和顺序保存在宿主上。用户导入的服务可删除，确认后停止运行实例并永久删除服务包与全部运行数据。系统默认服务不可删除，显示名称和排序可调整。
