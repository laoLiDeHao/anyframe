#!/usr/bin/env node
/**
 * ─────────────────────────────────────────────────────────────
 * 桌面端图标生成（零依赖）
 * ─────────────────────────────────────────────────────────────
 *   pnpm gen:icons
 *
 * 为什么需要这个脚本：
 *   electron-builder.yml 里 win.icon / nsis.installerIcon / linux.icon
 *   都是**显式指定**的资源。缺文件时不是「回退到默认图标」那么温柔 ——
 *   `electron-builder --win` 会直接失败：
 *     ⨯ cannot find specified resource "build/icon.ico"
 *   只有 `--dir`（不产出安装包）才容忍缺失，所以本地 --dir 跑通
 *   完全不能说明 CI 的 dist:win / dist:linux 能跑通。
 *
 * 为什么不用 ImageMagick / sharp / icon-gen：
 *   前者要求用户预装系统包（Windows 上基本没有）；后两者是 npm 依赖，
 *   sharp 还带平台相关的预编译二进制，在国内网络下经常装不上。
 *   ICO / PNG / BMP 的编码都足够简单，用 node:zlib 手写一遍即可，
 *   代价是两百来行代码，换来的是「clone 下来 pnpm install 就能出包」。
 *
 * 产出的是**占位图形**（圆角徽章 + 四角取景框，对应 AnyFrame 的 "frame"）。
 * 正式发布前请替换成品牌图标：把 renderBadge() 换成读取你的 1024×1024 源图，
 * 其余的缩放 / 编码逻辑可以原样复用。
 */
import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const BUILD = join(ROOT, 'apps', 'desktop', 'build')
const ICONS = join(BUILD, 'icons')

// 超采样边长。先渲染一张大图再面积平均缩小，比直接在小尺寸上画
// 得到的边缘质量好得多 —— 16px 的托盘图标尤其明显。
const S = 2048

// 各格式要求的尺寸。ICO 的尺寸取自 Windows 的 SM_CX* 系统度量；
// PNG 的 <size>x<size>.png 命名是 electron-builder 硬性要求的。
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256]
const PNG_SIZES = [16, 24, 32, 48, 64, 128, 256, 512]
const TRAY_SIZES = [16, 24, 32]

// ── CRC32（PNG 每个 chunk 都要）─────────────────────────────

const CRC_TABLE = (() => {
  const t = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c
  }
  return t
})()

function crc32(buf) {
  let c = -1
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ -1) >>> 0
}

// ── PNG 编码 ────────────────────────────────────────────────

function pngChunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length, 0)
  const name = Buffer.from(type, 'ascii')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([name, data])), 0)
  return Buffer.concat([len, name, data, crc])
}

/** @param {Buffer} rgba 长度必须为 w*h*4，行优先，自上而下 */
function encodePng(w, h, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8   // bit depth
  ihdr[9] = 6   // color type = RGBA
  ihdr[10] = 0  // compression
  ihdr[11] = 0  // filter
  ihdr[12] = 0  // interlace

  // 每行前面要加一个 filter byte。全用 0（None）—— 超采样后的边缘信息
  // 很碎，Sub/Up/Paeth 这类预测滤波器省不下多少，反而每行多花时间试。
  const stride = w * 4 + 1
  const raw = Buffer.alloc(stride * h)
  for (let y = 0; y < h; y++) {
    raw[y * stride] = 0
    rgba.copy(raw, y * stride + 1, y * w * 4, (y + 1) * w * 4)
  }

  return Buffer.concat([
    sig,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ])
}

// ── ICO 编码 ────────────────────────────────────────────────
// Vista 起 ICO 的每个条目允许直接塞一张 PNG，不必转成 BMP + AND mask。
// electron-builder 只校验「有没有 256 这一档」，不校验内部编码方式。

/** @param {{size:number, png:Buffer}[]} entries */
function encodeIco(entries) {
  const n = entries.length
  const header = Buffer.alloc(6 + 16 * n)
  header.writeUInt16LE(0, 0) // reserved
  header.writeUInt16LE(1, 2) // type: 1 = icon
  header.writeUInt16LE(n, 4)

  let offset = 6 + 16 * n
  entries.forEach((im, idx) => {
    const e = 6 + 16 * idx
    // 宽高字段是单字节，256 用 0 表示 —— ICO 格式的历史遗留。
    const dim = im.size >= 256 ? 0 : im.size
    header[e] = dim
    header[e + 1] = dim
    header[e + 2] = 0 // color count（0 = 不用调色板）
    header[e + 3] = 0 // reserved
    header.writeUInt16LE(1, e + 4)          // planes
    header.writeUInt16LE(32, e + 6)         // bit count
    header.writeUInt32LE(im.png.length, e + 8)
    header.writeUInt32LE(offset, e + 12)
    offset += im.png.length
  })

  return Buffer.concat([header, ...entries.map((i) => i.png)])
}

// ── BMP 编码（24 位；NSIS 侧边图不接受 PNG）─────────────────

/** @param {Buffer} rgb 长度 w*h*3，自上而下 */
function encodeBmp24(w, h, rgb) {
  const rowSize = Math.ceil((w * 3) / 4) * 4 // 每行补齐到 4 字节
  const pixels = Buffer.alloc(rowSize * h)
  for (let y = 0; y < h; y++) {
    // BMP 行序自底向上、通道序 BGR，两处都要翻。
    const srcY = h - 1 - y
    for (let x = 0; x < w; x++) {
      const s = (srcY * w + x) * 3
      const d = y * rowSize + x * 3
      pixels[d] = rgb[s + 2]
      pixels[d + 1] = rgb[s + 1]
      pixels[d + 2] = rgb[s]
    }
  }

  const fh = Buffer.alloc(14)
  fh.write('BM', 0)
  fh.writeUInt32LE(54 + pixels.length, 2)
  fh.writeUInt32LE(54, 10) // 像素数据偏移 = 14 + 40

  const ih = Buffer.alloc(40)
  ih.writeUInt32LE(40, 0)
  ih.writeInt32LE(w, 4)
  ih.writeInt32LE(h, 8)     // 正数 = 自底向上
  ih.writeUInt16LE(1, 12)   // planes
  ih.writeUInt16LE(24, 14)  // bpp
  ih.writeUInt32LE(0, 16)   // BI_RGB
  ih.writeUInt32LE(pixels.length, 20)

  return Buffer.concat([fh, ih, pixels])
}

// ── 图形渲染 ────────────────────────────────────────────────
// 全部用有符号距离场（SDF）+ 覆盖率抗锯齿，而不是硬判断 in/out。
// 16px 下若不用 SDF，取景框的细臂会整条消失或者糊成一坨。

/** 圆角矩形 SDF。p 是到中心的偏移，h 半宽高，r 圆角半径。 */
function sdRoundBox(px, py, hx, hy, r) {
  const qx = Math.abs(px) - hx + r
  const qy = Math.abs(py) - hy + r
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r
}

/** 直角矩形 SDF。c 中心，h 半宽高。 */
function sdBox(px, py, cx, cy, hx, hy) {
  const dx = Math.abs(px - cx) - hx
  const dy = Math.abs(py - cy) - hy
  return Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) + Math.min(Math.max(dx, dy), 0)
}

/** SDF → 覆盖率。pixel 是归一化坐标系下的单像素边长（= 1/S）。 */
function cover(sd, pixel) {
  return Math.min(1, Math.max(0, 0.5 - sd / pixel))
}

const INDIGO = [79, 70, 229]   // #4F46E5
const CYAN = [6, 182, 212]     // #06B6D4

/**
 * 渲染 size×size 的 RGBA 徽章。
 * 坐标系归一化到 [-0.5, 0.5]，这样换 size 不用改任何几何常量。
 */
function renderBadge(size = S) {
  const buf = Buffer.alloc(size * size * 4)
  const pixel = 1 / size

  // 取景框几何：外缘距中心 E，臂长 AL，臂厚 TB。
  // 徽章半宽 0.42，E 取 0.29 让框与边缘留出 0.13 的呼吸空间。
  const E = 0.29
  const AL = 0.155
  const TB = 0.058

  for (let y = 0; y < size; y++) {
    const v = (y + 0.5) / size - 0.5
    for (let x = 0; x < size; x++) {
      const u = (x + 0.5) / size - 0.5
      const i = (y * size + x) * 4

      const bg = cover(sdRoundBox(u, v, 0.42, 0.42, 0.14), pixel)
      if (bg <= 0) continue // 保持全 0 = 完全透明

      // 对角渐变
      const t = Math.min(1, Math.max(0, (u - v) * 0.7 + 0.5))
      let r = INDIGO[0] + (CYAN[0] - INDIGO[0]) * t
      let g = INDIGO[1] + (CYAN[1] - INDIGO[1]) * t
      let b = INDIGO[2] + (CYAN[2] - INDIGO[2]) * t

      // 四个角的取景框。用 (sx*u, sy*v) 把四个象限折叠到第一象限，
      // 一套几何常量就能画出四个角。
      let glyph = 0
      for (const sx of [-1, 1]) {
        for (const sy of [-1, 1]) {
          const qx = sx * u
          const qy = sy * v
          const armH = sdBox(qx, qy, E - AL / 2, E - TB / 2, AL / 2, TB / 2)
          const armV = sdBox(qx, qy, E - TB / 2, E - AL / 2, TB / 2, AL / 2)
          glyph = Math.max(glyph, cover(Math.min(armH, armV), pixel))
        }
      }

      // 中心点。小尺寸下会被面积平均吃掉，但大尺寸版本不至于太空。
      const dot = cover(Math.hypot(u, v) - 0.05, pixel)

      const w = Math.max(glyph, dot)
      if (w > 0) {
        r += (255 - r) * w
        g += (255 - g) * w
        b += (255 - b) * w
      }

      buf[i] = Math.round(r)
      buf[i + 1] = Math.round(g)
      buf[i + 2] = Math.round(b)
      buf[i + 3] = Math.round(255 * bg)
    }
  }
  return buf
}

/** 面积平均缩放。支持非整数倍率（2048 → 48 这种）。 */
function resize(src, srcSize, dstSize) {
  const out = Buffer.alloc(dstSize * dstSize * 4)
  const scale = srcSize / dstSize
  for (let y = 0; y < dstSize; y++) {
    const y0 = y * scale
    const y1 = y0 + scale
    const iy0 = Math.floor(y0)
    const iy1 = Math.min(srcSize, Math.ceil(y1))
    for (let x = 0; x < dstSize; x++) {
      const x0 = x * scale
      const x1 = x0 + scale
      const ix0 = Math.floor(x0)
      const ix1 = Math.min(srcSize, Math.ceil(x1))
      let r = 0, g = 0, b = 0, a = 0
      for (let sy = iy0; sy < iy1; sy++) {
        const wy = Math.min(sy + 1, y1) - Math.max(sy, y0)
        if (wy <= 0) continue
        for (let sx = ix0; sx < ix1; sx++) {
          const wx = Math.min(sx + 1, x1) - Math.max(sx, x0)
          if (wx <= 0) continue
          const w = wx * wy
          const i = (sy * srcSize + sx) * 4
          r += src[i] * w
          g += src[i + 1] * w
          b += src[i + 2] * w
          a += src[i + 3] * w
        }
      }
      const area = scale * scale
      const o = (y * dstSize + x) * 4
      out[o] = Math.round(r / area)
      out[o + 1] = Math.round(g / area)
      out[o + 2] = Math.round(b / area)
      out[o + 3] = Math.round(a / area)
    }
  }
  return out
}

/** NSIS 向导侧边图：164 × 314，24 位，顶部居中放一枚徽章。 */
function renderSidebar(badge) {
  const W = 164
  const H = 314
  const badgeSize = 96
  const small = resize(badge, S, badgeSize)
  const rgb = Buffer.alloc(W * H * 3)
  const bx = Math.round((W - badgeSize) / 2)
  const by = 40

  for (let y = 0; y < H; y++) {
    const t = y / (H - 1)
    // 深色渐变：NSIS 会在侧边图上方画白色标题文字，底色必须够暗
    const br = Math.round(30 - 18 * t)
    const bg = Math.round(27 + 20 * t)
    const bb = Math.round(75 + 35 * t)
    for (let x = 0; x < W; x++) {
      const o = (y * W + x) * 3
      let r = br, g = bg, b = bb
      if (x >= bx && x < bx + badgeSize && y >= by && y < by + badgeSize) {
        const si = ((y - by) * badgeSize + (x - bx)) * 4
        const a = small[si + 3] / 255
        r = Math.round(r + (small[si] - r) * a)
        g = Math.round(g + (small[si + 1] - g) * a)
        b = Math.round(b + (small[si + 2] - b) * a)
      }
      rgb[o] = r
      rgb[o + 1] = g
      rgb[o + 2] = b
    }
  }
  return encodeBmp24(W, H, rgb)
}

// ── 主流程 ──────────────────────────────────────────────────

console.log(`渲染 ${S}×${S} 源图…`)
const t0 = Date.now()
const badge = renderBadge(S)
console.log(`  完成，用时 ${((Date.now() - t0) / 1000).toFixed(1)}s`)

// build/icons 是 electron-builder 的约定目录。旧文件必须先清掉，
// 否则改了尺寸集合之后，残留的 png 还会被打进 deb / rpm。
rmSync(ICONS, { recursive: true, force: true })
mkdirSync(ICONS, { recursive: true })

const written = []
function emit(rel, data) {
  writeFileSync(join(BUILD, rel), data)
  written.push([rel, data.length])
}

console.log('编码 icon.ico …')
emit(
  'icon.ico',
  encodeIco(ICO_SIZES.map((s) => ({ size: s, png: encodePng(s, s, resize(badge, S, s)) }))),
)

console.log('编码 icons/*.png …')
for (const s of PNG_SIZES) {
  emit(`icons/${s}x${s}.png`, encodePng(s, s, resize(badge, S, s)))
}

console.log('编码 tray.ico / tray.png …')
emit(
  'tray.ico',
  encodeIco(TRAY_SIZES.map((s) => ({ size: s, png: encodePng(s, s, resize(badge, S, s)) }))),
)
// Linux 托盘只吃单个 png。GNOME 面板槽位 22px、KDE 24px，
// 给 32 让面板自己缩；直接给 22 在 HiDPI 下会糊。
emit('tray.png', encodePng(32, 32, resize(badge, S, 32)))

console.log('编码 installer-sidebar.bmp …')
emit('installer-sidebar.bmp', renderSidebar(badge))

console.log('\n产出：')
for (const [rel, bytes] of written) {
  console.log(`  ${rel.padEnd(26)} ${(bytes / 1024).toFixed(1).padStart(8)} KB`)
}
console.log(`\n共 ${written.length} 个文件 → ${BUILD}`)
console.log('这些是占位图形。正式发布前请替换成品牌图标（见 build/README.md）。')
