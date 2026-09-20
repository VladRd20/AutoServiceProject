// Backup criptat al folderului keys/ (cheia privata de licentiere + registrul de
// licente). Un singur fisier, protejat cu parola (scrypt + AES-256-GCM), pe care
// il pastrezi in AFARA acestui calculator. Fara cheia privata nu se mai pot emite
// sau revoca licente pentru aplicatia deja livrata.
const crypto = require('crypto')
const fs = require('fs')
const path = require('path')

const MAGIC = 'SAKEYS1'
const MIN_PASSWORD = 12
const SCRYPT = { N: 1 << 15, r: 8, p: 1, maxmem: 128 * 1024 * 1024 }

function deriveKey(password, salt) {
  return crypto.scryptSync(String(password), salt, 32, SCRYPT)
}

function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex')
}

// Toate fisierele din `dir` (recursiv), cu cai relative cu "/" .
function collectFiles(dir, base = dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) collectFiles(full, base, out)
    else if (entry.isFile()) {
      const data = fs.readFileSync(full)
      out.push({ name: path.relative(base, full).split(path.sep).join('/'), data })
    }
  }
  return out
}

function assertPassword(password) {
  if (typeof password !== 'string' || password.length < MIN_PASSWORD) {
    throw new Error(`Parola trebuie sa aiba cel putin ${MIN_PASSWORD} caractere.`)
  }
}

function encryptBackup(files, password) {
  assertPassword(password)
  if (!files.length) throw new Error('Nu exista niciun fisier de salvat.')
  const payload = Buffer.from(
    JSON.stringify({
      createdAt: new Date().toISOString(),
      files: files.map((f) => ({ name: f.name, sha256: sha256(f.data), data: f.data.toString('base64') }))
    })
  )
  const salt = crypto.randomBytes(16)
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', deriveKey(password, salt), iv)
  // Antetul (magic) e autentificat: o modificare a lui invalideaza decriptarea.
  cipher.setAAD(Buffer.from(MAGIC))
  const enc = Buffer.concat([cipher.update(payload), cipher.final()])
  return Buffer.from(
    JSON.stringify({
      magic: MAGIC,
      salt: salt.toString('base64'),
      iv: iv.toString('base64'),
      tag: cipher.getAuthTag().toString('base64'),
      data: enc.toString('base64')
    })
  )
}

// Intoarce [{name, data:Buffer}] sau arunca cu un mesaj clar (parola gresita /
// fisier alterat / format necunoscut).
function decryptBackup(fileBuffer, password) {
  let box
  try {
    box = JSON.parse(fileBuffer.toString('utf8'))
  } catch {
    throw new Error('Fisierul nu este un backup de chei valid.')
  }
  if (!box || box.magic !== MAGIC) throw new Error('Fisierul nu este un backup de chei valid.')
  let payload
  try {
    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      deriveKey(String(password || ''), Buffer.from(box.salt, 'base64')),
      Buffer.from(box.iv, 'base64')
    )
    decipher.setAAD(Buffer.from(MAGIC))
    decipher.setAuthTag(Buffer.from(box.tag, 'base64'))
    payload = Buffer.concat([decipher.update(Buffer.from(box.data, 'base64')), decipher.final()])
  } catch {
    throw new Error('Parola gresita sau fisier alterat.')
  }
  const parsed = JSON.parse(payload.toString('utf8'))
  return parsed.files.map((f) => {
    const data = Buffer.from(f.data, 'base64')
    if (sha256(data) !== f.sha256) throw new Error(`Suma de control nu corespunde pentru ${f.name}.`)
    return { name: f.name, data }
  })
}

// Scrie fisierele in `destDir`. Nu suprascrie nimic existent decat cu force;
// numele cu ".." sau absolute sunt respinse (fisier de backup rau intentionat).
function restoreFiles(files, destDir, { force = false } = {}) {
  const root = path.resolve(destDir)
  const targets = files.map((f) => {
    const target = path.resolve(root, f.name)
    if (target !== root && !target.startsWith(root + path.sep)) {
      throw new Error(`Cale nepermisa in backup: ${f.name}`)
    }
    return { target, data: f.data }
  })
  if (!force) {
    const clash = targets.find((t) => fs.existsSync(t.target))
    if (clash) throw new Error(`Exista deja ${clash.target}. Foloseste --force ca sa-l suprascrii.`)
  }
  for (const t of targets) {
    fs.mkdirSync(path.dirname(t.target), { recursive: true })
    fs.writeFileSync(t.target, t.data)
  }
  return targets.map((t) => t.target)
}

module.exports = { MIN_PASSWORD, collectFiles, encryptBackup, decryptBackup, restoreFiles }
