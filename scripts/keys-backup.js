// Backup / restaurare criptata a folderului keys/ (vezi keys-backup-lib.js).
//
//   npm run keys:backup                       -> keys-backup-AAAA-LL-ZZ.sakeys (langa proiect)
//   npm run keys:backup -- "D:\\Backup"        -> in folderul dat (ex: stick USB)
//   npm run keys:restore -- fisier.sakeys      -> restaureaza in keys/ (nu suprascrie)
//   npm run keys:restore -- fisier.sakeys --force
//
// Parola se cere de la tastatura (nu apare pe ecran, minim 12 caractere) sau vine
// din variabila de mediu KEYS_PASSWORD. NU o pierde: fara ea backup-ul nu se
// poate deschide. Pastreaza fisierul si parola in locuri DIFERITE, in afara acestui PC.
const fs = require('fs')
const path = require('path')
const lib = require('./keys-backup-lib')

const ROOT = path.join(__dirname, '..')
const KEYS_DIR = path.join(ROOT, 'keys')

function askHidden(question) {
  return new Promise((resolve) => {
    process.stdout.write(question)
    const stdin = process.stdin
    if (!stdin.isTTY) {
      // fara terminal (pipe): citim o linie normal
      let buf = ''
      stdin.setEncoding('utf8')
      stdin.on('data', (c) => (buf += c))
      stdin.on('end', () => resolve(buf.split(/\r?\n/)[0]))
      return
    }
    let value = ''
    stdin.setRawMode(true)
    stdin.resume()
    stdin.setEncoding('utf8')
    const onData = (ch) => {
      for (const c of ch) {
        if (c === '\r' || c === '\n') {
          stdin.setRawMode(false)
          stdin.pause()
          stdin.removeListener('data', onData)
          process.stdout.write('\n')
          return resolve(value)
        }
        if (c === '\u0003') process.exit(130) // Ctrl+C
        if (c === '\u007f' || c === '\b') value = value.slice(0, -1)
        else value += c
      }
    }
    stdin.on('data', onData)
  })
}

async function getPassword(confirm) {
  if (process.env.KEYS_PASSWORD) return process.env.KEYS_PASSWORD
  const p1 = await askHidden('Parola backup (min. 12 caractere): ')
  if (confirm) {
    const p2 = await askHidden('Repeta parola: ')
    if (p1 !== p2) throw new Error('Parolele nu coincid.')
  }
  return p1
}

async function backup(destArg) {
  if (!fs.existsSync(KEYS_DIR)) throw new Error(`Nu exista folderul ${KEYS_DIR}`)
  const files = lib.collectFiles(KEYS_DIR)
  if (!files.some((f) => f.name === 'private.pem')) throw new Error('keys/private.pem lipseste - nu am ce salva.')
  const password = await getPassword(true)
  const blob = lib.encryptBackup(files, password)
  const destDir = path.resolve(destArg || ROOT)
  fs.mkdirSync(destDir, { recursive: true })
  const out = path.join(destDir, `keys-backup-${new Date().toISOString().slice(0, 10)}.sakeys`)
  fs.writeFileSync(out, blob)
  // Verificare imediata: decriptam ce am scris, ca sa nu avem un backup inutilizabil.
  const check = lib.decryptBackup(fs.readFileSync(out), password)
  if (check.length !== files.length) throw new Error('Verificarea backup-ului a esuat.')
  console.log(`\nBackup creat si verificat: ${out}`)
  console.log(`Fisiere salvate: ${files.map((f) => f.name).join(', ')}`)
  console.log('\nUrmatorul pas (IMPORTANT): copiaza fisierul pe un stick USB / al doilea cont cloud,')
  console.log('si tine parola intr-un manager de parole. Un backup doar pe acest PC nu te protejeaza.')
  console.log(`Restaurare: npm run keys:restore -- "${out}"`)
}

async function restore(fileArg, force) {
  if (!fileArg) throw new Error('Foloseste: npm run keys:restore -- <fisier.sakeys> [--force]')
  const password = await getPassword(false)
  const files = lib.decryptBackup(fs.readFileSync(fileArg), password)
  const written = lib.restoreFiles(files, KEYS_DIR, { force })
  console.log(`Restaurat in ${KEYS_DIR}:`)
  for (const w of written) console.log(`  ${w}`)
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2)
  const force = rest.includes('--force')
  const args = rest.filter((a) => !a.startsWith('--'))
  if (cmd === 'backup') return backup(args[0])
  if (cmd === 'restore') return restore(args[0], force)
  console.log('Comenzi: backup [folder-destinatie] | restore <fisier> [--force]')
  process.exitCode = 1
}

main().catch((err) => {
  console.error(`Eroare: ${err.message}`)
  process.exit(1)
})
