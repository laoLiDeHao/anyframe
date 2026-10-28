/// <reference types="vite/client" />

/**
 * 移动端全局类型声明。
 *
 * ⚠️ 两个必须记住的点：
 *
 * 1. 本文件末尾有 `export {}`，所以它是一个「模块」而不是「脚本」。
 *    在模块里写顶层 `declare const X` 只对模块内部可见，
 *    main.tsx 里用会报 TS2304: Cannot find name 'X'。
 *    要注入全局，必须写在 `declare global { }` 里面。
 *    （如果去掉 `export {}`，文件变回全局脚本，`declare global` 反而会报错
 *      ——「Augmentations for the global scope can only be directly nested
 *        in external modules」，两种写法二选一，别混。）
 *
 * 2. 这里刻意**不**声明 Electron 的 `window.anyframe` 桥。
 *    移动端跑在 Capacitor WebView 里，那个桥永远不存在；
 *    一旦声明了，共享代码里写 `window.anyframe?.system.close()`
 *    能通过类型检查，却在真机上静默什么都不做 —— 最难查的一类 bug。
 *    跨端分支请统一走 `@anyframe/core` 的 capabilities 探测，
 *    或者本文件的 `__ANYFRAME_TARGET__`。
 */

declare global {
  /**
   * 构建期注入的常量（见 vite.config.ts 的 define）。
   * 桌面/Web/移动三端同名，值为 'desktop' | 'web' | 'capacitor'，
   * 目的是让共享 UI 代码用同一套分支写法。
   */
  const __ANYFRAME_TARGET__: 'desktop' | 'web' | 'capacitor'

  interface Window {
    /**
     * Capacitor 原生容器注入的全局对象（native-bridge.js）。
     * 业务代码应优先 `import { Capacitor } from '@capacitor/core'`，
     * 这个声明只用于「判断当前是否真的跑在原生壳里」的兜底探测 ——
     * 例如纯浏览器打开 dist/index.html 时它不存在。
     */
    Capacitor?: {
      isNativePlatform(): boolean
      getPlatform(): 'android' | 'ios' | 'web'
      getVersion(): string
    }
  }
}

export {}
