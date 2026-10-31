# 默认服务与用户服务包

开发约定见 [SERVICE_HOST_PLAN.md](../SERVICE_HOST_PLAN.md)。

将预打包的 CommonJS `index.js` 与 `wwwroot/index.html` 放进 `builtin/<id>/`，宿主会自动发现。业务依赖由作者打包，不在设备安装依赖。用户可将相同目录结构打成 ZIP，在服务页导入。

本仓库记事本/聊天室源码为 `src/express-demo/index.ts`，前端为 `builtin/express-demo/wwwroot/index.html`。修改源码后运行 `pnpm --filter @anyframe/default-services build` 更新独立 JS 产物；无需重写宿主逻辑。

`index.js` 导出异步 `start({ host, port, projectDir, publicDir, log })`，等待监听完成后返回 `{ port, close() }`。业务只访问自己的项目目录，不能创建子进程或额外 Worker；宿主不具备文件权限限制能力时应拒绝运行。
