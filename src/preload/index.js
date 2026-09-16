import { contextBridge, ipcRenderer } from 'electron'

// API tipizata, restransa la doar ce are nevoie UI-ul - nicio expunere directa
// de Node/Electron catre renderer (contextIsolation ramane intacta).
const api = {
  fisa: {
    saveDraft: (fisa) => ipcRenderer.invoke('fisa:saveDraft', fisa),
    loadDraft: (id) => ipcRenderer.invoke('fisa:loadDraft', id),
    listDrafts: () => ipcRenderer.invoke('fisa:listDrafts'),
    deleteDraft: (id) => ipcRenderer.invoke('fisa:deleteDraft', id),
    validate: (fisa) => ipcRenderer.invoke('fisa:validate', fisa),
    finalize: (fisa) => ipcRenderer.invoke('fisa:finalize', fisa),
    retryPdf: (payload) => ipcRenderer.invoke('fisa:retryPdf', payload)
  },
  fise: {
    openFolder: () => ipcRenderer.invoke('fise:openFolder'),
    getLocationInfo: () => ipcRenderer.invoke('fise:getLocationInfo')
  },
  backup: {
    now: () => ipcRenderer.invoke('backup:now')
  },
  app: {
    getVersion: () => ipcRenderer.invoke('app:getVersion'),
    checkForUpdates: () => ipcRenderer.invoke('app:checkForUpdates')
  }
}

try {
  contextBridge.exposeInMainWorld('serviceAuto', api)
} catch (err) {
  // Daca expunerea esueaza, aplicatia nu poate functiona - logam pe consola
  // preload-ului (vizibila in devtools), UI-ul va afisa ecranul de eroare globala.
  console.error('[preload] expunere API esuata', err)
}
