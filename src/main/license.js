import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import https from 'https'
import { execSync } from 'child_process'
import os from 'os'
import { app } from 'electron'
import log from './logger'

// Lista publica de id-uri de licenta revocate, gazduita chiar in acest repo
// (fisier simplu, doar id-uri opace - fara nume de client sau chei). Un
// "purge"/revoke facut cu scripts/license-admin.js modifica local acest
// fisier; abia dupa commit+push devine vizibil aici si ajunge la clienti.
const REVOKED_LIST_URL =
  'https://raw.githubusercontent.com/VladRd20/AutoServiceProject/main/license/revoked.json'
const REVOCATION_CHECK_TIMEOUT_MS = 5000

// Cheia publica corespunzatoare cheii private din keys/private.pem (NU intra
// in git - vezi .gitignore). Doar cu acea cheie privata se pot genera chei
// de licenta pe care aplicatia le accepta ca valide; cheia publica de aici
// nu poate fi folosita pentru a genera chei noi, doar pentru a le verifica.
const PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAF2ECTVo6BRbA3K4QcsO7sDpH2+5XCe7jW5jpemxI+zw=
-----END PUBLIC KEY-----`

// Sare fixa amestecata in fingerprint-ul masinii inainte de a deriva cheia
// de criptare locala - doar ca sa nu fie un hash "gol" al unui singur id.
const APP_SALT = 'service-auto-license-v1'

let publicKeyObj = null
function getPublicKey() {
  if (!publicKeyObj) publicKeyObj = crypto.createPublicKey(PUBLIC_KEY_PEM)
  return publicKeyObj
}

function b64url(buf) {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromB64url(str) {
  const padded = str.replace(/-/g, '+').replace(/_/g, '/')
  const pad = padded.length % 4 === 0 ? '' : '='.repeat(4 - (padded.length % 4))
  return Buffer.from(padded + pad, 'base64')
}

// Chei emise inainte de scripts/license-admin.js (pre-v0.4.0) nu au un camp
// "id" in payload - fara el nu pot fi gasite in lista de revocari. Derivam
// un id stabil din continutul payload-ului, ca sa poata fi "importate" in
// registru (scripts/license-admin.js import) si revocate ca oricare altele.
// ATENTIE: logica trebuie sa ramana identica cu cea din license-admin.js.
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

// Verifica o cheie de licenta (format "payload.semnatura", ambele base64url)
// si intoarce payload-ul daca semnatura e valida, altfel null. Verificarea e
// pur locala - nu necesita nicio conexiune la internet.
function verifyLicenseKey(keyString) {
  try {
    const [payloadPart, sigPart] = String(keyString || '').trim().split('.')
    if (!payloadPart || !sigPart) return null
    const payloadBuf = fromB64url(payloadPart)
    const sigBuf = fromB64url(sigPart)
    const valid = crypto.verify(null, payloadBuf, getPublicKey(), sigBuf)
    if (!valid) return null
    return JSON.parse(payloadBuf.toString('utf8'))
  } catch (err) {
    log.warn('[license] cheie invalida sau corupta', err)
    return null
  }
}

// Fingerprint stabil al masinii Windows - MachineGuid e generat o singura
// data la instalarea Windows-ului si nu se schimba intre restarturi/update-uri
// de aplicatie, dar difera garantat intre doua calculatoare diferite.
function getMachineFingerprint() {
  try {
    const out = execSync('reg query "HKLM\\SOFTWARE\\Microsoft\\Cryptography" /v MachineGuid').toString()
    const match = out.match(/MachineGuid\s+REG_SZ\s+([0-9a-fA-F-]+)/)
    if (match) return match[1].trim()
  } catch (err) {
    log.warn('[license] nu s-a putut citi MachineGuid, folosesc fallback', err)
  }
  // Fallback mai slab (functioneaza tot, doar mai putin stabil la schimbari
  // hardware majore) - mai bine decat sa blocam activarea complet.
  return `${os.hostname()}-${os.cpus()?.[0]?.model || 'unknown-cpu'}`
}

function deriveKey(fingerprint) {
  return crypto.createHash('sha256').update(fingerprint + APP_SALT).digest()
}

function encryptRecord(obj, key) {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  const enc = Buffer.concat([cipher.update(JSON.stringify(obj), 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([iv, tag, enc]).toString('base64')
}

function decryptRecord(b64, key) {
  const buf = Buffer.from(b64, 'base64')
  const iv = buf.subarray(0, 12)
  const tag = buf.subarray(12, 28)
  const enc = buf.subarray(28)
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(tag)
  const dec = Buffer.concat([decipher.update(enc), decipher.final()])
  return JSON.parse(dec.toString('utf8'))
}

function licenseFilePath() {
  return path.join(app.getPath('userData'), 'license.dat')
}

let cachedActivated = null
let cachedPayload = null
let cachedRevoked = false

// Adevarat doar daca exista o inregistrare de activare valida, criptata cu
// o cheie derivata din fingerprint-ul ACESTEI masini - copiat pe alt
// calculator, fisierul nu se mai poate decripta (cheia derivata difera).
export function isActivated() {
  if (cachedActivated !== null) return cachedActivated

  try {
    const raw = fs.readFileSync(licenseFilePath(), 'utf-8')
    const fingerprint = getMachineFingerprint()
    const record = decryptRecord(raw, deriveKey(fingerprint))
    cachedActivated = record?.fingerprint === fingerprint && !!record?.payload
    cachedPayload = cachedActivated ? record.payload : null
  } catch (err) {
    cachedActivated = false
  }
  return cachedActivated
}

// True doar dupa ce checkRevocationOnline() a confirmat ca id-ul curent e in
// lista publica de revocari. Ramane false (nu blocheaza nimic) pana la primul
// rezultat de succes al verificarii, si la orice eroare de retea - aplicatia
// trebuie sa functioneze normal si offline, revocarea e un bonus "best-effort".
export function isRevoked() {
  return cachedRevoked
}

// Verificare best-effort, o singura data la pornire (apelata din main/index.js).
// Chei vechi, emise inainte sa existe campul "id" in payload, nu au id - nu
// pot fi revocate de la distanta, raman valabile cat timp semnatura e buna.
export async function checkRevocationOnline() {
  if (!isActivated() || !cachedPayload) return
  try {
    const id = deriveId(cachedPayload)
    const revokedIds = await fetchRevokedList()
    if (revokedIds.includes(id)) {
      cachedRevoked = true
      log.warn(`[license] licenta revocata de la distanta (id: ${id})`)
    }
  } catch (err) {
    log.warn('[license] verificarea revocarii a esuat (probabil offline) - ignorata', err)
  }
}

function fetchRevokedList() {
  return new Promise((resolve, reject) => {
    const req = https.get(REVOKED_LIST_URL, { timeout: REVOCATION_CHECK_TIMEOUT_MS }, (res) => {
      if (res.statusCode !== 200) {
        res.resume()
        reject(new Error(`status ${res.statusCode}`))
        return
      }
      let body = ''
      res.on('data', (chunk) => (body += chunk))
      res.on('end', () => {
        try {
          const ids = JSON.parse(body)
          resolve(Array.isArray(ids) ? ids : [])
        } catch (err) {
          reject(err)
        }
      })
    })
    req.on('timeout', () => req.destroy(new Error('timeout')))
    req.on('error', reject)
  })
}

// Activeaza aplicatia cu o cheie de licenta noua - verifica semnatura, apoi
// leaga activarea de masina curenta.
export function activate(keyString) {
  const payload = verifyLicenseKey(keyString)
  if (!payload) {
    const err = new Error('Cheia de licenta este invalida.')
    err.code = 'INVALID_KEY'
    throw err
  }

  const fingerprint = getMachineFingerprint()
  const record = { payload, fingerprint, activatedAt: new Date().toISOString() }
  const encrypted = encryptRecord(record, deriveKey(fingerprint))

  fs.mkdirSync(path.dirname(licenseFilePath()), { recursive: true })
  fs.writeFileSync(licenseFilePath(), encrypted, 'utf-8')
  cachedActivated = true
  cachedPayload = payload
  cachedRevoked = false
  log.info('[license] activare reusita')
  return payload
}
