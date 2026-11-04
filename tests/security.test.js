import crypto from 'crypto'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mkTmp } from './helpers'
import { cleanupOldPreviews } from '../src/main/store/paths.js'

// Cheie de test: inlocuim cheia publica incorporata cu una generata aici, ca sa
// putem semna chei "valide" fara cheia privata reala.
const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519')
vi.mock('crypto', async (orig) => {
  const real = await orig()
  const wrapped = {
    ...real.default,
    createPublicKey: (arg) => (typeof arg === 'string' ? publicKey : real.createPublicKey(arg))
  }
  return { ...wrapped, default: wrapped }
})
vi.mock('https', () => {
  const get = () => {
    throw new Error('offline')
  }
  return { default: { get }, get }
})

const b64u = (b) => Buffer.from(b).toString('base64url')
function makeKey(payload, signWith = privateKey) {
  const buf = Buffer.from(JSON.stringify(payload))
  return `${b64u(buf)}.${b64u(crypto.sign(null, buf, signWith))}`
}
const PAYLOAD = { product: 'ServiceAuto', client: 'Client SRL', issuedAt: '2026-01-01', id: 'abc123' }
const fp = () => `${os.hostname()}-${os.cpus()?.[0]?.model || 'unknown-cpu'}`

// Scrie un license.dat exact ca activate(), dar cu inregistrarea data.
function writeRecord(userData, record) {
  const key = crypto.createHash('sha256').update(record.fingerprint + 'service-auto-license-v1').digest()
  const iv = crypto.randomBytes(12)
  const c = crypto.createCipheriv('aes-256-gcm', key, iv)
  const enc = Buffer.concat([c.update(JSON.stringify(record), 'utf8'), c.final()])
  fs.writeFileSync(path.join(userData, 'license.dat'), Buffer.concat([iv, c.getAuthTag(), enc]).toString('base64'))
}

let lic
let userData
beforeEach(async () => {
  userData = mkTmp('sa-lic-')
  process.env.SA_USERDATA = userData
  vi.resetModules()
  lic = await import('../src/main/license.js')
})

describe('licenta: re-verificare semnatura', () => {
  it('activare noua: stocheaza cheia si trece verificarea', async () => {
    await lic.activate(makeKey(PAYLOAD))
    vi.resetModules()
    lic = await import('../src/main/license.js')
    expect(lic.isActivated()).toBe(true)
  })

  it('inregistrare veche fara "key": ramane activata (grandfathered)', () => {
    writeRecord(userData, { payload: PAYLOAD, fingerprint: fp(), activatedAt: 'x' })
    expect(lic.isActivated()).toBe(true)
  })

  it('inregistrare falsificata cu cheie semnata gresit: respinsa', () => {
    const other = crypto.generateKeyPairSync('ed25519').privateKey
    writeRecord(userData, { payload: PAYLOAD, key: makeKey(PAYLOAD, other), fingerprint: fp(), activatedAt: 'x' })
    expect(lic.isActivated()).toBe(false)
  })

  it('inregistrare cu key gol / fara semnatura: respinsa', () => {
    writeRecord(userData, { payload: PAYLOAD, key: '', fingerprint: fp(), activatedAt: 'x' })
    expect(lic.isActivated()).toBe(false)
  })

  it('cheie valida, dar payload diferit in inregistrare: respinsa', () => {
    writeRecord(userData, {
      payload: { ...PAYLOAD, client: 'Altcineva' },
      key: makeKey(PAYLOAD),
      fingerprint: fp(),
      activatedAt: 'x'
    })
    expect(lic.isActivated()).toBe(false)
  })
})

describe('previzualizari PDF: curatare', () => {
  it('sterge doar fisierele mai vechi de 24h; folder lipsa nu da eroare', async () => {
    const dir = mkTmp('sa-prev-')
    const oldF = path.join(dir, 'old.pdf')
    const newF = path.join(dir, 'new.pdf')
    fs.writeFileSync(oldF, 'x')
    fs.writeFileSync(newF, 'x')
    const old = new Date(Date.now() - 25 * 3600 * 1000)
    fs.utimesSync(oldF, old, old)
    await cleanupOldPreviews(dir)
    expect(fs.existsSync(oldF)).toBe(false)
    expect(fs.existsSync(newF)).toBe(true)
    await expect(cleanupOldPreviews(path.join(dir, 'nu-exista'))).resolves.toBeUndefined()
  })
})
