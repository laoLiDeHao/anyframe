import {
  BrowserWindow,
  Menu,
  Tray,
  app,
  ipcMain,
  nativeImage,
  shell,
  // nativeImage 是「类的构造函数」而不是类型，写 `let icon: nativeImage`
  // 会报 TS2749。类型要用 Electron 导出的 NativeImage。
  type NativeImage,
} from 'electron'
import { join } from 'node:path'
import { createServiceHost, type ServiceHost } from './service-host.ts'

/**
 * Electron 主进程入口。
 * 职责严格限定为：窗口生命周期、系统集成（托盘/单实例/自启）、服务宿主托管。
 * 业务逻辑一律在 @anyframe/core，不要写在这里。
 */

const isDev = !app.isPackaged
const DEV_RENDERER_URL = 'http://localhost:5173'

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let host: ServiceHost | null = null
let quitting = false

// ── 单实例锁 ──────────────────────────────────────────────────
// 本地服务与端口不能有两份，必须保证单实例。
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 960,
    minHeight: 600,
    show: false,
    backgroundColor: '#0f1115',
    // Linux 下必须与 electron-builder.yml 的 executableName 一致，
    // 否则 Ubuntu Dock 出现双图标
    ...(process.platform === 'linux' ? { name: 'anyframe' } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      // 安全三件套，不要为了省事关掉
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      // 前端不通过 file:// 直接读磁盘，全部走 RPC，所以可以关掉
      allowRunningInsecureContent: false,
      spellcheck: false,
    },
  })

  mainWindow.once('ready-to-show', () => mainWindow?.show())

  // 外部链接一律交给系统浏览器，绝不在应用内打开
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https:') || url.startsWith('http:')) {
      void shell.openExternal(url)
    }
    return { action: 'deny' }
  })

  if (isDev) {
    void mainWindow.loadURL(DEV_RENDERER_URL)
    mainWindow.webContents.openDevTools({ mode: 'detach' })
  } else {
    // base: './' 已在 vite.config.ts 中设置，这里用相对路径加载
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

// ── 系统托盘（仅桌面端具备，见 capabilities.systemTray）───────
function createTray(): void {
  // ⚠️ 路径不能写成 join(__dirname, '../../build/tray.ico')。
  //    build/ 是 buildResources，electron-builder **不会**把它打进 asar ——
  //    打包后 __dirname 在 app.asar/dist/main 里，../../build 指向 asar 内部，
  //    永远读不到，托盘就静默消失了（下面有 isEmpty 兜底，连报错都没有）。
  //    正确做法是 extraResources 把它拷到 <安装目录>/resources/，
  //    用 process.resourcesPath 定位；开发态才回落到仓库里的 build/。
  const name = process.platform === 'win32' ? 'tray.ico' : 'tray.png'
  const iconPath = app.isPackaged
    ? join(process.resourcesPath, name)
    : join(__dirname, '../../build', name)

  // 图标缺失时不崩溃，只跳过托盘 —— 但必须留痕，
  // 否则「打包版没有托盘」这种问题在现场根本无从查起。
  let icon: NativeImage
  try {
    icon = nativeImage.createFromPath(iconPath)
    if (icon.isEmpty()) {
      console.warn(`[main] 托盘图标为空，跳过托盘: ${iconPath}`)
      return
    }
  } catch (err) {
    console.warn(`[main] 托盘图标读取失败，跳过托盘: ${iconPath}`, err)
    return
  }

  tray = new Tray(icon)
  tray.setToolTip('AnyFrame')
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: '打开主界面',
        click: () => mainWindow?.show(),
      },
      {
        label: `本地服务: ${host?.handle.url ?? '未启动'}`,
        enabled: false,
      },
      { type: 'separator' },
      {
        label: '退出',
        click: () => {
          quitting = true
          app.quit()
        },
      },
    ]),
  )
  tray.on('click', () => mainWindow?.show())
}

// ── 生产环境去掉默认菜单（开发时保留以便调试）──────────────────
function setupMenu(): void {
  if (isDev) return
  if (process.platform === 'linux' || process.platform === 'win32') {
    Menu.setApplicationMenu(null)
  }
}

/**
 * IPC 只承担「bootstrap」与「必须走原生 API 的系统能力」。
 * 业务数据一律走本地 RPC 服务（HTTP），与 Web 版共用同一条路径。
 */
function registerIpc(): void {
  ipcMain.handle('anyframe:get-endpoint', () => {
    if (!host) throw new Error('服务宿主尚未就绪')
    return {
      url: host.handle.url,
      ...(host.handle.token ? { token: host.handle.token } : {}),
    }
  })

  ipcMain.handle('anyframe:set-autolaunch', (_e, enabled: boolean) => {
    // Windows 写注册表 Run 键，Linux 写 ~/.config/autostart/*.desktop，
    // Electron 的 setLoginItemSettings 两端都覆盖。
    app.setLoginItemSettings({
      openAtLogin: enabled,
      // Linux 下 Electron 通过 .desktop 文件实现，需给出可执行路径
      ...(process.platform === 'linux' ? { executableWillLaunchAtLogin: enabled } : {}),
    })
    return app.getLoginItemSettings().openAtLogin
  })

  ipcMain.handle('anyframe:get-autolaunch', () => app.getLoginItemSettings().openAtLogin)

  ipcMain.handle('anyframe:show-in-folder', (_e, path: string) => {
    shell.showItemInFolder(path)
  })

  ipcMain.on('anyframe:win-minimize', () => mainWindow?.minimize())
  ipcMain.on('anyframe:win-maximize', () => {
    if (!mainWindow) return
    mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize()
  })
  ipcMain.on('anyframe:win-close', () => mainWindow?.close())
}

app.whenReady().then(async () => {
  setupMenu()

  // 先起服务宿主，再开窗口：renderer 一加载就能连上 RPC
  host = await createServiceHost()
  registerIpc()

  createWindow()
  createTray()

  app.on('activate', () => {
    // macOS 惯例（本项目不发布 macOS 桌面版，但保留无害）
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// Windows / Linux：关闭所有窗口即退出
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// ── 优雅退出 ──────────────────────────────────────────────────
// 必须停掉所有子进程，否则用户退出应用后服务还在后台跑、端口被占。
app.on('before-quit', async (e) => {
  if (quitting || !host) return
  e.preventDefault()
  quitting = true
  try {
    await host.shutdown()
  } catch (err) {
    console.error('[main] 关闭服务宿主失败', err)
  } finally {
    app.exit(0)
  }
})

// 崩溃兜底：确保孤儿进程被回收
for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    void host?.shutdown().finally(() => process.exit(0))
  })
}

process.on('uncaughtException', (err) => {
  console.error('[main] uncaughtException', err)
})
process.on('unhandledRejection', (reason) => {
  console.error('[main] unhandledRejection', reason)
})
