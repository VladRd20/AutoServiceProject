import path from 'path'
import fs from 'fs/promises'
import log from '../logger'
import { copyFileAtomic, moveFile, readJson } from './io'
import { getBackupDir, getCorruptDir, getSafetyBackupDir, state } from './paths'

// Un fisier de date care nu se mai poate citi (JSON corupt/trunchiat/gol) nu
// trebuie sa dispara in tacere din lista: il mutam in corupte/ (nu il stergem)
// si incercam sa-l refacem dintr-o copie buna din backup (oglinda locala sau
// safety-backup). Intoarce { restored, value } - value = continutul refacut.
//
// kind: 'fise' | 'drafturi' | 'setari'
export async function quarantineAndRestore(filePath, kind, reason) {
  const name = path.basename(filePath)
  let moved = false
  try {
    await fs.mkdir(getCorruptDir(), { recursive: true })
    await moveFile(filePath, path.join(getCorruptDir(), `${name}.${Date.now()}.bad`))
    moved = true
  } catch (err) {
    if (err.code !== 'ENOENT') log.error(`[integrity] nu s-a putut muta ${name} in corupte/`, err)
  }

  const candidates =
    kind === 'setari'
      ? [path.join(getBackupDir(), 'mirror', 'setari.json'), path.join(getSafetyBackupDir(), 'setari.json')]
      : [path.join(getBackupDir(), 'mirror', kind, name), path.join(getSafetyBackupDir(), kind, name)]

  for (const candidate of candidates) {
    const res = await readJson(candidate)
    if (!res.ok) continue
    try {
      await copyFileAtomic(candidate, filePath)
      log.error(`[integrity] ${name} corupt (${reason?.message || reason}) - refacut din ${candidate}`)
      state.quarantined.push({ name, restored: true })
      return { restored: true, value: res.value }
    } catch (err) {
      log.warn(`[integrity] restaurarea ${name} din ${candidate} a esuat`, err)
    }
  }

  log.error(`[integrity] ${name} corupt (${reason?.message || reason}) - fara copie buna in backup${moved ? ', pastrat in corupte/' : ''}`)
  state.quarantined.push({ name, restored: false })
  return { restored: false, value: null }
}

// Citeste un JSON; la corupere il pune in carantina si incearca refacerea.
// Un fisier lipsa (ENOENT) NU e corupere - returneaza { ok:false, missing:true }.
export async function readJsonHealing(filePath, kind) {
  const res = await readJson(filePath)
  if (res.ok || res.missing) return res
  // Citire esuata temporar: nu atingem fisierul (un fisier bun nu se pune in carantina).
  if (res.transient) {
    log.warn(`[integrity] ${path.basename(filePath)} nu a putut fi citit acum (${res.error?.code}) - sarit, neatins`)
    return { ok: false, transient: true, error: res.error }
  }
  const healed = await quarantineAndRestore(filePath, kind, res.error)
  return healed.restored ? { ok: true, value: healed.value, healed: true } : { ok: false, corrupt: true, error: res.error }
}
