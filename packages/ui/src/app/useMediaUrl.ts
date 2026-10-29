import { useEffect, useState } from 'react'
import type { MediaStore } from '../data/store.ts'

/**
 * 把存储里的 key 变成一个能直接塞进 <img src> / <video src> 的地址。
 *
 * 两个实现差异被这一层吃掉了：
 *   磁盘端 → data URL（RPC 读 base64）
 *   浏览器端 → blob URL（IndexedDB 取 Blob）
 *
 * 组件因此永远不需要知道自己在哪一端。
 */
export function useMediaUrl(
  store: MediaStore | null,
  key: string | undefined,
  mime: string,
): string | null {
  const [url, setUrl] = useState<string | null>(null)

  useEffect(() => {
    if (!store || !key) {
      setUrl(null)
      return
    }
    let cancelled = false
    setUrl(null)

    store
      .getUrl(key, mime)
      .then((res) => {
        if (!cancelled) setUrl(res.url)
      })
      .catch(() => {
        // 文件丢了（被手动删掉 / 换设备）就退化成类型占位图，
        // 不能让一格破图把整个网格带崩
        if (!cancelled) setUrl(null)
      })

    return () => {
      cancelled = true
    }
  }, [store, key, mime])

  return url
}
