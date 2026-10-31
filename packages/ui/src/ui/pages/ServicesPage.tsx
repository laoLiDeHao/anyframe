import { useEffect, useRef, useState, type ReactNode } from 'react'
import { registerPlugin } from '@capacitor/core'
import { QRCodeSVG } from 'qrcode.react'
import type { ServiceInfo, ServiceLogLine, ServicePackage } from '@anyframe/core'
import type { HostSession } from '../../host/types.ts'
import { AppShell, type ShellFrame } from '../AppShell.tsx'
import { Banner, Modal } from '../components.tsx'
import { lanUrls, localUrl, parsePort } from './service-links.ts'

const labels: Record<ServiceInfo['status'], string> = { starting: '启动中', running: '运行中', stopping: '停止中', stopped: '已停止', crashed: '启动失败' }
type Settings = { lan: boolean; port: string }
type Dialog = { kind: 'edit' | 'share'; name: string } | null
const isLive = (service?: ServiceInfo) => !!service && ['running', 'starting', 'stopping'].includes(service.status)

function Icon({ kind }: { kind: 'play' | 'stop' | 'edit' | 'share' | 'enter' | 'service' }) {
  const paths: Record<typeof kind, ReactNode> = {
    play: <path d="m8 5 11 7-11 7Z" />,
    stop: <rect x="6" y="6" width="12" height="12" rx="1" />,
    edit: <path d="m15 5 4 4M4 20l5-1L20 8a2.8 2.8 0 0 0-4-4L5 15Z" />,
    share: <><circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" /><path d="m9 10 6-3M9 14l6 3" /></>,
    enter: <path d="M14 4h6v6M20 4 10 14M10 4H4v16h16v-6" />,
    service: <><rect x="4" y="4" width="16" height="6" rx="2" /><rect x="4" y="14" width="16" height="6" rx="2" /><path d="M8 7h.01M8 17h.01" /></>,
  }
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[kind]}</svg>
}

export function ServicesPage({ frame, host }: { frame: ShellFrame; host: HostSession }) {
  const uploadRef = useRef<HTMLInputElement>(null)
  const [packages, setPackages] = useState<ServicePackage[]>([])
  const [importName, setImportName] = useState('')
  const [archive, setArchive] = useState<File | null>(null)
  const [importing, setImporting] = useState(false)
  const [services, setServices] = useState<ServiceInfo[]>([])
  const [logs, setLogs] = useState<ServiceLogLine[]>([])
  const [settings, setSettings] = useState<Record<string, Settings>>({})
  const [draft, setDraft] = useState<Settings>({ lan: false, port: '' })
  const [dialog, setDialog] = useState<Dialog>(null)
  const [shareUrl, setShareUrl] = useState('')
  const [copied, setCopied] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const client = host.client
  const settingsKey = `anyframe:service-settings:${host.kind}:${host.url ?? 'local'}`
  const supported = !!client && Array.isArray(host.caps.serviceTemplates)
  // A restart creates a new runtime ID; show one row per service, not its run history.
  const latest = new Map<string, ServiceInfo>()
  for (const service of services) latest.set(service.name, service)
  const names = [...new Set([...packages.map(p => p.id), ...latest.keys()])]
  const editable = (name: string) => packages.some(p => p.id === name)
  const titleOf = (name: string) => packages.find(p => p.id === name)?.name ?? name
  const current = dialog ? latest.get(dialog.name) : undefined
  const urls = current?.status === 'running' ? lanUrls(current) : []
  const selectedUrl = urls.includes(shareUrl) ? shareUrl : urls[0] ?? ''
  const close = () => { if (!busy) { setDialog(null); setError('') } }
  const config = (name: string): Settings => settings[name] ?? { lan: latest.get(name)?.host === '0.0.0.0', port: latest.get(name)?.port.toString() ?? '' }
  function edit(name: string) { setDraft(config(name)); setError(''); setDialog({ kind: 'edit', name }) }

  useEffect(() => {
    setServices([]); setPackages([]); setDialog(null); setError('')
    try {
      const saved: unknown = JSON.parse(localStorage.getItem(settingsKey) ?? '{}')
      const valid: Record<string, Settings> = {}
      if (saved && typeof saved === 'object') for (const [name, value] of Object.entries(saved)) {
        if (value && typeof value.lan === 'boolean' && typeof value.port === 'string') valid[name] = value
      }
      setSettings(valid)
    } catch { setSettings({}) }
  }, [client, settingsKey])

  useEffect(() => {
    if (!supported || !client) return
    let cancelled = false
    let running = false
    const update = async () => {
      if (running) return
      running = true
      try {
        const [result, catalog] = await Promise.all([client.call('service.list', undefined), client.call('service.catalog', undefined)])
        if (!cancelled) { setServices(result.services); setPackages(catalog.packages) }
      } catch (e) { if (!cancelled) setError(e instanceof Error ? e.message : String(e)) }
      finally { running = false }
    }
    void update()
    const timer = setInterval(() => void update(), 2000)
    return () => { cancelled = true; clearInterval(timer) }
  }, [client, supported])

  useEffect(() => {
    setLogs([])
    if (dialog?.kind !== 'edit' || !current || !client) return
    let cancelled = false
    const update = async () => {
      try {
        const result = await client.call('service.logs', { id: current.id, tail: 100 })
        if (!cancelled) setLogs(result.lines)
      } catch (e) { if (!cancelled) setError(e instanceof Error ? e.message : String(e)) }
    }
    void update()
    const timer = setInterval(() => void update(), 2000)
    return () => { cancelled = true; clearInterval(timer) }
  }, [client, dialog?.kind, current?.id])

  async function action(work: () => Promise<unknown>) {
    if (busy || !client) return
    setBusy(true); setError('')
    try { await work() }
    catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    finally {
      try { const [result, catalog] = await Promise.all([client.call('service.list', undefined), client.call('service.catalog', undefined)]); setServices(result.services); setPackages(catalog.packages) }
      catch (e) { setError(e instanceof Error ? e.message : String(e)) }
      setBusy(false)
    }
  }
  async function start(name: string, value: Settings) {
    const port = parsePort(value.port)
    await client!.call('service.start', { name, template: name, host: value.lan ? '0.0.0.0' : '127.0.0.1', port })
  }
  async function save() {
    if (!dialog) return
    parsePort(draft.port)
    const next = { ...settings, [dialog.name]: draft }
    localStorage.setItem(settingsKey, JSON.stringify(next))
    setSettings(next)
    if (isLive(current)) {
      await client!.call('service.stop', { id: current!.id })
      await start(dialog.name, draft)
    }
    setDialog(null)
  }

  return <AppShell {...frame} title="服务" subtitle="管理服务，快速访问与分享" actions={<button className="af-btn af-btn-primary" disabled={!supported || busy} onClick={() => { setImporting(true); setImportName(''); setArchive(null); setError('') }}>导入服务</button>}>
    {!supported && <Banner title="当前宿主未提供服务运行时">
      {host.kind === 'android' ? '内嵌 Node 尚未就绪，暂不能启动服务。' : '请连接新版本地助手，或使用桌面版启动服务。'}
      {host.warnings.map((warning, index) => <p key={index} style={{ overflowWrap: 'anywhere', whiteSpace: 'pre-wrap' }}>{warning}</p>)}
      {host.kind === 'android' && <>
        <button className="af-btn" onClick={() => window.location.reload()}>重新连接</button>
        <button className="af-btn" onClick={() => void registerPlugin<{ shareDiagnostics(): Promise<void> }>('AnyFrameLocalService').shareDiagnostics().catch(e => setError(String(e)))}>导出启动日志</button>
      </>}
    </Banner>}
    {error && !dialog && !importing && <p role="alert" className="af-service-error">{error}</p>}
    <section className="af-service-list" aria-label="服务列表">
      <div className="af-service-list-heading"><span>项目服务</span><span>{names.length} 个服务</span></div>
      {names.map(name => {
        const service = latest.get(name)
        const live = isLive(service)
        const transitioning = service?.status === 'starting' || service?.status === 'stopping'
        const canEdit = editable(name)
        const title = titleOf(name)
        const runLabel = live ? '停止' : '运行'
        return <div key={name} className="af-service-row">
          <span className="af-service-avatar"><Icon kind="service" /></span>
          <div className="af-service-info"><strong>{title}</strong><span className="af-service-description">{packages.find(p => p.id === name)?.source === 'builtin' ? '系统默认服务' : '自定义服务'}</span></div>
          <span className={`af-service-status ${service?.status ?? 'stopped'}`}><i />{service ? labels[service.status] : '未运行'}</span>
          <div className="af-service-actions">
            <button className="af-icon-btn" title={runLabel} aria-label={`${runLabel}${title}`} disabled={!supported || busy || transitioning || (!live && !canEdit)} onClick={() => void action(() => live ? client!.call('service.stop', { id: service!.id }) : start(name, config(name)))}><Icon kind={live ? 'stop' : 'play'} /></button>
            <button className="af-icon-btn" title="编辑" aria-label={`编辑${title}`} disabled={busy} onClick={() => edit(name)}><Icon kind="edit" /></button>
            <button className="af-icon-btn" title="分享" aria-label={`分享${title}`} disabled={busy} onClick={() => { setShareUrl(''); setCopied(false); setError(''); setDialog({ kind: 'share', name }) }}><Icon kind="share" /></button>
            {service?.status === 'running' ? <a className="af-btn af-btn-sm af-service-enter" href={localUrl(service)} target="_blank" rel="noreferrer"><Icon kind="enter" />进入</a> : <button className="af-btn af-btn-sm af-service-enter" disabled><Icon kind="enter" />进入</button>}
          </div>
        </div>
      })}
    </section>
    {names.length === 0 && <p className="af-muted">暂无服务，导入 ZIP 服务包开始使用。</p>}

    {importing && <Modal title="导入服务" desc="选择包含 index.js 和 wwwroot 的 ZIP 服务包，依赖需提前打包。" onClose={() => { if (!busy) { setImporting(false); setError('') } }} actions={<>
      <button className="af-btn af-btn-ghost" disabled={busy} onClick={() => { setImporting(false); setError('') }}>取消</button>
      <button className="af-btn af-btn-primary" disabled={busy || !archive || !importName} onClick={() => void action(async () => {
        if (!archive) return
        if (!/^[a-z0-9][a-z0-9-_]{0,63}$/.test(importName)) throw Error('服务名称只能包含小写字母、数字、连字符和下划线')
        if (archive.size > 20 * 1024 * 1024) throw Error('ZIP 文件需小于 20 MB')
        const data = new Uint8Array(await archive.arrayBuffer())
        let binary = ''
        for (let i = 0; i < data.length; i += 8192) binary += String.fromCharCode(...data.subarray(i, i + 8192))
        await client!.call('service.import', { name: importName, archive: btoa(binary) })
        setImporting(false)
      })}>{busy ? '导入中…' : '导入'}</button>
    </>}>
      {error && <p role="alert" className="af-service-error">{error}</p>}
      <div className="af-service-fields"><label>服务名称<input className="af-input" value={importName} maxLength={64} disabled={busy} placeholder="my-service" onChange={e => setImportName(e.target.value)} /></label>
      <input ref={uploadRef} type="file" accept=".zip,application/zip" disabled={busy} onChange={e => { const file = e.target.files?.[0] ?? null; setArchive(file); if (file && !importName) setImportName(file.name.replace(/\.zip$/i, '').toLowerCase().replace(/[^a-z0-9-_]/g, '-').slice(0, 64)) }} aria-label="ZIP 服务包" />
      <p className="af-muted-2">最大 20 MB。导入后可在列表中配置并运行。</p></div>
    </Modal>}

    {dialog?.kind === 'edit' && <Modal title="编辑服务" desc={titleOf(dialog.name)} onClose={close} actions={<>
      <button className="af-btn af-btn-ghost" disabled={busy} onClick={close}>取消</button>
      {editable(dialog.name) && <button className="af-btn af-btn-primary" disabled={!supported || busy || current?.status === 'starting' || current?.status === 'stopping'} onClick={() => void action(save)}>{busy ? '处理中…' : isLive(current) ? '保存并重启' : '保存'}</button>}
    </>}>
      {error && <p role="alert" className="af-service-error">{error}</p>}
      <div className="af-service-fields">
        <label>端口<input className="af-input" type="number" min="1024" max="65535" placeholder="自动选择" value={draft.port} disabled={busy || !editable(dialog.name)} onChange={e => setDraft({ ...draft, port: e.target.value })} /></label>
        <label className="af-service-switch"><input type="checkbox" checked={draft.lan} disabled={busy || !editable(dialog.name)} onChange={e => setDraft({ ...draft, lan: e.target.checked })} />允许局域网访问</label>
        <p className="af-muted-2">开启后，同一网络的设备可以访问笔记和加入聊天。{isLive(current) ? '保存设置会重启服务。' : '设置将在下次运行时生效。'}</p>
        {current && <div className="af-service-details"><span>运行状态</span><span>{labels[current.status]}</span><span>监听地址</span><code>{current.host}:{current.port}</code></div>}
        <details className="af-service-logs"><summary>运行日志</summary><pre aria-label="运行日志">{logs.map(line => new Date(line.ts).toLocaleTimeString() + ' ' + line.text).join('\n') || '暂无日志'}</pre></details>
      </div>
    </Modal>}

    {dialog?.kind === 'share' && <Modal title="分享服务" desc="同一局域网的用户可通过链接或扫码加入。" onClose={close} actions={<button className="af-btn" disabled={busy} onClick={close}>完成</button>}>
      {error && <p role="alert" className="af-service-error">{error}</p>}
      {selectedUrl ? <div className="af-service-share">
        <div className="af-service-qr"><QRCodeSVG value={selectedUrl} size={200} marginSize={4} level="M" title="扫描二维码访问服务" /></div>
        {urls.length > 1 && <label className="af-service-network">网络地址<select className="af-input" value={selectedUrl} onChange={e => { setShareUrl(e.target.value); setCopied(false) }}>{urls.map(url => <option key={url} value={url}>{url}</option>)}</select></label>}
        <div className="af-service-link"><input className="af-input" aria-label="分享链接" readOnly value={selectedUrl} onFocus={e => e.target.select()} /><button className="af-btn" onClick={() => {
          void (async () => {
            try { await navigator.clipboard.writeText(selectedUrl); setCopied(true); setError('') }
            catch { setError('自动复制不可用，请选中链接手动复制。') }
          })()
        }}>{copied ? '已复制' : '复制'}</button></div>
        <span role="status" className="af-muted-2">{copied ? '链接已复制，可发送给同一网络的用户。' : '请连接同一 Wi-Fi 或局域网后访问。'}</span>
      </div> : <div className="af-service-share-empty"><Icon kind="share" /><p>{current?.status !== 'running' ? '服务尚未运行' : current.host !== '0.0.0.0' ? '尚未开启局域网访问' : '暂未获取到局域网地址'}</p><p className="af-muted-2">{current?.status !== 'running' ? '先运行服务，再分享链接和二维码。' : current.host !== '0.0.0.0' ? '在编辑中开启局域网访问，保存并重启后即可分享。' : '请检查网络连接，连接 Wi-Fi 或有线网络后重试。'}</p>
        {editable(dialog.name) && <button className="af-btn af-btn-primary" disabled={!supported || busy || current?.status === 'starting' || current?.status === 'stopping'} onClick={() => {
          if (current?.status === 'running') { edit(dialog.name); setDraft({ ...config(dialog.name), lan: true }) }
          else void action(() => start(dialog.name, config(dialog.name)))
        }}>{current?.status === 'running' ? '编辑访问设置' : busy ? '启动中…' : '运行服务'}</button>}
      </div>}
    </Modal>}
  </AppShell>
}
