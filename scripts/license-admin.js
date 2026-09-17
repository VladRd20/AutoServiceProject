// Unealta de administrare a cheilor de licenta - inlocuieste vechiul
// generate-license-key.js cu un registru local (keys/licenses.json, NU intra
// in git - vezi .gitignore) si comenzi pentru intreg ciclul de viata al unei
// chei: generare, listare, revocare (dezactivare la distanta), restaurare,
// regenerare, editare metadate, stergere din registru.
//
// Revocarea e verificata de aplicatie la pornire, printr-un fetch best-effort
// catre license/revoked.json din acest repo (fisier PUBLIC, doar id-uri
// opace - vezi src/main/license.js). Dupa `revoke`/`restore`, fisierul local
// license/revoked.json se modifica, dar TREBUIE commitat + pushuit manual ca
// sa aiba efect - scriptul nu pusheaza singur.
//
// Comenzi:
//   node scripts/license-admin.js generate "Nume client" ["notite"]
//   node scripts/license-admin.js list
//   node scripts/license-admin.js revoke <id>
//   node scripts/license-admin.js restore <id>
//   node scripts/license-admin.js regenerate <id> [--revoke-old]
//   node scripts/license-admin.js edit <id> [--client "Nume nou"] [--notes "..."]
//   node scripts/license-admin.js purge <id>
//   node scripts/license-admin.js import <cheie_veche> ["notite"]

const crypto = require('crypto')
const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..')
const PRIVATE_KEY_PATH = path.join(ROOT, 'keys', 'private.pem')
const REGISTRY_PATH = path.join(ROOT, 'keys', 'licenses.json')
const REVOKED_LIST_PATH = path.join(ROOT, 'license', 'revoked.json')

// Corespunde cheii private din keys/private.pem - vezi si src/main/license.js.
const PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAF2ECTVo6BRbA3K4QcsO7sDpH2+5XCe7jW5jpemxI+zw=
-----END PUBLIC KEY-----`

function loadPrivateKey() {
  if (!fs.existsSync(PRIVATE_KEY_PATH)) {
    console.error(`Nu gasesc cheia privata la ${PRIVATE_KEY_PATH}.`)
    console.error('Fara ea nu se pot genera chei de licenta noi.')
    process.exit(1)
  }
  return crypto.createPrivateKey(fs.readFileSync(PRIVATE_KEY_PATH, 'utf-8'))
}

// Verifica o cheie deja emisa (format "payload.semnatura") si intoarce
// payload-ul daca semnatura e valida, altfel null. Trebuie sa ramana
// identica cu verifyLicenseKey() din src/main/license.js.
function verifyLicenseKey(keyString) {
  try {
    const [payloadPart, sigPart] = String(keyString || '').trim().split('.')
    if (!payloadPart || !sigPart) return null
    const payloadBuf = fromB64url(payloadPart)
    const sigBuf = fromB64url(sigPart)
    const publicKey = crypto.createPublicKey(PUBLIC_KEY_PEM)
    const valid = crypto.verify(null, payloadBuf, publicKey, sigBuf)
    if (!valid) return null
    return JSON.parse(payloadBuf.toString('utf8'))
  } catch (err) {
    return null
  }
}

// Chei emise inainte sa existe campul "id" in payload (pre-v0.4.0) nu pot fi
// gasite in lista de revocari dupa un id propriu - derivam unul stabil din
// continutul payload-ului. Trebuie sa ramana identica cu legacyId() din
// src/main/license.js, altfel aplicatia si acest tool calculeaza id-uri diferite.
function legacyId(payload) {
  return crypto
    .createHash('sha256')
    .update(`${payload.product}|${payload.client}|${payload.issuedAt}`)
    .digest('hex')
    .slice(0, 16)
}

function deriveId(payload) {
  return payload.id || legacyId(payload)
}

function b64url(buf) {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromB64url(str) {
  const padded = str.replace(/-/g, '+').replace(/_/g, '/')
  const pad = padded.length % 4 === 0 ? '' : '='.repeat(4 - (padded.length % 4))
  return Buffer.from(padded + pad, 'base64')
}

function loadRegistry() {
  if (!fs.existsSync(REGISTRY_PATH)) return []
  try {
    return JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf-8'))
  } catch (err) {
    console.error(`Registrul de la ${REGISTRY_PATH} e corupt sau ilizibil:`, err.message)
    process.exit(1)
  }
}

function saveRegistry(list) {
  fs.mkdirSync(path.dirname(REGISTRY_PATH), { recursive: true })
  fs.writeFileSync(REGISTRY_PATH, JSON.stringify(list, null, 2) + '\n', 'utf-8')
}

function loadRevokedList() {
  if (!fs.existsSync(REVOKED_LIST_PATH)) return []
  try {
    return JSON.parse(fs.readFileSync(REVOKED_LIST_PATH, 'utf-8'))
  } catch (err) {
    console.error(`Lista de revocari de la ${REVOKED_LIST_PATH} e corupta:`, err.message)
    process.exit(1)
  }
}

function saveRevokedList(ids) {
  fs.writeFileSync(REVOKED_LIST_PATH, JSON.stringify(ids, null, 2) + '\n', 'utf-8')
}

function newId(existing) {
  let id
  do {
    id = crypto.randomBytes(4).toString('hex')
  } while (existing.some((e) => e.id === id))
  return id
}

function findEntry(registry, id) {
  const entry = registry.find((e) => e.id === id)
  if (!entry) {
    console.error(`Nu exista nicio cheie cu id-ul "${id}" in registru. Ruleaza "list" pentru toate id-urile.`)
    process.exit(1)
  }
  return entry
}

function signPayload(payload, privateKey) {
  const payloadBuf = Buffer.from(JSON.stringify(payload), 'utf-8')
  const signature = crypto.sign(null, payloadBuf, privateKey)
  return `${b64url(payloadBuf)}.${b64url(signature)}`
}

function fmtDate(iso) {
  return iso ? iso.slice(0, 16).replace('T', ' ') : '-'
}

function cmdGenerate(args) {
  const clientName = args[0]
  const notes = args[1] || ''
  if (!clientName) {
    console.error('Foloseste: node scripts/license-admin.js generate "Nume client" ["notite"]')
    process.exit(1)
  }
  const registry = loadRegistry()
  const id = newId(registry)
  const privateKey = loadPrivateKey()
  const issuedAt = new Date().toISOString()
  const key = signPayload({ product: 'ServiceAuto', client: clientName, id, issuedAt }, privateKey)

  registry.push({ id, client: clientName, key, issuedAt, status: 'active', revokedAt: null, notes })
  saveRegistry(registry)

  console.log(`\nCheie de licenta noua pentru: ${clientName}  (id: ${id})`)
  console.log('---')
  console.log(key)
  console.log('---')
  console.log('\nTrimite doar textul de mai sus clientului. Aplicatia o cere o singura data, la prima pornire.')
}

function cmdList() {
  const registry = loadRegistry()
  if (registry.length === 0) {
    console.log('Nicio cheie in registru inca. Genereaza una cu "generate".')
    return
  }
  console.log(
    'ID        STATUS    EMIS              CLIENT                          NOTITE'
  )
  for (const e of registry) {
    console.log(
      `${e.id.padEnd(10)}${e.status.padEnd(10)}${fmtDate(e.issuedAt).padEnd(18)}${(e.client || '').slice(0, 30).padEnd(32)}${e.notes || ''}`
    )
  }
}

function cmdRevoke(args) {
  const id = args[0]
  if (!id) {
    console.error('Foloseste: node scripts/license-admin.js revoke <id>')
    process.exit(1)
  }
  const registry = loadRegistry()
  const entry = findEntry(registry, id)
  if (entry.status === 'revoked') {
    console.log(`"${entry.client}" (${id}) e deja revocata.`)
    return
  }
  entry.status = 'revoked'
  entry.revokedAt = new Date().toISOString()
  saveRegistry(registry)

  const revokedIds = loadRevokedList()
  if (!revokedIds.includes(id)) {
    revokedIds.push(id)
    saveRevokedList(revokedIds)
  }

  console.log(`Revocata: "${entry.client}" (${id}).`)
  console.log(
    '\nIMPORTANT: commit + push la license/revoked.json ca sa aiba efect real la client\n' +
      '(aplicatia verifica lista asta la pornire, cand are internet).'
  )
}

function cmdRestore(args) {
  const id = args[0]
  if (!id) {
    console.error('Foloseste: node scripts/license-admin.js restore <id>')
    process.exit(1)
  }
  const registry = loadRegistry()
  const entry = findEntry(registry, id)
  entry.status = 'active'
  entry.revokedAt = null
  saveRegistry(registry)

  const revokedIds = loadRevokedList().filter((x) => x !== id)
  saveRevokedList(revokedIds)

  console.log(`Restaurata: "${entry.client}" (${id}).`)
  console.log('\nIMPORTANT: commit + push la license/revoked.json ca sa aiba efect real la client.')
}

function cmdRegenerate(args) {
  const id = args[0]
  const revokeOld = args.includes('--revoke-old')
  if (!id) {
    console.error('Foloseste: node scripts/license-admin.js regenerate <id> [--revoke-old]')
    process.exit(1)
  }
  const registry = loadRegistry()
  const oldEntry = findEntry(registry, id)

  const newIdValue = newId(registry)
  const privateKey = loadPrivateKey()
  const issuedAt = new Date().toISOString()
  const key = signPayload(
    { product: 'ServiceAuto', client: oldEntry.client, id: newIdValue, issuedAt },
    privateKey
  )
  registry.push({
    id: newIdValue,
    client: oldEntry.client,
    key,
    issuedAt,
    status: 'active',
    revokedAt: null,
    notes: `regenerata din ${id}`
  })

  if (revokeOld && oldEntry.status !== 'revoked') {
    oldEntry.status = 'revoked'
    oldEntry.revokedAt = issuedAt
    const revokedIds = loadRevokedList()
    if (!revokedIds.includes(id)) {
      revokedIds.push(id)
      saveRevokedList(revokedIds)
    }
  }
  saveRegistry(registry)

  console.log(`\nCheie noua pentru: ${oldEntry.client}  (id: ${newIdValue}, inlocuieste ${id})`)
  console.log('---')
  console.log(key)
  console.log('---')
  if (revokeOld) {
    console.log(`\nCheia veche (${id}) a fost revocata.`)
    console.log(
      'IMPORTANT: commit + push la license/revoked.json ca sa aiba efect real la client.'
    )
  } else {
    console.log(`\nCheia veche (${id}) ramane activa - foloseste "revoke ${id}" daca vrei sa o dezactivezi.`)
  }
}

function cmdEdit(args) {
  const id = args[0]
  if (!id) {
    console.error('Foloseste: node scripts/license-admin.js edit <id> [--client "..."] [--notes "..."]')
    process.exit(1)
  }
  const registry = loadRegistry()
  const entry = findEntry(registry, id)

  const clientIdx = args.indexOf('--client')
  const notesIdx = args.indexOf('--notes')
  if (clientIdx !== -1 && args[clientIdx + 1] !== undefined) entry.client = args[clientIdx + 1]
  if (notesIdx !== -1 && args[notesIdx + 1] !== undefined) entry.notes = args[notesIdx + 1]

  if (clientIdx === -1 && notesIdx === -1) {
    console.error('Nimic de editat - foloseste --client si/sau --notes.')
    process.exit(1)
  }
  saveRegistry(registry)
  console.log(`Actualizata: ${id} -> client="${entry.client}" notite="${entry.notes || ''}"`)
  console.log('(Cheia semnata ramane neschimbata - editarea afecteaza doar metadatele locale.)')
}

function cmdPurge(args) {
  const id = args[0]
  if (!id) {
    console.error('Foloseste: node scripts/license-admin.js purge <id>')
    process.exit(1)
  }
  const registry = loadRegistry()
  const entry = findEntry(registry, id)
  const remaining = registry.filter((e) => e.id !== id)
  saveRegistry(remaining)
  console.log(`Sters din registru: "${entry.client}" (${id}).`)
  if (entry.status === 'active') {
    console.log(
      'ATENTIE: cheia era activa si NU a fost revocata - stergerea din registru e doar curatenie locala,\n' +
        `cheia ramane valabila la client. Ruleaza "revoke ${id}" INAINTE de purge daca vrei sa o dezactivezi.`
    )
  }
}

function cmdImport(args) {
  const keyString = args[0]
  const notes = args[1] || 'importata (cheie veche, emisa inainte de acest registru)'
  if (!keyString) {
    console.error('Foloseste: node scripts/license-admin.js import <cheie_veche> ["notite"]')
    process.exit(1)
  }
  const payload = verifyLicenseKey(keyString)
  if (!payload) {
    console.error('Cheia nu e valida (semnatura nu se potriveste sau formatul e gresit).')
    process.exit(1)
  }
  const id = deriveId(payload)
  const registry = loadRegistry()
  if (registry.some((e) => e.id === id)) {
    console.log(`Cheia asta e deja in registru (id: ${id}).`)
    return
  }
  registry.push({
    id,
    client: payload.client || 'Client necunoscut',
    key: keyString.trim(),
    issuedAt: payload.issuedAt || null,
    status: 'active',
    revokedAt: null,
    notes
  })
  saveRegistry(registry)
  console.log(`Importata: "${payload.client}" (id: ${id}).`)
  if (!payload.id) {
    console.log(
      'E o cheie veche, fara id propriu - id-ul de mai sus a fost derivat din continut, doar pentru\n' +
        'ca "revoke"/"restore" sa poata sa o gaseasca. Ramane valabil doar daca clientul are o versiune\n' +
        'a aplicatiei suficient de noua cat sa verifice revocarea in acelasi fel (v0.4.1+).'
    )
  }
}

function main() {
  const [, , cmd, ...args] = process.argv
  const commands = {
    generate: cmdGenerate,
    list: cmdList,
    revoke: cmdRevoke,
    restore: cmdRestore,
    regenerate: cmdRegenerate,
    edit: cmdEdit,
    purge: cmdPurge,
    import: cmdImport
  }
  const fn = commands[cmd]
  if (!fn) {
    console.log('Comenzi disponibile:')
    console.log('  generate "Nume client" ["notite"]')
    console.log('  list')
    console.log('  revoke <id>')
    console.log('  restore <id>')
    console.log('  regenerate <id> [--revoke-old]')
    console.log('  edit <id> [--client "..."] [--notes "..."]')
    console.log('  purge <id>')
    console.log('  import <cheie_veche> ["notite"]')
    process.exit(cmd ? 1 : 0)
  }
  fn(args)
}

main()
