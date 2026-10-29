/**
 * 缩略图生成。
 *
 * 为什么要有：项目列表与素材网格里同时出现 50 张 12MP 的原图，
 * 移动端 WebView 的内存会直接被撑爆 —— 而且症状是「滑两屏就白屏」，
 * 看上去像渲染 bug。落盘一份 320px 的 JPEG 是最省事的解法。
 *
 * 失败一律返回 null，由调用方退化为「用类型色块占位」。
 * 缩略图不是核心数据，不能因为它失败就让导入失败。
 */

const THUMB_MAX_EDGE = 320
const THUMB_QUALITY = 0.82

export async function makeThumbnail(source: Blob, maxEdge = THUMB_MAX_EDGE): Promise<Uint8Array | null> {
  if (typeof document === 'undefined') return null

  let drawable: ImageBitmap | HTMLImageElement | null = null
  let objectUrl: string | null = null

  try {
    if (typeof createImageBitmap === 'function') {
      drawable = await createImageBitmap(source)
    } else {
      // 老 WebView 兜底：走 <img>。注意 objectUrl 不能提前 revoke，
      // 否则 Chrome 会丢掉已经解码的位图，drawImage 得到一张空白图。
      objectUrl = URL.createObjectURL(source)
      const img = new Image()
      img.src = objectUrl
      await img.decode()
      drawable = img
    }

    const width = drawable.width || 1
    const height = drawable.height || 1
    const scale = Math.min(1, maxEdge / Math.max(width, height))
    const w = Math.max(1, Math.round(width * scale))
    const h = Math.max(1, Math.round(height * scale))

    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.drawImage(drawable, 0, 0, w, h)

    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob((b) => resolve(b), 'image/jpeg', THUMB_QUALITY)
    })
    if (!blob) return null
    return new Uint8Array(await blob.arrayBuffer())
  } catch {
    // 损坏的图片、不支持的编码（部分 HEIC）、内存不足都会走到这里
    return null
  } finally {
    if (drawable && 'close' in drawable && typeof drawable.close === 'function') drawable.close()
    if (objectUrl) URL.revokeObjectURL(objectUrl)
  }
}
