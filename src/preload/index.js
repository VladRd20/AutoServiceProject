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
    finalize: (fisa) => ipcRenderer.invoke('fisa:finalize', fisa),
    retryPdf: (payload) => ipcRenderer.invoke('fisa:retryPdf', payload),
    deleteFinalizata: (fileName) => ipcRenderer.invoke('fisa:deleteFinalizata', fileName),
    search: (query, range) => ipcRenderer.invoke('fisa:search', query, range),
    listRecent: (limit) => ipcRenderer.invoke('fisa:listRecent', limit),
    getAutocompleteData: () => ipcRenderer.invoke('fisa:getAutocompleteData'),
    getVehicleHistory: (vin, nrInmatriculare) =>
      ipcRenderer.invoke('fisa:getVehicleHistory', vin, nrInmatriculare),
    getRapoarte: (period, range) => ipcRenderer.invoke('fisa:getRapoarte', period, range),
    exportCsv: (period, range) => ipcRenderer.invoke('fisa:exportCsv', period, range)
  },
  trash: {
    list: () => ipcRenderer.invoke('trash:list'),
    restore: (trashId) => ipcRenderer.invoke('trash:restore', trashId)
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
    now: () => ipcRenderer.invoke('backup:now'),
    status: () => ipcRenderer.invoke('backup:status'),
    export: () => ipcRenderer.invoke('backup:export'),
    // source: 'dialog' | 'latest'
    import: (source) => ipcRenderer.invoke('backup:import', source)
  },
  app: {
    getWhatsNew: (mode) => ipcRenderer.invoke('app:getWhatsNew', mode),
    markWhatsNewSeen: () => ipcRenderer.invoke('app:markWhatsNewSeen'),
    getVersion: () => ipcRenderer.invoke('app:getVersion'),
    exportLogs: () => ipcRenderer.invoke('app:exportLogs'),
    setTitleBarColors: (colors) => ipcRenderer.invoke('app:setTitleBarColors', colors),
    getAutoUpdate: () => ipcRenderer.invoke('app:getAutoUpdate'),
    setAutoUpdate: (enabled) => ipcRenderer.invoke('app:setAutoUpdate', enabled),
    checkForUpdates: () => ipcRenderer.invoke('app:checkForUpdates'),
    downloadUpdate: () => ipcRenderer.invoke('app:downloadUpdate'),
    installUpdate: () => ipcRenderer.invoke('app:installUpdate'),
    onUpdateEvent: (callback) => {
      const listener = (_e, payload) => callback(payload)
      ipcRenderer.on('update:event', listener)
      return () => ipcRenderer.removeListener('update:event', listener)
    },
    // Main cere salvarea imediata a draftului (inchidere fereastra / instalare
    // update); renderer-ul confirma cu flushDone(id) dupa ce a terminat.
    onFlushRequest: (callback) => {
      const listener = (_e, id) => callback(id)
      ipcRenderer.on('app:flush', listener)
      return () => ipcRenderer.removeListener('app:flush', listener)
    },
    flushDone: (id) => ipcRenderer.send('app:flushDone', id),
    onFatalError: (callback) => {
      const listener = (_e, payload) => callback(payload)
      ipcRenderer.on('app:fatalError', listener)
      return () => ipcRenderer.removeListener('app:fatalError', listener)
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
