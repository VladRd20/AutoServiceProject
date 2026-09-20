// Fatada peste modulele din store/ - pastreaza vechea suprafata de import
// (ipc.js, pdfGenerator.js, index.js) neschimbata.
export {
  ensureDirs,
  changeDataPath,
  getDefaultDataPath,
  getCurrentDataPath,
  getFiseDir,
  getDraftsDir,
  getBackupDir,
  getSafetyBackupDir,
  isUsingFallbackLocation,
  isMigratedFromLegacy,
  isRecoveredFromSafetyBackup,
  state as storeState
} from './store/paths'
export { saveDraft, loadDraft, listDrafts, deleteDraft } from './store/drafts'
export {
  finalizeFisa,
  deleteFinalizedFisa,
  listTrash,
  restoreFromTrash,
  listFiseFinalizate,
  readFisaByBaseName,
  getPdfPath,
  searchFise,
  listRecentFise,
  getAutocompleteData,
  getVehicleHistory,
  fisaBaseName,
  toLocalISO
} from './store/fise'
export { backupNow, flushBackup, scheduleBackup, exportBackup, importBackup, getBackupStatus } from './store/backup'
export { getSettings, saveSettings } from './store/settings'
export { getRapoarte, exportFiseCsv } from './store/reports'
export { AppError } from './errors'
