#!/usr/bin/env node
/**
 * 轻量分发方案：不内嵌 Node 运行时，产出「脚本 + 启动器」目录。
 *
 * 与 SEA 的取舍：
 *   SEA      → 用户零依赖，双击即用；体积 ~80MB（含 Node）
 *   portable → 体积小（<1MB）；但要求用户机器已装 Node 22+
 *
 * 目标用户是开发者、或企业内网统一下发过 Node 运行时的场景，
 * portable 更合适。CI 里两种都产出，安装页让用户自选。
 */
import { copyFileSync, mkdirSync, rmSync, writeFileSync, chmodSync, existsSync, statSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const appRoot = join(here, '..')
const bundle = join(appRoot, 'dist', 'agent.cjs')
const outDir = join(appRoot, 'release', 'portable')

const VERSION = process.env.ANYFRAME_AGENT_VERSION ?? '0.1.0'

if (!existsSync(bundle)) {
  console.error('✗ 先运行: pnpm --filter @anyframe/agent build')
  process.exit(1)
}

rmSync(outDir, { recursive: true, force: true })
mkdirSync(outDir, { recursive: true })

copyFileSync(bundle, join(outDir, 'agent.cjs'))

// ── Windows 启动器 ────────────────────────────────────────────
writeFileSync(
  join(outDir, 'anyframe-agent.cmd'),
  [
    '@echo off',
    'REM AnyFrame 本地助手 - Windows 启动器',
    'REM 要求本机已安装 Node.js 22 或更高版本',
    'setlocal',
    'where node >nul 2>nul',
    'if errorlevel 1 (',
    '  echo [错误] 未检测到 Node.js。请前往 https://nodejs.org 安装 22 LTS 或更高版本。',
    '  pause',
    '  exit /b 1',
    ')',
    'for /f "tokens=1 delims=." %%v in (\'node -p "process.versions.node.split(\'.\')[0]"\') do set NODE_MAJOR=%%v',
    'if %NODE_MAJOR% LSS 22 (',
    '  echo [错误] 需要 Node.js 22+，当前 %NODE_MAJOR%.x',
    '  pause',
    '  exit /b 1',
    ')',
    'node "%~dp0agent.cjs" %*',
    'endlocal',
    '',
  ].join('\r\n'),
)

// ── Linux / macOS 启动器 ──────────────────────────────────────
const sh = join(outDir, 'anyframe-agent')
writeFileSync(
  sh,
  [
    '#!/usr/bin/env bash',
    '# AnyFrame 本地助手 - Unix 启动器',
    '# 要求本机已安装 Node.js 22 或更高版本',
    'set -euo pipefail',
    '',
    'if ! command -v node >/dev/null 2>&1; then',
    '  echo "[错误] 未检测到 Node.js。Ubuntu/Debian: sudo apt install nodejs  (需 22+)" >&2',
    '  echo "       推荐用 nvm 安装: https://github.com/nvm-sh/nvm" >&2',
    '  exit 1',
    'fi',
    '',
    'NODE_MAJOR="$(node -p "process.versions.node.split(\'.\')[0]")"',
    'if [ "$NODE_MAJOR" -lt 22 ]; then',
    '  echo "[错误] 需要 Node.js 22+，当前 ${NODE_MAJOR}.x" >&2',
    '  exit 1',
    'fi',
    '',
    'exec node "$(dirname "$(readlink -f "$0")")/agent.cjs" "$@"',
    '',
  ].join('\n'),
)
chmodSync(sh, 0o755)

// ── 说明文件 ──────────────────────────────────────────────────
writeFileSync(
  join(outDir, 'README.txt'),
  `AnyFrame 本地助手 v${VERSION} (portable)
================================================

前置要求：本机已安装 Node.js 22 或更高版本。
         若希望免依赖，请改用 anyframe-agent 单文件版（SEA 构建）。

启动：
  Windows   双击 anyframe-agent.cmd
            或命令行: anyframe-agent.cmd --print-token
  Linux     ./anyframe-agent --print-token

常用参数：
  --port=47730            监听端口
  --allow-origin=https://your-app.example.com
                          允许连接的网页来源（**生产必须改成你的域名**）
  --data-root=/home/me    限制可读写目录
  --print-token           打印访问令牌

开机自启：
  Windows   anyframe-agent.cmd 安装后运行:
            node scripts/install-service.mjs --platform=win32
  Linux     systemd user unit:
            node scripts/install-service.mjs --platform=linux

卸载：直接删除本目录，并移除 ~/.anyframe/ 状态目录。
`,
)

const size = statSync(bundle).size / 1024
console.log(`✓ portable 产物: ${outDir}`)
console.log(`  agent.cjs (${size.toFixed(1)} KB) + 启动器 + README`)

// ── 打包成 zip ────────────────────────────────────────────────
// 不引第三方依赖：Windows 用 PowerShell，Unix 用 zip/tar
try {
  if (process.platform === 'win32') {
    execFileSync(
      'powershell.exe',
      [
        '-NoProfile', '-Command',
        `Compress-Archive -Path '${outDir}\\*' -DestinationPath '${join(appRoot, 'release', `anyframe-agent-${VERSION}-portable-win.zip`)}' -Force`,
      ],
      { stdio: 'inherit' },
    )
  } else if (process.platform === 'linux') {
    execFileSync('tar', ['-czf', join(appRoot, 'release', `anyframe-agent-${VERSION}-portable-linux.tar.gz`), '-C', join(appRoot, 'release'), 'portable'], { stdio: 'inherit' })
  } else {
    execFileSync('tar', ['-czf', join(appRoot, 'release', `anyframe-agent-${VERSION}-portable-darwin.tar.gz`), '-C', join(appRoot, 'release'), 'portable'], { stdio: 'inherit' })
  }
  console.log('✓ 已归档')
} catch (err) {
  console.warn(`⚠ 归档失败（不影响产物可用性）: ${err.message}`)
}
