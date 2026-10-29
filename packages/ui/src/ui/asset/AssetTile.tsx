import { useMediaUrl } from '../../app/useMediaUrl.ts'
import { formatBytes, KIND_COLOR, KIND_LABEL } from '../../model/media.ts'
import type { Asset, Group } from '../../model/types.ts'
import type { MediaStore } from '../../data/store.ts'

/**
 * 素材格子。
 *
 * 缩略图优先：有 thumb 用 thumb，图片没有 thumb（老数据 / 生成失败）就用原图，
 * 视频和音频一律不上 <video> —— 一屏 20 个 video 元素在 Android WebView 上
 * 会同时预加载，滑动直接卡死。
 */
export function AssetTile({
  store,
  asset,
  groups,
  selecting,
  selected,
  onOpen,
  onToggle,
}: {
  store: MediaStore | null
  asset: Asset
  groups: Group[]
  selecting: boolean
  selected: boolean
  onOpen: () => void
  onToggle: () => void
}) {
  const previewKey = asset.thumb ?? (asset.kind === 'image' ? asset.file : undefined)
  const url = useMediaUrl(store, previewKey, asset.thumb ? 'image/jpeg' : asset.mime)

  const groupNames = groups
    .filter((g) => asset.groupIds.includes(g.id))
    .map((g) => g.name)

  const className = [
    'af-tile',
    selecting && selected ? 'selected' : '',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <button
      className={className}
      onClick={selecting ? onToggle : onOpen}
      title={asset.name}
      aria-pressed={selecting ? selected : undefined}
    >
      <div className="af-thumb" style={{ background: KIND_COLOR[asset.kind] }}>
        {url ? (
          <img src={url} alt="" loading="lazy" draggable={false} />
        ) : (
          <div className="af-kind">
            <span aria-hidden="true">
              {asset.kind === 'video' ? '▶' : asset.kind === 'audio' ? '♪' : asset.kind === 'image' ? '◇' : '▫'}
            </span>
            <small>{KIND_LABEL[asset.kind]}</small>
          </div>
        )}
        {selecting && <span className={selected ? 'af-check on' : 'af-check'}>✓</span>}
        {groupNames.length > 0 && (
          <div className="af-tile-badges">
            {groupNames.slice(0, 2).map((name) => (
              <span className="af-tile-badge" key={name}>
                {name}
              </span>
            ))}
            {groupNames.length > 2 && (
              <span className="af-tile-badge">+{groupNames.length - 2}</span>
            )}
          </div>
        )}
      </div>
      <div className="af-tile-meta">
        <span className="af-tile-name">{asset.name}</span>
        <span className="af-tile-sub">
          {KIND_LABEL[asset.kind]} · {formatBytes(asset.size)}
        </span>
      </div>
    </button>
  )
}
