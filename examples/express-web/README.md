# 最简 Express 网页测试

在 AnyFrame 的“服务”页点击“启动示例”，打开显示的地址即可。
桌面版使用 Electron 自带 Node，Agent 使用自己的 Node 运行时，最终用户无需安装 Node。
此示例运行在宿主进程中，仅用于功能验证；不代表已实现任意 Node 工程部署或进程隔离。

页面只有两部分：

- 记事本：`GET/POST /api/notes`、`PUT/DELETE /api/notes/:id`。
- 聊天室：`/ws`，打开两个页面，用不同昵称发送消息，验证双方实时收到。

笔记原子写入宿主数据目录的 `services/express-demo/notes.json`；聊天消息不保存。
取消勾选局域网访问时仅本机可用；勾选后同网络设备可读写测试数据，没有账号系统。
停止服务会关闭 HTTP 和 WebSocket，重新启动保留笔记。

开发机也可以单独启动同一份示例，不用先开桌面 UI：

```powershell
pnpm build:core
node examples/express-web/server.mjs
```

默认地址 `http://127.0.0.1:8080`。可用 HOST、PORT、ANYFRAME_DATA_ROOT 环境变量配置。
该开发入口需要开发机已有 Node；安装版用户直接点击服务页，不使用这条命令。

后端实现：`packages/core/src/runtime/express-demo.ts`。
前端页面：`packages/core/src/runtime/demo-page.ts`，原生 HTML/JS，无 CDN、无前端依赖。
共享管理页：`packages/ui/src/ui/pages/ServicesPage.tsx`。

Android 当前仅展示管理页与明确的能力提示，原生 libnode 适配仍待接入。
