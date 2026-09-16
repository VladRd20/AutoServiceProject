// Genereaza o cheie de licenta noua, semnata cu cheia privata din keys/private.pem.
// Ruleaza: node scripts/generate-license-key.js "Numele clientului"
//
// Cheia rezultata se trimite clientului (email/WhatsApp) - o introduce o
// singura data in aplicatie, la prima pornire, in ecranul de activare.

const crypto = require('crypto')
const fs = require('fs')
const path = require('path')

const keyPath = path.join(__dirname, '..', 'keys', 'private.pem')
if (!fs.existsSync(keyPath)) {
  console.error(`Nu gasesc cheia privata la ${keyPath}.`)
  console.error('Fara ea nu se pot genera chei de licenta noi.')
  process.exit(1)
}

const clientName = process.argv[2] || 'Client necunoscut'
const privateKey = crypto.createPrivateKey(fs.readFileSync(keyPath, 'utf-8'))

const payload = {
  product: 'ServiceAuto',
  client: clientName,
  issuedAt: new Date().toISOString()
}

function b64url(buf) {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

const payloadBuf = Buffer.from(JSON.stringify(payload), 'utf-8')
const signature = crypto.sign(null, payloadBuf, privateKey)

const key = `${b64url(payloadBuf)}.${b64url(signature)}`

console.log('\nCheie de licenta pentru:', clientName)
console.log('---')
console.log(key)
console.log('---')
console.log('\nTrimite doar textul de mai sus clientului. Aplicatia o cere o singura data, la prima pornire.')
