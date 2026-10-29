/**
 * ─────────────────────────────────────────────────────────────
 * 全部样式：一份 CSS，五个端共用
 * ─────────────────────────────────────────────────────────────
 * 为什么带「注入 <style>」而不是一堆 inline style：
 *
 *   1. 响应式必须用媒体查询。inline style 写不了 @media，
 *      而这一版的核心诉求就是「一套界面适配桌面 / 平板 / 手机」。
 *   2. 断点只有一处真相。某个页面单独写 `width: 900px` 之类的判断，
 *      迟早和别的页面对不上。
 *   3. 体积更小：类名复用的样式不会随节点数线性膨胀。
 *
 * 前提：五端 index.html 的 CSP 都必须放行 style-src 'unsafe-inline'
 * （已全部放行，见各端 index.html 的注释）。
 */

const CSS = `
:root {
  --bg: #0f1115;
  --panel: #171a21;
  --panel-2: #1f232c;
  --line: #262b36;
  --line-2: #313846;
  --fg: #e6e8ec;
  --muted: rgba(230, 232, 236, .62);
  --muted-2: rgba(230, 232, 236, .45);
  --accent: #2563eb;
  --accent-soft: #1d3a6b;
  --danger: #f87171;
  --ok: #4ade80;
  --warn: #fbbf24;
  --radius: 12px;
  --sidebar: 248px;
  --tabbar: 58px;
}

html, body, #root { margin: 0; padding: 0; background: var(--bg); }
body { color: var(--fg); -webkit-font-smoothing: antialiased; }

.af-root {
  display: flex;
  min-height: 100vh;
  min-height: 100dvh;
  background: var(--bg);
  color: var(--fg);
  font-family: system-ui, -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
  font-size: 14px;
  line-height: 1.5;
}
.af-root *, .af-root *::before, .af-root *::after { box-sizing: border-box; }

.af-root :focus-visible { outline: 2px solid #4b8bf5; outline-offset: 2px; border-radius: 6px; }

/* ── 侧边栏（桌面）──────────────────────────────────────── */
.af-sidebar {
  width: var(--sidebar);
  flex: 0 0 var(--sidebar);
  position: sticky;
  top: 0;
  height: 100vh;
  height: 100dvh;
  padding: 14px 10px;
  border-right: 1px solid var(--line);
  background: #12151b;
  display: flex;
  flex-direction: column;
  gap: 4px;
  overflow: hidden;
}
.af-brand {
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding: 6px 10px 14px;
  font-size: 15px;
  font-weight: 650;
  letter-spacing: .2px;
}
.af-brand small { font-size: 11px; font-weight: 400; color: var(--muted-2); letter-spacing: 0; }
.af-side-label {
  padding: 14px 10px 6px;
  font-size: 11px;
  letter-spacing: .08em;
  text-transform: uppercase;
  color: var(--muted-2);
}
.af-side-list { display: flex; flex-direction: column; gap: 2px; overflow-y: auto; min-height: 0; }
.af-nav {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  min-height: 36px;
  padding: 6px 10px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--muted);
  font: inherit;
  font-size: 13.5px;
  text-align: left;
  cursor: pointer;
}
.af-nav:hover { background: #1b1f27; color: var(--fg); }
.af-nav.active { background: var(--accent-soft); color: #fff; }
.af-nav .af-nav-text { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.af-nav .af-nav-count { margin-left: auto; font-size: 11px; color: var(--muted-2); }
.af-nav.active .af-nav-count { color: #cfe0ff; }
.af-side-foot { margin-top: auto; padding-top: 10px; border-top: 1px solid var(--line); }

/* ── 主区 ───────────────────────────────────────────────── */
.af-main { flex: 1; min-width: 0; display: flex; flex-direction: column; }

.af-topbar {
  position: sticky;
  top: 0;
  z-index: 20;
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 56px;
  padding: 8px 16px;
  background: rgba(15, 17, 21, .88);
  backdrop-filter: blur(10px);
  border-bottom: 1px solid var(--line);
}
.af-title {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
}
.af-subtitle { font-size: 12px; color: var(--muted-2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.af-topbar-actions { display: flex; align-items: center; gap: 8px; margin-left: auto; flex-shrink: 0; }

.af-content {
  flex: 1;
  width: 100%;
  max-width: 1440px;
  margin: 0 auto;
  padding: 16px 16px 40px;
  position: relative;
}
.af-content-narrow { max-width: 760px; }

/* ── 底部 tab（手机）────────────────────────────────────── */
.af-tabbar {
  display: none;
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 30;
  height: calc(var(--tabbar) + env(safe-area-inset-bottom));
  padding-bottom: env(safe-area-inset-bottom);
  background: #12151b;
  border-top: 1px solid var(--line);
}
.af-tab {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 3px;
  border: 0;
  background: transparent;
  color: var(--muted-2);
  font: inherit;
  font-size: 11px;
  cursor: pointer;
  min-height: 44px;
}
.af-tab .af-tab-icon { font-size: 17px; line-height: 1; }
.af-tab.active { color: var(--fg); }
.af-tab:disabled { cursor: not-allowed; color: rgba(230,232,236,.22); }

/* ── 按钮 ───────────────────────────────────────────────── */
.af-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-height: 36px;
  padding: 0 13px;
  border-radius: 8px;
  border: 1px solid var(--line-2);
  background: var(--panel-2);
  color: var(--fg);
  font: inherit;
  font-size: 13.5px;
  white-space: nowrap;
  cursor: pointer;
  text-decoration: none;
}
.af-btn:hover:not(:disabled) { border-color: #47506a; background: #262c37; }
.af-btn:disabled { opacity: .42; cursor: not-allowed; }
.af-btn-primary { background: var(--accent); border-color: var(--accent); color: #fff; }
.af-btn-primary:hover:not(:disabled) { background: #1d4ed8; border-color: #1d4ed8; }
.af-btn-ghost { background: transparent; border-color: transparent; color: var(--muted); }
.af-btn-ghost:hover:not(:disabled) { background: #1b1f27; color: var(--fg); }
.af-btn-danger { background: transparent; border-color: #5c2326; color: var(--danger); }
.af-btn-danger:hover:not(:disabled) { background: #2a1416; }
.af-btn-sm { min-height: 30px; padding: 0 10px; font-size: 12.5px; }
.af-icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  padding: 0;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--muted);
  font-size: 16px;
  cursor: pointer;
}
.af-icon-btn:hover { background: #1b1f27; color: var(--fg); }

/* ── 表单 ───────────────────────────────────────────────── */
.af-input {
  width: 100%;
  min-height: 40px;
  padding: 8px 12px;
  border-radius: 8px;
  border: 1px solid var(--line-2);
  background: #0d0f14;
  color: var(--fg);
  font: inherit;
  font-size: 14px;
}
.af-input::placeholder { color: rgba(230,232,236,.3); }
.af-label { display: block; font-size: 12px; color: var(--muted-2); margin: 0 0 6px; }

/* ── 分组条 ─────────────────────────────────────────────── */
.af-chipbar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 2px 0 12px;
  overflow-x: auto;
  scrollbar-width: none;
  -webkit-overflow-scrolling: touch;
}
.af-chipbar::-webkit-scrollbar { display: none; }
.af-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex: 0 0 auto;
  min-height: 32px;
  padding: 0 12px;
  border-radius: 999px;
  border: 1px solid var(--line-2);
  background: var(--panel);
  color: var(--muted);
  font: inherit;
  font-size: 13px;
  cursor: pointer;
}
.af-chip:hover { color: var(--fg); border-color: #47506a; }
.af-chip.active { background: var(--accent-soft); border-color: #2b58a8; color: #fff; }
.af-chip .af-chip-count { font-size: 11px; opacity: .7; }
.af-chip-add { border-style: dashed; color: var(--muted-2); }

/* ── 素材网格 ───────────────────────────────────────────── */
.af-grid {
  display: grid;
  gap: 12px;
  grid-template-columns: repeat(auto-fill, minmax(168px, 1fr));
}
.af-tile {
  position: relative;
  display: flex;
  flex-direction: column;
  padding: 0;
  overflow: hidden;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--panel);
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.af-tile:hover { border-color: #3d4a63; }
.af-tile.selected { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent) inset; }
.af-thumb {
  position: relative;
  aspect-ratio: 1 / 1;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  background: #0b0d11;
}
.af-thumb img, .af-thumb video { width: 100%; height: 100%; object-fit: cover; display: block; }
.af-thumb .af-kind {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  font-size: 22px;
  color: rgba(255,255,255,.55);
}
.af-thumb .af-kind small { font-size: 10.5px; letter-spacing: .04em; }
.af-tile-meta { display: flex; flex-direction: column; gap: 1px; padding: 8px 10px 9px; }
.af-tile-name { font-size: 12.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.af-tile-sub { font-size: 11px; color: var(--muted-2); }
.af-check {
  position: absolute;
  top: 8px;
  right: 8px;
  width: 22px;
  height: 22px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  border: 1.5px solid rgba(255,255,255,.7);
  background: rgba(0,0,0,.35);
  color: transparent;
  font-size: 12px;
}
.af-check.on { background: var(--accent); border-color: var(--accent); color: #fff; }
.af-tile-badges {
  position: absolute;
  left: 8px;
  bottom: 8px;
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
  max-width: calc(100% - 16px);
}
.af-tile-badge {
  padding: 1px 6px;
  border-radius: 999px;
  background: rgba(0,0,0,.55);
  color: #dbe4f3;
  font-size: 10.5px;
  white-space: nowrap;
}

/* ── 项目列表 ───────────────────────────────────────────── */
.af-projects { display: grid; gap: 12px; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); }
.af-project {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 12px;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--panel);
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.af-project:hover { border-color: #3d4a63; background: #1a1e26; }
.af-project-cover {
  flex: 0 0 64px;
  width: 64px;
  height: 64px;
  border-radius: 10px;
  overflow: hidden;
  background: #0b0d11;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 22px;
  color: rgba(255,255,255,.4);
}
.af-project-cover img { width: 100%; height: 100%; object-fit: cover; display: block; }
.af-project-body { min-width: 0; display: flex; flex-direction: column; gap: 3px; }
.af-project-name { font-size: 14.5px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.af-project-meta { font-size: 12px; color: var(--muted-2); }

/* ── 通用块 ─────────────────────────────────────────────── */
.af-card { background: var(--panel); border: 1px solid var(--line); border-radius: var(--radius); padding: 14px; }
.af-section { margin-bottom: 22px; }
.af-section-title {
  margin: 0 0 10px;
  font-size: 11.5px;
  font-weight: 600;
  letter-spacing: .08em;
  text-transform: uppercase;
  color: var(--muted-2);
}
.af-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.af-spacer { flex: 1; }
.af-muted { color: var(--muted); }
.af-muted-2 { color: var(--muted-2); font-size: 12px; }
.af-banner {
  display: flex;
  gap: 10px;
  align-items: flex-start;
  padding: 11px 13px;
  margin-bottom: 14px;
  border-radius: 10px;
  font-size: 12.5px;
  line-height: 1.55;
  background: #2a2414;
  border: 1px solid #5c4f23;
  color: #f2d9a0;
}
.af-banner.info { background: #14212e; border-color: #234058; color: #bfd8ef; }
.af-banner.error { background: #2a1416; border-color: #5c2326; color: #f7bcbc; }
.af-banner strong { font-weight: 600; }

.af-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 56px 20px;
  border: 1px dashed var(--line-2);
  border-radius: var(--radius);
  text-align: center;
  color: var(--muted);
}
.af-empty-icon { font-size: 30px; opacity: .55; }
.af-empty-title { font-size: 14.5px; color: var(--fg); font-weight: 600; }
.af-empty-desc { font-size: 12.5px; max-width: 42ch; color: var(--muted-2); line-height: 1.6; }

/* ── 弹层 ───────────────────────────────────────────────── */
.af-overlay {
  position: fixed;
  inset: 0;
  z-index: 60;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  background: rgba(0,0,0,.62);
  backdrop-filter: blur(2px);
}
.af-modal {
  width: min(460px, 100%);
  max-height: 86vh;
  overflow: auto;
  padding: 18px;
  border-radius: 14px;
  border: 1px solid var(--line-2);
  background: #171a21;
  box-shadow: 0 20px 60px rgba(0,0,0,.5);
}
.af-modal-title { margin: 0 0 4px; font-size: 15px; font-weight: 650; }
.af-modal-desc { margin: 0 0 14px; font-size: 12.5px; color: var(--muted-2); line-height: 1.6; }
.af-modal-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px; }
.af-group-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-radius: 8px;
  border: 1px solid var(--line);
  background: var(--panel-2);
  margin-bottom: 8px;
  cursor: pointer;
}
.af-group-row:hover { border-color: #47506a; }
.af-group-row .af-group-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13.5px; }

/* ── 查看器 ─────────────────────────────────────────────── */
.af-viewer {
  position: fixed;
  inset: 0;
  z-index: 70;
  display: flex;
  flex-direction: column;
  /* 必须完全不透明：用 rgba(.97) 时下面一页的白色文字会透出来，
     看起来像没关干净的图层（截图里非常明显） */
  background: #06070a;
}
.af-viewer-head {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: calc(env(safe-area-inset-top) + 10px) 14px 10px;
  border-bottom: 1px solid rgba(255,255,255,.07);
}
.af-viewer-title { min-width: 0; display: flex; flex-direction: column; }
.af-viewer-name { font-size: 13.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.af-viewer-sub { font-size: 11.5px; color: var(--muted-2); }
.af-viewer-body {
  flex: 1;
  min-height: 0;
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 8px;
}
.af-viewer-body img, .af-viewer-body video { max-width: 100%; max-height: 100%; object-fit: contain; border-radius: 6px; }
.af-viewer-body audio { width: min(520px, 100%); }
.af-viewer-body .af-viewer-fallback {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding: 26px;
  color: var(--muted);
  text-align: center;
}
.af-nav-btn {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  width: 42px;
  height: 42px;
  border: 0;
  border-radius: 50%;
  background: rgba(255,255,255,.08);
  color: #fff;
  font-size: 18px;
  cursor: pointer;
}
.af-nav-btn:hover { background: rgba(255,255,255,.16); }
.af-nav-btn.prev { left: 10px; }
.af-nav-btn.next { right: 10px; }
.af-viewer-foot {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px calc(10px + env(safe-area-inset-bottom));
  border-top: 1px solid rgba(255,255,255,.07);
  overflow-x: auto;
}
.af-viewer-foot .af-chip { background: rgba(255,255,255,.06); border-color: rgba(255,255,255,.12); }

/* ── 批量操作条 ─────────────────────────────────────────── */
.af-batchbar {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 40;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px calc(10px + env(safe-area-inset-bottom));
  background: #141821;
  border-top: 1px solid var(--line-2);
  box-shadow: 0 -8px 24px rgba(0,0,0,.35);
}

/* ── 拖拽投放 ───────────────────────────────────────────── */
.af-drop {
  position: absolute;
  inset: 8px;
  z-index: 35;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  border: 2px dashed #3b82f6;
  border-radius: 14px;
  background: rgba(11,18,32,.94);
  color: #dbeafe;
  font-size: 15px;
  pointer-events: none;
}

/* ── toast ──────────────────────────────────────────────── */
.af-toast {
  position: fixed;
  left: 50%;
  bottom: calc(24px + env(safe-area-inset-bottom));
  transform: translateX(-50%);
  z-index: 90;
  max-width: min(560px, calc(100% - 32px));
  padding: 10px 16px;
  border-radius: 10px;
  background: #232a36;
  border: 1px solid #33405a;
  color: #e8edf7;
  font-size: 13px;
  line-height: 1.5;
  box-shadow: 0 10px 30px rgba(0,0,0,.45);
}
.af-toast.error { background: #2a1416; border-color: #5c2326; color: #f7bcbc; }
.af-toast.ok { background: #12261a; border-color: #1f5132; color: #b8f0c9; }

/* ── 设置页 ─────────────────────────────────────────────── */
.af-kv { display: grid; grid-template-columns: 108px 1fr; gap: 6px 12px; margin: 0; font-size: 13px; }
.af-kv dt { color: var(--muted-2); }
.af-kv dd { margin: 0; word-break: break-all; }
.af-feature {
  display: flex;
  align-items: baseline;
  gap: 10px;
  padding: 7px 0;
  border-bottom: 1px solid var(--line);
  font-size: 13px;
}
.af-feature:last-child { border-bottom: 0; }
.af-badge {
  flex: 0 0 auto;
  padding: 1px 7px;
  border-radius: 4px;
  font-size: 11px;
  line-height: 1.6;
}
.af-badge.on { background: #12351f; color: var(--ok); }
.af-badge.off { background: #3a1d1d; color: var(--danger); }

/* ── 首页驾驶舱 ─────────────────────────────────────────── */
.af-hero {
  position: relative;
  overflow: hidden;
  margin-bottom: 18px;
  padding: 40px 36px 32px;
  border: 1px solid #22304a;
  border-radius: 20px;
  background:
    radial-gradient(900px 420px at 88% -10%, rgba(37, 99, 235, .35), transparent 62%),
    radial-gradient(720px 380px at 6% 112%, rgba(13, 148, 136, .26), transparent 62%),
    linear-gradient(160deg, #141b2b 0%, #10141d 55%, #0d1017 100%);
}
/* 细网格纹理：高端感来自「有结构但不抢眼」，纯渐变容易看起来像一张壁纸 */
.af-hero::before {
  content: '';
  position: absolute;
  inset: 0;
  background-image:
    linear-gradient(rgba(255, 255, 255, .035) 1px, transparent 1px),
    linear-gradient(90deg, rgba(255, 255, 255, .035) 1px, transparent 1px);
  background-size: 46px 46px;
  -webkit-mask-image: radial-gradient(760px 400px at 26% 8%, #000 25%, transparent 78%);
  mask-image: radial-gradient(760px 400px at 26% 8%, #000 25%, transparent 78%);
  pointer-events: none;
}
.af-hero > * { position: relative; }

.af-hero-badge {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  margin-bottom: 18px;
  padding: 4px 12px;
  border: 1px solid rgba(147, 197, 253, .26);
  border-radius: 999px;
  background: rgba(37, 99, 235, .13);
  color: #bfdbfe;
  font-size: 12px;
  letter-spacing: .02em;
}
.af-hero-badge i {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #34d399;
  box-shadow: 0 0 10px #34d399;
}

.af-hero-title {
  margin: 0;
  font-size: clamp(30px, 4.2vw, 50px);
  font-weight: 750;
  line-height: 1.1;
  letter-spacing: -.025em;
}
.af-hero-title span {
  background: linear-gradient(92deg, #60a5fa, #34d399 52%, #a78bfa);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}
.af-hero-sub {
  margin: 16px 0 0;
  max-width: 56ch;
  color: var(--muted);
  font-size: 14.5px;
  line-height: 1.78;
}
.af-hero-actions { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 24px; }
.af-btn-lg { min-height: 46px; padding: 0 20px; border-radius: 10px; font-size: 14.5px; }

.af-hero-stats {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;
  margin-top: 30px;
}

/* 「五个端」的实体化：只在足够宽的窗口出现，避免压到正文 */
.af-hero-ends { display: none; }
.af-only-compact { display: none; }

@media (min-width: 1160px) {
  .af-hero-ends {
    position: absolute;
    top: 50%;
    right: 34px;
    transform: translateY(-50%);
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 8px;
    pointer-events: none;
  }
  .af-end-chip {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 5px 12px;
    border: 1px solid rgba(148, 163, 184, .18);
    border-radius: 999px;
    background: rgba(255, 255, 255, .035);
    color: #cbd5e1;
    font-size: 12px;
    letter-spacing: .02em;
  }
  .af-end-chip i {
    width: 5px;
    height: 5px;
    border-radius: 50%;
    background: #60a5fa;
    box-shadow: 0 0 8px #60a5fa;
  }
  .af-end-chip:nth-child(5) i { background: #a78bfa; box-shadow: 0 0 8px #a78bfa; }
}
.af-stat {
  padding: 12px 14px;
  border: 1px solid rgba(255, 255, 255, .07);
  border-radius: 12px;
  background: rgba(255, 255, 255, .03);
}
.af-stat-value { font-size: 21px; font-weight: 700; letter-spacing: -.01em; }
.af-stat-label { margin-top: 2px; color: var(--muted-2); font-size: 11.5px; }

/* 特性卡片 / 流程 */
.af-cards {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: 12px;
  margin-bottom: 18px;
}
.af-feature-card {
  padding: 16px;
  border: 1px solid var(--line);
  border-radius: 14px;
  background: linear-gradient(180deg, #171b24, #141821);
}
.af-feature-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  border: 1px solid rgba(96, 165, 250, .22);
  border-radius: 10px;
  background: rgba(37, 99, 235, .14);
  color: #93c5fd;
  font-size: 15px;
}
.af-feature-card h3 { margin: 11px 0 6px; font-size: 14.5px; font-weight: 650; }
.af-feature-card p { margin: 0; color: var(--muted-2); font-size: 12.5px; line-height: 1.72; }

.af-steps {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
  gap: 12px;
  margin-bottom: 18px;
}
.af-step {
  padding: 15px 16px;
  border: 1px dashed var(--line-2);
  border-radius: 12px;
}
.af-step-num { color: #93c5fd; font-size: 11px; letter-spacing: .14em; }
.af-step h3 { margin: 6px 0 5px; font-size: 14px; }
.af-step p { margin: 0; color: var(--muted-2); font-size: 12.5px; line-height: 1.7; }

/* ── 设备页 ─────────────────────────────────────────────── */
.af-device-head {
  display: flex;
  align-items: center;
  gap: 14px;
  margin-bottom: 14px;
  padding: 18px;
  border: 1px solid var(--line);
  border-radius: 16px;
  background: linear-gradient(120deg, #16202f, #141821 62%);
}
.af-device-orb {
  flex: 0 0 44px;
  width: 44px;
  height: 44px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  font-size: 17px;
}
.af-device-orb.ok {
  background: radial-gradient(circle at 32% 28%, #34d399, #065f46);
  box-shadow: 0 0 26px rgba(52, 211, 153, .32);
}
.af-device-orb.off {
  background: radial-gradient(circle at 32% 28%, #fbbf24, #92400e);
  box-shadow: 0 0 26px rgba(251, 191, 36, .28);
}
.af-device-name { font-size: 17px; font-weight: 650; letter-spacing: -.01em; }
.af-device-sub { margin-top: 2px; color: var(--muted-2); font-size: 12px; }
.af-pill {
  margin-left: auto;
  padding: 5px 12px;
  border-radius: 999px;
  font-size: 12px;
  white-space: nowrap;
}
.af-pill.ok { border: 1px solid rgba(34, 197, 94, .26); background: rgba(34, 197, 94, .12); color: var(--ok); }
.af-pill.off { border: 1px solid rgba(251, 191, 36, .26); background: rgba(251, 191, 36, .1); color: var(--warn); }

.af-device-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
  gap: 14px;
  align-items: start;
}
.af-cap-row {
  display: grid;
  grid-template-columns: 62px 1fr;
  gap: 10px;
  padding: 10px 0;
  border-bottom: 1px solid var(--line);
}
.af-cap-row:last-child { border-bottom: 0; }
.af-cap-name { font-size: 13px; }
.af-cap-note { margin-top: 2px; color: var(--muted-2); font-size: 12px; line-height: 1.62; }

/* ── 断点 ───────────────────────────────────────────────── */
@media (min-width: 900px) {
  .af-tabbar { display: none !important; }
  .af-batchbar { left: var(--sidebar); }
}
@media (max-width: 899px) {
  .af-sidebar { display: none; }
  .af-tabbar { display: flex; }
  .af-content { padding: 12px 12px calc(var(--tabbar) + 34px + env(safe-area-inset-bottom)); max-width: 100%; }
  .af-topbar { padding: 8px 12px; }
  /* 刘海屏 / 挖孔屏：不做这层内边距，标题会被状态栏压住 */
  .af-topbar { padding-top: calc(8px + env(safe-area-inset-top)); }
  /* 手机上顶部只留标题与动作：副标题（素材数 / 更新于）在密度极高的
     小屏上会把标题挤掉，而同样的数字在分组条上已经有了 */
  .af-subtitle { display: none; }
  .af-back-text { display: none; }
  .af-btn { min-height: 44px; }
  .af-btn-sm { min-height: 36px; }
  .af-icon-btn { width: 40px; height: 40px; }
  .af-chip { min-height: 36px; }
  .af-grid { grid-template-columns: repeat(auto-fill, minmax(132px, 1fr)); gap: 10px; }
  .af-projects { grid-template-columns: 1fr; }
  .af-batchbar { bottom: calc(var(--tabbar) + env(safe-area-inset-bottom)); }
  .af-kv { grid-template-columns: 92px 1fr; }
  .af-modal { width: 100%; max-height: 88vh; }
  .af-overlay { align-items: flex-end; padding: 0; }
  .af-overlay .af-modal { border-radius: 16px 16px 0 0; padding-bottom: calc(18px + env(safe-area-inset-bottom)); }
  .af-toast { bottom: calc(var(--tabbar) + 18px + env(safe-area-inset-bottom)); }
}
@media (max-width: 420px) {
  .af-grid { grid-template-columns: repeat(auto-fill, minmax(104px, 1fr)); gap: 8px; }
  .af-tile-meta { padding: 6px 8px 7px; }
  .af-tile-name { font-size: 11.5px; }
  .af-project-cover { flex-basis: 56px; width: 56px; height: 56px; }
}
@media (min-width: 1400px) {
  .af-grid { grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); }
}

/* 首页 / 设备页在窄屏上的收窄规则单独放一段：
   这两个页面是后加的，放在主断点里会让那段越来越难读 */
@media (max-width: 899px) {
  .af-hero { padding: 26px 18px 22px; border-radius: 16px; }
  .af-hero-title { font-size: clamp(27px, 8.4vw, 34px); }
  /* 手机上把「界面不变形，能力不撒谎」拆成两行，避免在「不」后面断字 */
  .af-only-compact { display: inline; }
  .af-hero-sub { font-size: 13.5px; }
  .af-hero-actions .af-btn { flex: 1 1 auto; }
  .af-btn-lg { min-height: 44px; }
  .af-hero-stats { grid-template-columns: repeat(2, minmax(0, 1fr)); margin-top: 22px; }
  .af-stat { padding: 10px 12px; }
  .af-stat-value { font-size: 18px; }
  .af-cards, .af-steps { grid-template-columns: 1fr; }
  .af-device-head { flex-wrap: wrap; align-items: flex-start; }
  .af-pill { margin-left: 0; }
  .af-device-grid { grid-template-columns: 1fr; }
}
`

let installed = false

/** 幂等注入。模块被多个入口 import 也只会插一次 <style>。 */
export function ensureAppStyles(): void {
  if (installed || typeof document === 'undefined') return
  installed = true
  const style = document.createElement('style')
  style.dataset.anyframe = 'app'
  style.textContent = CSS
  document.head.appendChild(style)
}
