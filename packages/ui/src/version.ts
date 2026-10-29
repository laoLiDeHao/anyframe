/**
 * 版本号的展示口径。
 *
 * 为什么需要这一层：能力表里的 version 有两个来源 ——
 *   - Electron 主进程 / Agent：`app.getVersion()`，是真实版本
 *   - Web 无助手：静态基线 `WEB_NO_AGENT`，值是 '0.0.0'（浏览器读不到 package.json）
 *
 * 首页与设备页如果直接显示 caps.version，Web 端就会出现「v0.0.0」这种
 * 一眼假的信息。所以构建时把 package.json 的版本注入进来兜底：
 *
 *   1. 宿主上报了真实版本（不是 0.0.0）→ 用它
 *   2. 否则用构建期注入的包版本
 *
 * 注入点在四个 vite.config.ts（core 不参与，UI 才是展示方）。
 */

declare const __ANYFRAME_VERSION__: string | undefined

export const APP_VERSION: string =
  typeof __ANYFRAME_VERSION__ === 'string' && __ANYFRAME_VERSION__ ? __ANYFRAME_VERSION__ : '0.0.0'

export function resolveVersion(reported: string | undefined): string {
  return reported && reported !== '0.0.0' ? reported : APP_VERSION
}
