import { BrowserWindow, Menu, Tray, app, nativeImage } from 'electron'
import { join } from 'node:path'
import { trackerState } from './trackerState'

const TRAY_ICON_PATH = app.isPackaged
  ? join(process.resourcesPath, 'icon-tray.png')
  : join(__dirname, '../../build/icon-tray.png')

let tray: Tray | null = null

function formatElapsed(shiftCheckedIn: boolean, idleSeconds: number): string {
  if (!shiftCheckedIn) return 'Not checked in'
  const m = Math.floor(idleSeconds / 60)
  const s = idleSeconds % 60
  return `Idle ${m}:${String(s).padStart(2, '0')}`
}

export function createTray(getWindow: () => BrowserWindow | null): Tray {
  const image = nativeImage.createFromPath(TRAY_ICON_PATH)
  tray = new Tray(image.resize({ width: 16, height: 16 }))
  tray.setToolTip('Leapsofts Time Tracker')

  const show = (): void => {
    const win = getWindow()
    if (!win) return
    win.show()
    win.focus()
  }

  const rebuild = (): void => {
    const state = trackerState.get()
    const checkedIn = state.shift?.status === 'checked_in'
    const menu = Menu.buildFromTemplate([
      { label: 'Open tracker', click: show },
      { type: 'separator' },
      {
        label: state.user
          ? `${state.user.firstName ?? ''} ${state.user.lastName ?? ''}`.trim() || state.user.email
          : 'Signed out',
        enabled: false
      },
      { label: formatElapsed(Boolean(checkedIn), state.idleSeconds), enabled: false },
      { type: 'separator' },
      {
        label: 'Quit',
        click: () => {
          app.quit()
        }
      }
    ])
    tray?.setContextMenu(menu)
  }

  rebuild()
  trackerState.on('change', rebuild)
  tray.on('click', show)
  return tray
}
