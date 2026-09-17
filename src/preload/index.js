import { contextBridge, ipcRenderer } from 'electron'

// API tipizata, restransa la doar ce are nevoie UI-ul - nicio expunere directa
// de Node/Electron catre renderer (contextIsolation ramane intacta).
const api = {
  license: {
    getStatus: () => ipcRenderer.invoke('license:getStatus'),
    activate: (key) => ipcRenderer.invoke('license:activate', key),
    onRevoked: (callback) => {
      const listener = () => callback()
      ipcRenderer.on('license:revoked', listener)
      return () => ipcRenderer.removeListener('license:revoked', listener)
    }
  },
  fisa: {
    saveDraft: (fisa) => ipcRenderer.invoke('fisa:saveDraft', fisa),
    loadDraft: (id) => ipcRenderer.invoke('fisa:loadDraft', id),
    listDrafts: () => ipcRenderer.invoke('fisa:listDrafts'),
    deleteDraft: (id) => ipcRenderer.invoke('fisa:deleteDraft', id),
    validate: (fisa) => ipcRenderer.invoke('fisa:validate', fisa),
    finalize: (fisa) => ipcRenderer.invoke('fisa:finalize', fisa),
    retryPdf: (payload) => ipcRenderer.invoke('fisa:retryPdf', payload),
    search: (query) => ipcRenderer.invoke('fisa:search', query),
    listRecent: (limit) => ipcRenderer.invoke('fisa:listRecent', limit),
    getAutocompleteData: () => ipcRenderer.invoke('fisa:getAutocompleteData'),
    getVehicleHistory: (nrInmatriculare) => ipcRenderer.invoke('fisa:getVehicleHistory', nrInmatriculare),
    getRapoarte: (period) => ipcRenderer.invoke('fisa:getRapoarte', period)
  },
  fise: {
    openFolder: () => ipcRenderer.invoke('fise:openFolder'),
    openPdf: (fileName) => ipcRenderer.invoke('fise:openPdf', fileName),
    printPdf: (fileName) => ipcRenderer.invoke('fise:printPdf', fileName),
    getLocationInfo: () => ipcRenderer.invoke('fise:getLocationInfo')
  },
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    save: (settings) => ipcRenderer.invoke('settings:save', settings),
    getDataPathInfo: () => ipcRenderer.invoke('settings:getDataPathInfo'),
    pickDataFolder: () => ipcRenderer.invoke('settings:pickDataFolder'),
    changeDataPath: (newPath) => ipcRenderer.invoke('settings:changeDataPath', newPath)
  },
  backup: {
    now: () => ipcRenderer.invoke('backup:now')
  },
  app: {
    getVersion: () => ipcRenderer.invoke('app:getVersion'),
    exportLogs: () => ipcRenderer.invoke('app:exportLogs'),
    checkForUpdates: () => ipcRenderer.invoke('app:checkForUpdates'),
    downloadUpdate: () => ipcRenderer.invoke('app:downloadUpdate'),
    installUpdate: () => ipcRenderer.invoke('app:installUpdate'),
    onUpdateEvent: (callback) => {
      const listener = (_e, payload) => callback(payload)
      ipcRenderer.on('update:event', listener)
      return () => ipcRenderer.removeListener('update:event', listener)
    }
  }
}

try {
  contextBridge.exposeInMainWorld('serviceAuto', api)
} catch (err) {
  // Daca expunerea esueaza, aplicatia nu poate functiona - logam pe consola
  // preload-ului (vizibila in devtools), UI-ul va afisa ecranul de eroare globala.
  console.error('[preload] expunere API esuata', err)
}
