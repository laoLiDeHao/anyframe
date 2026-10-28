import type { Capabilities } from './contract.ts'

/**
 * ─────────────────────────────────────────────────────────────
 * 五端能力基线（静态声明）
 * ─────────────────────────────────────────────────────────────
 * 这张表是「设计时的真相」，用来驱动 UI 的功能开关与降级文案。
 * 它必须与 BUILD_MATRIX.md 的「能力矩阵」一节保持一致，改动时两处同步
 * （BUILD_MATRIX.md 是给人看的说明，这里是给代码用的常量）。
 *
 * 每一项都对应一条经过核实的平台约束，注释里写清依据，
 * 避免后人误以为「再找找 API 就能突破」。
 */

/** Windows 桌面（Electron 主进程 = 完整 Node.js） */
export const WINDOWS: Capabilities = {
  host: 'electron',
  platform: 'win32',
  arch: 'x64',
  version: '0.0.0',
  service: 'full', // child_process.spawn 无限制
  background: 'persistent', // 可注册为系统服务 / 开机自启
  fileSystem: 'full', // node:fs 任意路径
  device: { serial: true, usb: true, hid: true, ble: true },
}

/** Ubuntu / Linux 桌面（Electron 自带 Chromium，无 WebKitGTK 分化问题） */
export const LINUX: Capabilities = {
  host: 'electron',
  platform: 'linux',
  arch: 'x64',
  version: '0.0.0',
  service: 'full',
  background: 'persistent', // systemd user unit / autostart
  fileSystem: 'full', // 注意：AppImage 的 /tmp 可能 noexec，spawn 二进制别解压到 /tmp
  device: { serial: true, usb: true, hid: true, ble: true },
}

/** Web（浏览器直连，未安装本地 Agent 时的降级形态） */
export const WEB_NO_AGENT: Capabilities = {
  host: 'browser',
  platform: 'web',
  arch: 'wasm32',
  version: '0.0.0',
  service: 'none', // 浏览器沙箱内无法启动任何本地服务，无解
  background: 'none',
  fileSystem: 'scoped', // File System Access API（Chromium）/ OPFS 降级
  device: {
    // Web Serial：Chrome 89+ / Edge 89+ / Opera 76+ / Firefox 151+（需权限插件）
    // Safari 全版本（含 iOS 26）不支持 —— WebKit 明确拒绝
    serial: true,
    usb: true, // WebUSB，仅 Chromium
    hid: true, // WebHID，仅 Chromium
    ble: true, // Web Bluetooth，仅 Chromium；Safari/Firefox 不支持
  },
}

/** Web（已安装本地 Agent，通过 127.0.0.1 连接） */
export const WEB_WITH_AGENT: Capabilities = {
  ...WEB_NO_AGENT,
  host: 'agent',
  service: 'remote', // Agent 进程代管本地服务
  background: 'persistent', // Agent 常驻
  fileSystem: 'full', // 由 Agent 侧的 Node 完成
}

/**
 * Android（Capacitor）
 * - 不能 spawn 任意外部程序，只能跑 APK 内置二进制，且 Android 10+ 对 exec 有 W^X 限制
 * - 常驻靠 Foreground Service，Android 15+ 必须用 specialUse（dataSync 有 6h/24h 时限）
 * - Scoped Storage：任意路径需 MANAGE_EXTERNAL_STORAGE，Google Play 审核严格
 */
export const ANDROID: Capabilities = {
  host: 'capacitor',
  platform: 'android',
  arch: 'arm64',
  version: '0.0.0',
  service: 'embedded',
  background: 'foreground-only',
  fileSystem: 'scoped',
  device: {
    serial: true, // Chrome 148+ 支持 Web Serial；Capacitor 走系统 WebView，需用 usb-serial-for-android 原生插件
    usb: true, // USB Host API (OTG)
    hid: false, // 需原生插件
    ble: true,
  },
}

/**
 * iOS（Capacitor）
 * - App Store 审核指南 2.5.2 禁止下载/执行代码，spawn 永久不可行
 * - 切后台数秒内 suspend，beginBackgroundTask 仅延长约 3~10 分钟
 * - 无限制后台只开放给 audio / location / VoIP / newsstand / background-fetch
 * - WebKit 独占 → Web Serial/USB/HID 全部不可用，硬件只剩 CoreBluetooth(BLE)
 *   或需 MFi 认证的 External Accessory
 */
export const IOS: Capabilities = {
  host: 'capacitor',
  platform: 'ios',
  arch: 'arm64',
  version: '0.0.0',
  service: 'embedded',
  background: 'foreground-transient',
  fileSystem: 'sandbox',
  device: {
    serial: false,
    usb: false, // 除非 MFi 认证配件 + External Accessory 框架
    hid: false,
    ble: true, // 唯一可行的硬件通道
  },
}

// ── 能力判定工具 ────────────────────────────────────────────

export type FeatureId =
  | 'spawnProcess'
  | 'backgroundService'
  | 'arbitraryFileAccess'
  | 'serialDevice'
  | 'usbDevice'
  | 'systemTray'
  | 'autoStart'

/**
 * 单一入口：UI 层问「这个功能在当前平台能用吗」，只调这里。
 * 返回 false 时应展示 disabled 态 + 原因，而不是隐藏按钮，
 * 让用户知道桌面端有这个能力。
 */
export function can(caps: Capabilities, feature: FeatureId): boolean {
  switch (feature) {
    case 'spawnProcess':
      return caps.service === 'full'
    case 'backgroundService':
      return caps.background === 'persistent' || caps.background === 'foreground-only'
    case 'arbitraryFileAccess':
      return caps.fileSystem === 'full'
    case 'serialDevice':
      return caps.device?.serial === true
    case 'usbDevice':
      return caps.device?.usb === true
    case 'systemTray':
      return caps.host === 'electron'
    case 'autoStart':
      return caps.host === 'electron'
    default:
      return false
  }
}

/** 功能不可用时给用户看的解释文案（i18n 前的兜底中文） */
export function reason(caps: Capabilities, feature: FeatureId): string | null {
  if (can(caps, feature)) return null

  const table: Record<FeatureId, Partial<Record<Capabilities['platform'], string>>> = {
    spawnProcess: {
      ios: 'iOS 禁止应用启动外部程序（App Store 审核指南 2.5.2），此功能仅在桌面端可用。',
      android: 'Android 仅允许运行应用内置的服务，无法启动外部程序。',
      web: '浏览器沙箱内无法启动本地服务。请安装 AnyFrame 本地助手，或使用桌面版。',
    },
    backgroundService: {
      ios: 'iOS 在应用切到后台数分钟后会挂起服务，无法常驻运行。',
      android: '需要在通知栏保持前台服务，且部分厂商 ROM 需手动关闭电池优化。',
      web: '需要安装 AnyFrame 本地助手才能在后台保持服务。',
    },
    arbitraryFileAccess: {
      ios: 'iOS 仅允许访问应用沙箱，以及你通过系统选择器授权的文件。',
      android: 'Android 采用分区存储，仅能访问应用目录及你授权的文件夹。',
      web: '浏览器仅能访问你明确授权的目录。',
    },
    serialDevice: {
      ios: 'iOS 不支持 Web Serial。若设备支持蓝牙，可改用 BLE 连接。',
      web: 'Safari 与 Firefox 不支持 Web Serial，请使用 Chrome / Edge，或安装本地助手。',
    },
    usbDevice: {
      ios: 'iOS 需要 MFi 认证配件才能通过有线方式通信。',
    },
    systemTray: {
      android: '移动端无系统托盘概念。',
      ios: '移动端无系统托盘概念。',
      web: '浏览器不支持系统托盘。',
    },
    autoStart: {
      android: '移动端由系统管理启动，应用无法自行注册开机启动。',
      ios: '移动端由系统管理启动，应用无法自行注册开机启动。',
      web: '浏览器不支持开机自启。本地助手可独立设置开机自启。',
    },
  }

  return table[feature][caps.platform] ?? '当前平台不支持此功能。'
}
