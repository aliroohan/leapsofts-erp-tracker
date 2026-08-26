import { app, BrowserWindow, ipcMain, nativeImage, shell } from 'electron'
import { join } from 'node:path'
import { electronApp, is, optimizer } from '@electron-toolkit/utils'
import { IPC } from '@shared/ipc'
import {
  bootstrapSession,
  login,
  logout,
  startIdleMonitor,
  userCheckIn,
  userCheckOut,
  userEndBreak,
  userStartBreak,
  wirePowerAndNetwork
} from './idleMonitor'
import { prepareLinuxWindowTracking } from './linuxDesktop'
import { trackerState } from './trackerState'
import { createTray } from './tray'

let mainWindow: BrowserWindow | null = null
let quitting = false

const iconPath = app.isPackaged
  ? join(process.resourcesPath, 'icon.png')
  : join(__dirname, '../../build/icon.png')
const appIcon = nativeImage.createFromPath(iconPath)

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 400,
    height: 580,
    minWidth: 360,
    minHeight: 480,
    show: false,
    title: 'Leapsofts Time Tracker',
    icon: appIcon,
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      sandbox: false,
      contextIsolation: true
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })

  mainWindow.on('close', (event) => {
    if (quitting) return
    event.preventDefault()
    mainWindow?.hide()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    void shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    void mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function pushState(): void {
  const state = trackerState.get()
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(IPC.stateChanged, state)
  }
}

async function handle<T>(fn: () => Promise<T> | T): Promise<T> {
  try {
    return await fn()
  } catch (err) {
    throw new Error(err instanceof Error ? err.message : String(err))
  }
}

function registerIpc(): void {
  ipcMain.handle(IPC.getState, () => trackerState.get())
  ipcMain.handle(IPC.login, (_e, email: string, password: string) =>
    handle(() => login(email, password).then(() => trackerState.get()))
  )
  ipcMain.handle(IPC.logout, () => handle(() => logout().then(() => trackerState.get())))
  ipcMain.handle(IPC.checkIn, () => handle(() => userCheckIn().then(() => trackerState.get())))
  ipcMain.handle(IPC.checkOut, () => handle(() => userCheckOut().then(() => trackerState.get())))
  ipcMain.handle(IPC.startBreak, () => handle(() => userStartBreak().then(() => trackerState.get())))
  ipcMain.handle(IPC.endBreak, () => handle(() => userEndBreak().then(() => trackerState.get())))
}

app.whenReady().then(async () => {
  electronApp.setAppUserModelId('com.leapsofts.erp-tracker')

  if (process.platform === 'darwin') {
    app.dock?.setIcon(appIcon)
  }

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  registerIpc()
  trackerState.on('change', pushState)
  wirePowerAndNetwork()
  await prepareLinuxWindowTracking()
  createWindow()
  createTray(() => mainWindow)
  startIdleMonitor()
  await bootstrapSession()

  app.on('activate', () => {
    if (!mainWindow) createWindow()
    else mainWindow.show()
  })
})

app.on('before-quit', () => {
  quitting = true
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
