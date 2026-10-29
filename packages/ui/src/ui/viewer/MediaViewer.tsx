import { useEffect } from 'react'
import { useMediaUrl } from '../../app/useMediaUrl.ts'
import type { MediaStore } from '../../data/store.ts'
import { formatBytes, formatDate, KIND_LABEL } from '../../model/media.ts'
import type { Asset, Group } from '../../model/types.ts'

/**
 * 全屏查看器。
 *
 * 不做路由：它就是一个覆盖层，关掉就回到原来的滚动位置。
 * 移动端是全屏页面的观感，桌面端是灯箱 —— 同一个组件，靠 CSS 断点区分。
 */
export function MediaViewer({
  store,
  assets,
  index,
  groups,
  onClose,
  onChange,
}: {
  store: MediaStore | null
  assets: Asset[]
  index: number
  groups: Group[]
  onClose: () => void
  onChange: (next: number) => void
}) {
  const asset = assets[index]
  // hook 必须在任何 return 之前调用：素材被删掉时 index 可能越界，
  // 那样 asset 为 undefined，但钩子顺序不能变
  const url = useMediaUrl(store, asset?.file, asset?.mime ?? 'application/octet-stream')

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowLeft' && index > 0) onChange(index - 1)
      if (e.key === 'ArrowRight' && index < assets.length - 1) onChange(index + 1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [index, assets.length, onClose, onChange])

  if (!asset) return null

  const assetGroups = groups.filter((g) => asset.groupIds.includes(g.id))

  return (
    <div className="af-viewer" role="dialog" aria-modal="true">
      <div className="af-viewer-head">
        <div className="af-viewer-title">
          <span className="af-viewer-name">{asset.name}</span>
          <span className="af-viewer-sub">
            {KIND_LABEL[asset.kind]} · {formatBytes(asset.size)} · {formatDate(asset.addedAt)}
          </span>
        </div>
        <div className="af-spacer" />
        <button className="af-btn af-btn-ghost" onClick={onClose} aria-label="关闭">
          ✕ 关闭
        </button>
      </div>

      <div className="af-viewer-body">
        {index > 0 && (
          <button className="af-nav-btn prev" onClick={() => onChange(index - 1)} aria-label="上一个">
            ‹
          </button>
        )}

        {asset.kind === 'image' && (url ? <img src={url} alt={asset.name} /> : <Loading />)}

        {asset.kind === 'video' &&
          (url ? <video src={url} controls playsInline preload="metadata" /> : <Loading />)}

        {asset.kind === 'audio' &&
          (url ? <audio src={url} controls preload="metadata" /> : <Loading />)}

        {asset.kind === 'other' && (
          <div className="af-viewer-fallback">
            <div style={{ fontSize: 28, opacity: 0.5 }}>▫</div>
            <div>暂不支持在应用内预览这种格式</div>
            <div className="af-muted-2">文件已保存，可以按下方路径在原设备上打开</div>
            <code className="af-muted-2" style={{ wordBreak: 'break-all' }}>
              {asset.file}
            </code>
          </div>
        )}

        {index < assets.length - 1 && (
          <button className="af-nav-btn next" onClick={() => onChange(index + 1)} aria-label="下一个">
            ›
          </button>
        )}
      </div>

      <div className="af-viewer-foot">
        <span className="af-muted-2">
          {index + 1} / {assets.length}
        </span>
        <div className="af-spacer" />
        {assetGroups.length === 0 ? (
          <span className="af-muted-2">未分组</span>
        ) : (
          assetGroups.map((g) => (
            <span key={g.id} className="af-chip" style={{ cursor: 'default' }}>
              {g.name}
            </span>
          ))
        )}
      </div>
    </div>
  )
}

function Loading() {
  return <div className="af-muted-2">正在读取文件…</div>
}
