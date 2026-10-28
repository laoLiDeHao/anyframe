# 桌面端构建资源

electron-builder 的 `buildResources` 指向本目录，这里的文件不会被打进 asar，
而是在打包阶段被读取。

## 图标清单

仓库里已经有一套**占位图标**，由 `pnpm gen:icons`（`scripts/gen-icons.mjs`，
零依赖，纯 Node 手写 PNG/ICO/BMP 编码）生成。正式发布前替换成品牌图标即可，
文件名与尺寸保持不变就不用改任何配置。

| 文件 | 用途 | 规格要求 |
|---|---|---|
| `icon.ico` | Windows 安装包 + 可执行文件 | 多尺寸合一：16 / 24 / 32 / 48 / 64 / 128 / 256 px，32 位含 Alpha |
| `icons/` 目录 | Linux deb / rpm / AppImage | `16x16.png` `24x24.png` `32x32.png` `48x48.png` `64x64.png` `128x128.png` `256x256.png` `512x512.png`，文件名必须严格是这个格式 |
| `tray.ico` | Windows 托盘图标 | 16 / 24 / 32 px。建议单色以便适配深色任务栏 |
| `tray.png` | Linux 托盘图标 | 32×32 单文件。GNOME 槽位 22px、KDE 24px，交给面板缩放；直接给 22 在 HiDPI 下会糊 |
| `installer-sidebar.bmp` | NSIS 向导侧边图 | 164 × 314 px，24 位 BMP，**不能是 PNG** |

⚠️ **缺文件会构建失败，不是「回退到默认图标」。**
`win.icon` / `nsis.installerIcon` / `linux.icon` 都是显式指定的资源，
electron-builder 找不到就直接报错退出：

```
⨯ cannot find specified resource "build/icon.ico"
```

只有 `electron-builder --dir`（不产出安装包）才容忍缺失 —— 它会打印
`default Electron icon is used` 然后继续。所以**本地 `--dir` 跑通
完全不能证明 CI 的 `dist:win` / `dist:linux` 能跑通**，改图标相关配置后
务必跑一次真打包。

同理，`tray.ico` / `tray.png` 不在 asar 里（build/ 是 buildResources，
只读不打包），靠 `electron-builder.yml` 的 `extraResources` 拷到
`<安装目录>/resources/`，主进程用 `process.resourcesPath` 定位。

## 重新生成图标

占位图标由仓库自带脚本生成，不需要任何系统依赖：

```bash
pnpm gen:icons        # = node scripts/gen-icons.mjs
```

脚本先渲染一张 2048×2048 的超采样源图（SDF + 覆盖率抗锯齿），
再面积平均缩放到各档尺寸，最后手写编码成 ICO / PNG / BMP。
`build/icons/` 会先整体清空再写入，避免残留旧尺寸。

换成品牌图标有两条路：

1. **改脚本**：把 `scripts/gen-icons.mjs` 的 `renderBadge()` 换成读取你的
   1024×1024 源图（RGBA），缩放与编码逻辑原样复用。推荐，可重复执行。
2. **用外部工具**一次性产出同名文件：

```bash
# 生成 Linux 全套 png
pnpm dlx icon-gen --type ico --modes all src-1024.png build/icon.ico
pnpm dlx electron-icon-builder --input=src-1024.png --output=build --flatten

# 或者 ImageMagick
magick src-1024.png -define icon:auto-resize=256,128,64,48,32,24,16 build/icon.ico
mkdir -p build/icons
for s in 16 24 32 48 64 128 256 512; do
  magick src-1024.png -resize ${s}x${s} build/icons/${s}x${s}.png
done
```

## Ubuntu Dock 双图标问题

`electron-builder.yml` 里的 `linux.executableName: anyframe` 与
`desktop.StartupWMClass: anyframe` 必须完全一致，且主进程创建窗口时
传入的 `name` 也要是 `anyframe`（见 `src/main/index.ts`）。
三者任一不匹配，GNOME Dock 上固定的图标和运行中的图标就会分裂成两个。

## 可选：外部服务二进制

如果「启动本地服务」需要拉起第三方程序（Python/Go 编译产物、ffmpeg 等），
按平台放在：

```
build/bin/win32/x64/your-service.exe
build/bin/linux/x64/your-service
build/bin/linux/arm64/your-service
```

然后取消 `electron-builder.yml` 中 `extraResources` 的注释。
运行时通过 `process.resourcesPath` 定位：

```ts
const bin = join(process.resourcesPath, 'bin', 'your-service' + (process.platform === 'win32' ? '.exe' : ''))
```

⚠️ **AppImage 陷阱**：AppImage 挂载点可能带 `noexec`，
不要把自己解压到 `/tmp` 后执行；`process.resourcesPath` 指向的是
挂载后的只读镜像内部，直接 exec 通常可行，但若报 `Permission denied`，
需先拷贝到 `$HOME/.local/share/anyframe/bin/` 并 `chmod +x`。
