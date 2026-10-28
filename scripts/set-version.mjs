#!/usr/bin/env node
/**
 * ─────────────────────────────────────────────────────────────
 * 版本号统一盖章
 * ─────────────────────────────────────────────────────────────
 * 为什么需要它：五个端的版本号来源各不相同 ——
 *   electron-builder 读 apps/desktop/package.json 的 version（${version}）
 *   Android          读 ANYFRAME_VERSION_NAME 环境变量，兜底 apps/mobile/package.json
 *   iOS              读 ANYFRAME_VERSION_NAME，兜底 apps/mobile/package.json
 *   Web / Agent      不关心版本，但 package.json 里躺着一个会误导人的旧值
 *
 * 只在 CI 里改一处，产物名和 Release 标题就会对不上，排查起来非常痛苦。
 * 这里一次性写进所有 package.json，保证五端一致。
 *
 * 用法：
 *   node scripts/set-version.mjs 1.4.0
 *   node scripts/set-version.mjs --from-git-tag              # 取 HEAD 上的 tag
 *   node scripts/set-version.mjs --from-ref refs/tags/v1.4.0 # CI 里用
 *   node scripts/set-version.mjs                             # 只打印，不修改
 *
 * 退出码：0 成功；1 版本号非法；2 找不到可用的 tag。
 */
import { spawnSync } from 'node:child_process'
import {
  appendFileSync,
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const log = (...a) => console.log('\x1b[32m[version]\x1b[0m', ...a)
const fail = (msg, code = 1) => {
  console.error('\x1b[31m[version]\x1b[0m', msg)
  process.exit(code)
}

// ── 版本号校验 ──────────────────────────────────────────────
// 故意比 semver 宽松一点：允许 1.2.3-beta.1+build.5。
// 但 Android 的 versionName 不能含空格，iOS 的 CFBundleShortVersionString
// 只认点分数字，所以带 build metadata 的写法在移动端会被截断，慎用。
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/

function assertVersion(v) {
  if (!SEMVER.test(v)) {
    fail(
      `版本号不合法：${JSON.stringify(v)}\n` +
        '  需要形如 1.4.0 / 1.4.0-beta.1 / 1.4.0-ci.42',
    )
  }
  return v
}

// ── 从 git 推导 ─────────────────────────────────────────────
function fromRef(ref) {
  const m = /^refs\/tags\/v?(.+)$/.exec(ref ?? '')
  if (!m) fail(`无法从 ref 推出版本：${ref}（期望 refs/tags/v1.2.3）`, 2)
  return m[1]
}

function fromGitTag() {
  // HEAD 上可能挂多个 tag，describe --abbrev=0 取最近可达的那个
  const r = spawnSync('git', ['describe', '--tags', '--abbrev=0', 'HEAD'], {
    cwd: ROOT,
    encoding: 'utf8',
  })
  const tag = (r.stdout ?? '').trim()
  if (r.status !== 0 || !tag) {
    fail(
      'HEAD 上没有 tag。发布前请先打 tag：\n' +
        '  git tag v1.4.0 && git push origin v1.4.0',
      2,
    )
  }
  return tag.replace(/^v/, '')
}

// ── 收集所有 workspace 包 ──────────────────────────────────
/**
 * pnpm-workspace.yaml 里的 glob 很简单（packages/* 与 apps/*），
 * 不值得为它引入 YAML 解析依赖 —— 构建脚本阶段依赖越少越好。
 * 用正则抓「- 'xxx/*'」的父目录，效果与 workspace 定义等价。
 */
function workspaceGroups() {
  const ws = join(ROOT, 'pnpm-workspace.yaml')
  const groups = []
  if (existsSync(ws)) {
    for (const line of readFileSync(ws, 'utf8').split('\n')) {
      const m = /^\s*-\s*['"]?([^'"\s]+?)['"]?\s*$/.exec(line)
      if (!m || !m[1].includes('*')) continue
      groups.push(m[1].replace(/\*+$/, ''))
    }
  }
  // 兜底：与仓库实际布局一致
  return groups.length ? groups : ['packages/', 'apps/']
}

function packagesToStamp() {
  const dirs = [ROOT]
  for (const g of workspaceGroups()) {
    const base = join(ROOT, g)
    if (!existsSync(base) || !statSync(base).isDirectory()) continue
    for (const name of readdirSync(base).sort()) {
      const d = join(base, name)
      if (!statSync(d).isDirectory()) continue
      if (existsSync(join(d, 'package.json'))) dirs.push(d)
    }
  }
  return dirs
}

/** Windows 下 relative() 返回反斜杠，CI 日志里两种平台混着看很别扭，统一成正斜杠 */
function rel(d) {
  return String(relative(ROOT, d) || '.').replaceAll(String.fromCharCode(92), '/')
}

// ── 主流程 ─────────────────────────────────────────────────
const argv = process.argv.slice(2)
let version = null

if (argv.includes('--from-git-tag')) {
  version = fromGitTag()
} else if (argv.includes('--from-ref')) {
  version = fromRef(argv[argv.indexOf('--from-ref') + 1])
} else if (argv[0] && !argv[0].startsWith('-')) {
  version = argv[0]
}

if (version === null) {
  const cur = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version
  log(`当前版本：${cur}（未指定新版本，不做修改）`)
  process.exit(0)
}

assertVersion(version)

let changed = 0
const dirs = packagesToStamp()
for (const d of dirs) {
  const file = join(d, 'package.json')
  const raw = readFileSync(file, 'utf8')
  const before = JSON.parse(raw).version

  if (before === version) {
    log(`${rel(d).padEnd(20)} 已是 ${version}`)
    continue
  }

  // 用字符串替换而不是 JSON.stringify 重写：
  // 后者会丢掉注释、重排字段顺序、改掉缩进，产生一大片无意义 diff。
  const next = raw.replace(/^(\s*"version"\s*:\s*)"[^"]*"/m, `$1"${version}"`)
  if (next === raw) {
    log(`${rel(d).padEnd(20)} 没有 version 字段，跳过`)
    continue
  }
  writeFileSync(file, next)
  changed++
  log(`${rel(d).padEnd(20)} ${before} → ${version}`)
}

log(`完成：${changed}/${dirs.length} 个 package.json 写入 ${version}`)

// CI 里把版本回传给后续 job（needs.<id>.outputs.version）
if (process.env.GITHUB_OUTPUT) {
  appendFileSync(process.env.GITHUB_OUTPUT, `version=${version}\n`)
}
