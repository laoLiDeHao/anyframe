import type { MediaKind } from './types.ts'

/**
 * 素材类型识别与展示格式化。
 * 全部是纯函数，导入管线与界面共用同一套判断 —— 两处各写一份是本项目
 * 最容易埋雷的地方（「网格里显示成图片，点开说不能预览」）。
 */

/** 扩展名 → MIME 的兜底表。只列最常见的几种，未知一律 other。 */
const EXT_MIME: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  bmp: 'image/bmp',
  svg: 'image/svg+xml',
  heic: 'image/heic',
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  mov: 'video/quicktime',
  webm: 'video/webm',
  mkv: 'video/x-matroska',
  ogv: 'video/ogg',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  wav: 'audio/wav',
  flac: 'audio/flac',
  ogg: 'audio/ogg',
  opus: 'audio/opus',
}

/** 允许作为「媒体」的扩展名。缩略图、路径安全都依赖它。 */
export function isKnownExtension(ext: string): boolean {
  return Object.hasOwn(EXT_MIME, ext)
}

/**
 * 取扩展名。没有扩展名、或扩展名里有路径分隔符时返回空串。
 * 返回值直接拼进落盘路径，所以必须白名单化（防 `../` 与超长后缀）。
 */
export function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.')
  if (dot <= 0 || dot === name.length - 1) return ''
  const ext = name.slice(dot + 1).toLowerCase()
  return /^[a-z0-9]{1,8}$/.test(ext) ? ext : ''
}

/**
 * 判定素材类型：MIME 优先，扩展名兜底。
 *
 * 为什么要兜底：Android 的媒体选择器经常给出空 MIME（尤其是从「文件」而不是
 * 「照片」入口选的），iOS 对 HEIC 也只报 application/octet-stream。
 * 只看 MIME 会让一半的手机素材变成 other。
 */
export function kindOf(mime: string, name: string): MediaKind {
  const normalized = mime.toLowerCase()
  if (normalized.startsWith('image/')) return 'image'
  if (normalized.startsWith('video/')) return 'video'
  if (normalized.startsWith('audio/')) return 'audio'

  const ext = extensionOf(name)
  const fromExt = ext ? EXT_MIME[ext] : undefined
  if (!fromExt) return 'other'
  if (fromExt.startsWith('image/')) return 'image'
  if (fromExt.startsWith('video/')) return 'video'
  if (fromExt.startsWith('audio/')) return 'audio'
  return 'other'
}

/** 补齐 MIME：给 data URL 与 <video type> 用。 */
export function resolveMime(mime: string, name: string): string {
  if (mime && mime !== 'application/octet-stream') return mime
  const ext = extensionOf(name)
  return (ext && EXT_MIME[ext]) || 'application/octet-stream'
}

export const KIND_LABEL: Record<MediaKind, string> = {
  image: '图片',
  video: '视频',
  audio: '音频',
  other: '文件',
}

/** 网格里没有缩略图时的占位色，按类型区分，不做花哨的渐变 */
export const KIND_COLOR: Record<MediaKind, string> = {
  image: '#1e3a5f',
  video: '#3b2450',
  audio: '#1f4038',
  other: '#2b2f38',
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB']
  let value = bytes / 1024
  let i = 0
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024
    i += 1
  }
  // 10 以上不要小数位：52.3KB 没意义，52KB 才像人话
  return `${value >= 10 ? Math.round(value) : value.toFixed(1)} ${units[i]}`
}

export function formatDate(ts: number): string {
  const d = new Date(ts)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** 相对时间：列表里比绝对时间好扫读 */
export function formatRelative(ts: number, now = Date.now()): string {
  const diff = now - ts
  const min = 60_000
  if (diff < min) return '刚刚'
  if (diff < 60 * min) return `${Math.floor(diff / min)} 分钟前`
  if (diff < 24 * 60 * min) return `${Math.floor(diff / (60 * min))} 小时前`
  if (diff < 30 * 24 * 60 * min) return `${Math.floor(diff / (24 * 60 * min))} 天前`
  return formatDate(ts).slice(0, 10)
}

export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return ''
  const total = Math.round(seconds)
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

/**
 * 生成 id。
 *
 * 不用自增序号：两个端各自建项目，自增会撞。
 * crypto.randomUUID 在所有目标环境（Electron 44 / Chromium、Android WebView、
 * iOS 16+ Safari）都有，但旧 WebView 上可能缺失，所以留了退化分支。
 */
export function newId(prefix: string): string {
  const uuid =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID().replace(/-/g, '').slice(0, 16)
      : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`
  return `${prefix}_${uuid}`
}
