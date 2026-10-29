/**
 * 给三个宿主 app 用的入口 barrel。
 *
 * ⚠️ 这里**不能**导出 host/*（bootstrapHost、capacitor 适配器那些）：
 * 它们会 import @capacitor/core，而桌面 / Web 的产物里不该出现 Capacitor。
 * 各 app 自己负责探测宿主，然后把 HostSession 交给 AnyFrameApp ——
 * 平台差异留在 app 里，界面统一在 packages/ui 里。
 */
export { AnyFrameApp, type AnyFrameAppProps } from './app/AnyFrameApp.tsx'
export { HOST_LABEL, type HostKind, type HostSession } from './host/types.ts'
