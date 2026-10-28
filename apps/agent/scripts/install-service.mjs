#!/usr/bin/env node
/**
 * 注册本地助手的开机自启。
 *
 *   --platform=win32   写 HKCU\...\Run 注册表键（无需管理员权限）
 *   --platform=linux   写 ~/.config/systemd/user/anyframe-agent.service
 *   --uninstall        移除
 *
 * 说明：
 *   - Windows 不用 Task Scheduler 而用 Run 键，是因为 Run 键在用户登录时
 *     同步拉起、无额外权限要求，且用户能在「任务管理器 → 启动」里看到并自行关闭。
 *     企业环境若需要更严格的管控，改成 schtasks /create /sc onlogon。
 *   - Linux 用 systemd **user** unit 而非 system unit，避免要求 sudo，
 *     也符合桌面应用的惯例。需要用户执行 loginctl enable-linger 才能
 *     在未登录时也运行 —— 桌面场景不需要。
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const appRoot = resolve(join(here, '..'))

const argv = process.argv.slice(2)
const arg = (name) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : undefined
}
const uninstall = argv.includes('--uninstall')
const platform = arg('platform') ?? process.platform

// 定位实际的可执行入口：优先 SEA 单文件产物，回退到 portable 启动器
function resolveLauncher() {
  const explicit = arg('launcher')
  if (explicit) return resolve(explicit)

  const candidates =
    platform === 'win32'
      ? [join(appRoot, 'release', 'anyframe-agent.exe'), join(appRoot, 'release', 'portable', 'anyframe-agent.cmd')]
      : [join(appRoot, 'release', 'anyframe-agent'), join(appRoot, 'release', 'portable', 'anyframe-agent')]

  const hit = candidates.find(existsSync)
  if (!hit) {
    console.error(`✗ 找不到启动器。先构建：\n    pnpm --filter @anyframe/agent dist:sea\n  或\n    pnpm --filter @anyframe/agent dist:portable`)
    process.exit(1)
  }
  return hit
}

function run(cmd, args) {
  console.log(`$ ${cmd} ${args.join(' ')}`)
  execFileSync(cmd, args, { stdio: 'inherit' })
}

// ── Windows ───────────────────────────────────────────────────
function windows() {
  const key = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run'
  const name = 'AnyFrameAgent'

  if (uninstall) {
    run('reg', ['delete', key, '/v', name, '/f'])
    console.log('✓ 已移除开机自启')
    return
  }

  const launcher = resolveLauncher()
  // 端口与来源白名单在这里固化，用户后续可在注册表里改
  const port = arg('port') ?? '47730'
  const origins = arg('allow-origin') ?? 'https://app.anyframe.local'
  const value = `"${launcher}" --port=${port} --allow-origin=${origins}`

  run('reg', ['add', key, '/v', name, '/t', 'REG_SZ', '/d', value, '/f'])
  console.log(`✓ 已注册开机自启：${value}`)
  console.log('  用户可在「任务管理器 → 启动应用」中查看与禁用。')
}

// ── Linux ─────────────────────────────────────────────────────
function linux() {
  const unitDir = join(homedir(), '.config', 'systemd', 'user')
  const unitPath = join(unitDir, 'anyframe-agent.service')

  if (uninstall) {
    try { run('systemctl', ['--user', 'disable', '--now', 'anyframe-agent.service']) } catch { /* 未安装则忽略 */ }
    rmSync(unitPath, { force: true })
    run('systemctl', ['--user', 'daemon-reload'])
    console.log('✓ 已移除 systemd user unit')
    return
  }

  const launcher = resolveLauncher()
  const port = arg('port') ?? '47730'
  const origins = arg('allow-origin') ?? 'https://app.anyframe.local'
  const dataRoot = arg('data-root') ?? homedir()

  mkdirSync(unitDir, { recursive: true })

  const unit = `# AnyFrame 本地助手 —— systemd user unit
# 由 scripts/install-service.mjs 生成，手动修改后需重新 daemon-reload
[Unit]
Description=AnyFrame Local Agent
Documentation=https://github.com/your-org/anyframe
# 网络就绪后再启动，否则端口绑定可能失败
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=${launcher} --port=${port} --allow-origin=${origins} --data-root=${dataRoot}
Restart=on-failure
RestartSec=3
StartLimitIntervalSec=60
StartLimitBurst=5

# ── 沙箱加固 ──────────────────────────────────────────────
# Agent 能读写文件、启动进程，权限很大。用 systemd 的沙箱能力收窄：
PrivateTmp=yes
NoNewPrivileges=yes
ProtectSystem=strict
ProtectKernelTunables=yes
ProtectKernelModules=yes
ProtectControlGroups=yes
RestrictSUIDSGID=yes
LockPersonality=yes
# 显式放开需要写入的路径（用户数据 + Agent 状态目录）
ReadWritePaths=${dataRoot} %h/.anyframe
# 若本地服务需要访问硬件，按需放开：
# SupplementaryGroups=dialout plugdev

# 资源上限，防止失控的本地服务拖垮桌面
MemoryMax=1G
CPUQuota=200%
TasksMax=256

[Install]
WantedBy=default.target
`

  writeFileSync(unitPath, unit, 'utf8')
  console.log(`→ 写入 ${unitPath}`)

  run('systemctl', ['--user', 'daemon-reload'])
  run('systemctl', ['--user', 'enable', '--now', 'anyframe-agent.service'])

  console.log('✓ 已启用并启动')
  console.log('\n常用命令：')
  console.log('  systemctl --user status  anyframe-agent')
  console.log('  journalctl --user -u     anyframe-agent -f')
  console.log('  systemctl --user restart anyframe-agent')
  console.log('\n⚠ ProtectSystem=strict 会让 Agent 只能写 ReadWritePaths 列出的路径。')
  console.log('  如果本地服务需要写别处，把目录加进 ReadWritePaths 后 daemon-reload。')
}

switch (platform) {
  case 'win32':
    windows()
    break
  case 'linux':
    linux()
    break
  case 'darwin':
    console.error('✗ macOS 请用 launchd plist（本项目默认不发布 macOS 桌面端，未提供脚本）')
    process.exit(1)
    break
  default:
    console.error(`✗ 不支持的平台: ${platform}`)
    process.exit(1)
}
