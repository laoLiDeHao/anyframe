import { useEffect, useRef, useState, type ReactNode } from 'react'

/**
 * 通用小部件。
 * 刻意保持「无状态优先」：弹窗的开关由页面持有，这里只负责长相，
 * 否则会出现两个地方都能改 visible、互相打架的经典问题。
 */

export function Banner({
  tone = 'warn',
  title,
  children,
}: {
  tone?: 'warn' | 'info' | 'error'
  title?: ReactNode
  children?: ReactNode
}) {
  return (
    <div className={tone === 'warn' ? 'af-banner' : `af-banner ${tone}`}>
      <div>
        {title && <strong>{title}</strong>}
        {title && children ? ' ' : null}
        {children}
      </div>
    </div>
  )
}

export function Empty({
  icon,
  title,
  desc,
  action,
}: {
  icon?: string
  title: string
  desc?: ReactNode
  action?: ReactNode
}) {
  return (
    <div className="af-empty">
      {icon && <div className="af-empty-icon">{icon}</div>}
      <div className="af-empty-title">{title}</div>
      {desc && <div className="af-empty-desc">{desc}</div>}
      {action}
    </div>
  )
}

export function Modal({
  title,
  desc,
  children,
  actions,
  onClose,
}: {
  title: ReactNode
  desc?: ReactNode
  children?: ReactNode
  actions?: ReactNode
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      className="af-overlay"
      onMouseDown={(e) => {
        // 只有在遮罩上按下才算「点外面」；在弹窗里拖选文字后松手到遮罩上不该关
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="af-modal" ref={ref} role="dialog" aria-modal="true">
        <h2 className="af-modal-title">{title}</h2>
        {desc && <p className="af-modal-desc">{desc}</p>}
        {children}
        {actions && <div className="af-modal-actions">{actions}</div>}
      </div>
    </div>
  )
}

export function ConfirmDialog({
  title,
  desc,
  confirmLabel = '确定',
  danger = false,
  busy = false,
  onCancel,
  onConfirm,
}: {
  title: ReactNode
  desc?: ReactNode
  confirmLabel?: string
  danger?: boolean
  busy?: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  return (
    <Modal
      title={title}
      desc={desc}
      onClose={onCancel}
      actions={
        <>
          <button className="af-btn af-btn-ghost" onClick={onCancel} disabled={busy}>
            取消
          </button>
          <button
            className={danger ? 'af-btn af-btn-danger' : 'af-btn af-btn-primary'}
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? '处理中…' : confirmLabel}
          </button>
        </>
      }
    />
  )
}

export function PromptDialog({
  title,
  desc,
  label,
  initial = '',
  placeholder,
  confirmLabel = '确定',
  busy = false,
  onCancel,
  onSubmit,
}: {
  title: ReactNode
  desc?: ReactNode
  label?: string
  initial?: string
  placeholder?: string
  confirmLabel?: string
  busy?: boolean
  onCancel: () => void
  onSubmit: (value: string) => void
}) {
  const [value, setValue] = useState(initial)
  const inputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    // 手机上自动聚焦会顶起键盘、把弹窗推走，所以只在没有触摸的环境自动聚焦
    if (typeof window !== 'undefined' && window.matchMedia('(pointer: fine)').matches) {
      inputRef.current?.focus()
      inputRef.current?.select()
    }
  }, [])

  const submit = () => {
    if (busy) return
    onSubmit(value)
  }

  return (
    <Modal
      title={title}
      desc={desc}
      onClose={onCancel}
      actions={
        <>
          <button className="af-btn af-btn-ghost" onClick={onCancel} disabled={busy}>
            取消
          </button>
          <button className="af-btn af-btn-primary" onClick={submit} disabled={busy}>
            {busy ? '处理中…' : confirmLabel}
          </button>
        </>
      }
    >
      {label && <label className="af-label">{label}</label>}
      <input
        ref={inputRef}
        className="af-input"
        value={value}
        placeholder={placeholder}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') submit()
        }}
      />
    </Modal>
  )
}

export function Toast({ text, tone }: { text: string; tone: 'ok' | 'error' | 'info' }) {
  return <div className={tone === 'info' ? 'af-toast' : `af-toast ${tone}`}>{text}</div>
}
