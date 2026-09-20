import path from 'path'

// Stub minimal al modulului "electron" pentru testele din Node. Caile vin din
// variabile de mediu setate per test (vezi tests/helpers.js).
export const app = {
  isPackaged: false,
  getPath: (name) => {
    if (name === 'userData') return process.env.SA_USERDATA
    return path.join(process.env.SA_USERDATA, name)
  },
  getAppPath: () => process.env.SA_APPPATH,
  getVersion: () => '0.0.0-test'
}
export const BrowserWindow = class {}
export const ipcMain = { handle() {}, on() {} }
export const shell = {}
export const dialog = {}
export default { app }
