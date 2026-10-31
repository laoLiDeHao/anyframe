# Express 记事本与聊天室

服务已迁出 core。独立产物位于 `services/builtin/express-demo/index.js`，前端位于同级 `wwwroot/index.html`；源码为 `services/src/express-demo/index.ts`。

开发及包格式见 [服务规范](../../SERVICE_HOST_PLAN.md)。从 AnyFrame 服务列表运行，使用「进入」访问；开启局域网后可分享链接和二维码。笔记保存在服务自己的目录内，聊天消息不保存。

重新打包示例：`pnpm --filter @anyframe/default-services build`。不再从 core 导出 demoFactory。
