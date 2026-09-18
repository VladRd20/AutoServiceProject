import { app } from 'electron'
import path from 'path'
import fs from 'fs'

// Config minim, separat de "date/setari.json" (acolo sunt datele firmei,
// portabile odata cu fisele). Asta trebuie sa fie gasibil INAINTE sa stim
// unde e folderul de date - deci traieste mereu in AppData, fix, indiferent
// unde a fost mutat folderul de date propriu-zis.
function configFilePath() {
  return path.join(app.getPath('userData'), 'app-config.json')
}

export function getDataPathOverride() {
  try {
    const raw = fs.readFileSync(configFilePath(), 'utf-8')
    const cfg = JSON.parse(raw)
    return cfg.dataPath || null
  } catch {
    return null
  }
}

export function setDataPathOverride(newPath) {
  const cfg = { dataPath: newPath || null }
  fs.mkdirSync(path.dirname(configFilePath()), { recursive: true })
  const tmp = `${configFilePath()}.tmp-${process.pid}`
  fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2), 'utf-8')
  fs.renameSync(tmp, configFilePath())
}
