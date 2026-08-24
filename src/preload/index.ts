import { contextBridge, ipcRenderer } from 'electron'
import type { DesktopApi } from '@shared/desktopApi'
import { IPC } from '@shared/ipc'
import type { TrackerState } from '@shared/types'

const api: DesktopApi = {
  getState: () => ipcRenderer.invoke(IPC.getState),
  login: (email, password) => ipcRenderer.invoke(IPC.login, email, password),
  logout: () => ipcRenderer.invoke(IPC.logout),
  checkIn: () => ipcRenderer.invoke(IPC.checkIn),
  checkOut: () => ipcRenderer.invoke(IPC.checkOut),
  startBreak: () => ipcRenderer.invoke(IPC.startBreak),
  endBreak: () => ipcRenderer.invoke(IPC.endBreak),
  onState: (cb) => {
    const listener = (_event: unknown, state: TrackerState): void => cb(state)
    ipcRenderer.on(IPC.stateChanged, listener)
    return () => {
      ipcRenderer.removeListener(IPC.stateChanged, listener)
    }
  }
}

contextBridge.exposeInMainWorld('desktop', api)
