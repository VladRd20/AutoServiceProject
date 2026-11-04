// Helpers for the ServiceAuto Electron end-to-end harness.
// Every scenario gets a fresh sandbox: copy of out/ + package.json + build/,
// junctioned node_modules, private --user-data-dir. The real project `date/`
// folder and the real userData are never touched.
import { _electron } from 'playwright-core'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { execFileSync, spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
export const ELECTRON_EXE = path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe')
export const YEAR = new Date().getFullYear()

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
export const rnd = () => Math.random().toString(36).slice(2, 8)

// ------------------------------------------------------------- sandbox ----
let templateDir = null
let sandboxRoot = null
const allSandboxes = []

export function prepareTemplate() {
  sweepOrphans()
  sandboxRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sa-e2e-'))
  templateDir = path.join(sandboxRoot, '_template')
  fs.mkdirSync(templateDir)
  fs.cpSync(path.join(ROOT, 'out'), path.join(templateDir, 'out'), { recursive: true })
  fs.cpSync(path.join(ROOT, 'build'), path.join(templateDir, 'build'), { recursive: true })
  fs.copyFileSync(path.join(ROOT, 'package.json'), path.join(templateDir, 'package.json'))
  return sandboxRoot
}

function machineGuid() {
  const out = execFileSync('reg', ['query', 'HKLM\\SOFTWARE\\Microsoft\\Cryptography', '/v', 'MachineGuid']).toString()
  return out.match(/MachineGuid\s+REG_SZ\s+([0-9a-fA-F-]+)/)[1].trim()
}

function writeLicense(userData) {
  const fp = machineGuid()
  const key = crypto.createHash('sha256').update(fp + 'service-auto-license-v1').digest()
  const iv = crypto.randomBytes(12)
  const c = crypto.createCipheriv('aes-256-gcm', key, iv)
  const rec = {
    payload: { id: 'e2e', product: 'x', client: 'e2e', issuedAt: 'x' },
    fingerprint: fp,
    activatedAt: new Date().toISOString()
  }
  const enc = Buffer.concat([c.update(JSON.stringify(rec), 'utf8'), c.final()])
  const b64 = Buffer.concat([iv, c.getAuthTag(), enc]).toString('base64')
  fs.mkdirSync(userData, { recursive: true })
  fs.writeFileSync(path.join(userData, 'license.dat'), b64, 'utf-8')
}

/** Fresh isolated sandbox. opts.seedSettings (default true) pre-fills setari.json so the first-run modal stays closed. */
export function makeSandbox(name, opts = {}) {
  const dir = path.join(sandboxRoot, `${name}-${rnd()}`)
  const appDir = path.join(dir, 'app')
  const userData = path.join(dir, 'userData')
  fs.mkdirSync(dir)
  fs.cpSync(templateDir, appDir, { recursive: true })
  fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(appDir, 'node_modules'), 'junction')
  writeLicense(userData)
  const dataDir = path.join(appDir, 'date')
  if (opts.seedSettings !== false) {
    fs.mkdirSync(dataDir, { recursive: true })
    fs.writeFileSync(
      path.join(dataDir, 'setari.json'),
      JSON.stringify({ numeService: 'E2E Service', adresa: 'Str. Test 1', telefon: '069000000', cui: '123' })
    )
  }
  const sb = {
    name,
    dir,
    appDir,
    userData,
    dataDir,
    fiseDir: path.join(dataDir, 'fise'),
    draftsDir: path.join(dataDir, 'drafturi'),
    trashDir: path.join(dataDir, 'trash'),
    corruptDir: path.join(dataDir, 'corupte'),
    histLocal: path.join(dataDir, 'backup', 'history'),
    histSafety: path.join(userData, 'safety-backup', 'history'),
    safetyDir: path.join(userData, 'safety-backup'),
    tempFallback: path.join(userData, 'date-temporar'),
    live: []
  }
  allSandboxes.push(sb)
  return sb
}

export async function destroySandbox(sb) {
  for (const h of sb.live) await hardKill(h).catch(() => {})
  await sleep(300)
  try {
    // rmdir removes only the junction, never the target's contents.
    fs.rmdirSync(path.join(sb.appDir, 'node_modules'))
  } catch {}
  if (process.env.KEEP) return
  for (let i = 0; i < 5; i++) {
    try {
      fs.rmSync(sb.dir, { recursive: true, force: true })
      return
    } catch {
      await sleep(300)
    }
  }
}

/** Kill any electron.exe whose command line references a sa-e2e sandbox (orphans of a hung scenario). */
export function sweepOrphans() {
  try {
    execFileSync('powershell', ['-NoProfile', '-Command',
      "Get-CimInstance Win32_Process -Filter \"Name='electron.exe'\" | Where-Object { $_.CommandLine -match 'sa-e2e' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"], { stdio: 'ignore' })
  } catch {}
}

export function cleanupAll() {
  sweepOrphans()
  for (const sb of allSandboxes) {
    try {
      fs.rmdirSync(path.join(sb.appDir, 'node_modules'))
    } catch {}
  }
  if (!process.env.KEEP && sandboxRoot) {
    try {
      fs.rmSync(sandboxRoot, { recursive: true, force: true })
    } catch {}
  }
  if (!fs.existsSync(path.join(ROOT, 'node_modules', 'electron'))) {
    console.error('!!! REAL node_modules/electron is missing - junction cleanup went wrong')
  }
}

// -------------------------------------------------------------- launch ----
const NOISE = [/Autofill\./, /DevTools/i, /Request Autofill/]

/** Launch the app. Returns handle { app, page, logs, exited }. */
export async function launch(sb, { env = {}, waitReady = true } = {}) {
  const e = { ...process.env, ...env, ELECTRON_ENABLE_LOGGING: '1' }
  delete e.ELECTRON_RUN_AS_NODE
  delete e.ELECTRON_RENDERER_URL
  const app = await _electron.launch({
    executablePath: ELECTRON_EXE,
    args: [sb.appDir, `--user-data-dir=${sb.userData}`],
    env: e,
    cwd: sb.appDir,
    timeout: 30000
  })
  const h = { app, page: null, sb, logs: { console: [], pageErrors: [], main: [] }, exited: null, pid: app.process().pid }
  h.exited = new Promise((res) => app.process().once('exit', (code) => { h.dead = true; res(code ?? -1) }))
  const onData = (d) => h.logs.main.push(...String(d).split(/\r?\n/).filter(Boolean))
  app.process().stdout?.on('data', onData)
  app.process().stderr?.on('data', onData)
  sb.live.push(h)
  const page = await app.firstWindow()
  h.page = page
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') h.logs.console.push(`[${m.type()}] ${m.text()}`)
  })
  page.on('pageerror', (err) => h.logs.pageErrors.push(String(err?.stack || err)))
  if (waitReady) await ready(h)
  return h
}

export async function ready(h) {
  const p = h.page
  await p.getByLabel('Nume client').waitFor({ state: 'visible', timeout: 20000 })
  await dismissModal(p)
  // let initial refreshDrafts/getLocationInfo settle
  await sleep(400)
}

export async function dismissModal(page) {
  const overlay = page.locator('.modal-overlay')
  if (await overlay.count()) {
    await page.keyboard.press('Escape')
    await overlay.first().waitFor({ state: 'detached', timeout: 3000 }).catch(() => {})
  }
}

export async function hardKill(h) {
  if (h.dead) return
  try {
    // /T: also take the renderer/GPU children so the single-instance lock is really released
    execFileSync('taskkill', ['/F', '/T', '/PID', String(h.pid)], { stdio: 'ignore' })
  } catch {}
  try {
    h.app.process().kill()
  } catch {}
  await Promise.race([h.exited, sleep(5000)])
}

/** Graceful close through electronApp.close(); falls back to kill. Resolves with { graceful, ms }. */
export async function closeApp(h, how = 'app') {
  const t0 = Date.now()
  let graceful = true
  try {
    if (how === 'app') await Promise.race([h.app.close(), sleep(15000).then(() => { throw new Error('close timeout') })])
    else if (how === 'BrowserWindow.close2') {
      // double-click on the X: two close requests back to back
      h.app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.close(); w.close() }).catch(() => {})
      await Promise.race([h.exited, sleep(15000).then(() => { throw new Error('exit timeout') })])
    } else if (how === 'BrowserWindow.close') {
      h.app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].close() }).catch(() => {})
      await Promise.race([h.exited, sleep(15000).then(() => { throw new Error('exit timeout') })])
    }
  } catch (err) {
    graceful = false
    h.closeError = String(err.message || err)
    await hardKill(h)
  }
  await Promise.race([h.exited, sleep(5000)])
  await sleep(300)
  return { graceful, ms: Date.now() - t0 }
}

// ---------------------------------------------------------------- disk ----
export function listDir(dir, filter = () => true) {
  try {
    return fs.readdirSync(dir).filter(filter)
  } catch {
    return []
  }
}
export const readJsonFile = (p) => JSON.parse(fs.readFileSync(p, 'utf-8'))
export function tryReadJson(p) {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf-8'))
  } catch {
    return null
  }
}
export const jsonFiles = (dir) => listDir(dir, (n) => n.endsWith('.json') && !n.includes('.tmp-'))
export const readDrafts = (sb) => jsonFiles(sb.draftsDir).map((n) => ({ file: n, ...tryReadJson(path.join(sb.draftsDir, n)) }))
export const readFise = (sb) =>
  jsonFiles(sb.fiseDir).map((n) => ({ file: n, base: n.replace(/\.json$/, ''), ...tryReadJson(path.join(sb.fiseDir, n)) }))

/** All leftover .tmp- files and zero-byte / unparsable json anywhere under the data + safety dirs. */
export function integrityProblems(sb) {
  const problems = []
  const walk = (dir) => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, ent.name)
      if (ent.isDirectory()) {
        if (ent.name === 'node_modules') continue
        walk(p)
      } else {
        if (ent.name.includes('.tmp-')) problems.push(`tmp leftover: ${p}`)
        else if (ent.name.endsWith('.json')) {
          const st = fs.statSync(p)
          if (st.size === 0) problems.push(`zero-byte json: ${p}`)
          else if (!tryReadJson(p)) problems.push(`unparsable json: ${p}`)
        }
      }
    }
  }
  for (const root of [sb.dataDir, sb.safetyDir, sb.tempFallback]) if (fs.existsSync(root)) walk(root)
  return problems
}

export async function waitFor(fn, { timeout = 8000, interval = 100, what = 'condition' } = {}) {
  const t0 = Date.now()
  let last
  while (Date.now() - t0 < timeout) {
    try {
      const v = await fn()
      if (v) return v
    } catch (e) {
      last = e
    }
    await sleep(interval)
  }
  throw new Error(`timeout waiting for ${what}${last ? ` (last error: ${last.message})` : ''}`)
}

export function isPdf(p) {
  try {
    const b = fs.readFileSync(p)
    return b.length > 1024 && b.subarray(0, 5).toString('latin1') === '%PDF-'
  } catch {
    return false
  }
}

// ------------------------------------------------------------------ UI ----
export const nameInput = (p) => p.getByLabel('Nume client')
export const phoneInput = (p) => p.getByLabel('Număr de telefon')
export const plateInput = (p) => p.getByLabel('Număr de înmatriculare')
export const marcaInput = (p) => p.getByPlaceholder('Dacia', { exact: true })
export const modelInput = (p) => p.getByPlaceholder('Logan', { exact: true })
export const vinInput = (p) => p.getByLabel('VIN', { exact: true })
export const obsInput = (p) => p.getByLabel('Observații')
export const releaseBtn = (p) => p.locator('button.btn-release')
export const section = (p, title) => p.locator('section.card', { has: p.locator('h2', { hasText: title }) })

export async function addLine(page, titlu, { denumire, cantitate = '1', pret = '100' }) {
  const sec = section(page, titlu).filter({ has: page.locator('.card-header-right') })
  const before = await sec.locator('.linie:not(.linie-head)').count()
  await sec.locator('.card-header-right button.btn-sm').first().click()
  const row = sec.locator('.linie:not(.linie-head)').nth(before)
  await row.waitFor({ state: 'visible' })
  await row.getByPlaceholder('Denumire').fill(denumire)
  await row.getByLabel('Cantitate').fill(String(cantitate))
  await row.locator('input[inputmode="decimal"]').nth(1).fill(String(pret))
  await page.keyboard.press('Escape') // close autocomplete dropdown
}

export const DEFAULT_FISA = {
  nume: 'Ion Popescu',
  telefon: '0691234567',
  plate: 'B-123-ABC',
  marca: 'Dacia',
  model: 'Logan',
  piesa: 'Filtru ulei',
  lucrare: 'Schimb ulei'
}

export async function fillFisa(page, d = {}) {
  const f = { ...DEFAULT_FISA, ...d }
  await nameInput(page).fill(f.nume)
  await phoneInput(page).fill(f.telefon)
  await plateInput(page).fill(f.plate)
  await marcaInput(page).fill(f.marca)
  await page.keyboard.press('Escape')
  await modelInput(page).fill(f.model)
  await page.keyboard.press('Escape')
  if (f.vin) await vinInput(page).fill(f.vin)
  if (f.piesa !== null) await addLine(page, 'Piese', { denumire: f.piesa, cantitate: f.cant ?? '2', pret: f.pretPiesa ?? '50' })
  if (f.lucrare !== null) await addLine(page, 'Lucrări', { denumire: f.lucrare, cantitate: '1', pret: f.pretLucrare ?? '120' })
  return f
}

export async function waitSaved(page) {
  await page.locator('.autosave-status.saved').waitFor({ state: 'visible', timeout: 8000 })
}

/** Wait until a draft on disk satisfies pred. */
export const waitDraft = (sb, pred, what = 'draft on disk') =>
  waitFor(() => readDrafts(sb).find(pred), { timeout: 8000, what })

const prevNames = new WeakMap()
export async function clickFinalize(page) {
  prevNames.set(page, await nameInput(page).inputValue().catch(() => ''))
  await releaseBtn(page).click()
}

/** After finalize the form resets asynchronously; wait until finished + empty so following fills are not wiped. */
export async function waitFinalizeDone(page, { toast = /Fișă (finalizată|actualizată)/ } = {}) {
  await page.locator('.toast', { hasText: toast }).first().waitFor({ state: 'visible', timeout: 15000 })
  await waitFor(async () => (await nameInput(page).inputValue()) !== (prevNames.get(page) ?? ''), {
    timeout: 8000,
    what: 'form reset after finalize'
  })
  await waitFor(async () => !(await releaseBtn(page).innerText()).includes('Se finalizează'), { what: 'release done' })
  await sleep(500)
}

/** Finalize through IPC (fast seeding). Returns the IPC result. */
export function ipcFinalize(page, over = {}) {
  return page.evaluate(
    async ({ over }) => {
      const fisa = {
        id: null,
        client: { nume: 'Seed Client', telefon: '0691234567', cui: '' },
        auto: { nrInmatriculare: 'SEED-1', marca: 'Dacia', model: 'Logan', vin: '', an: '' },
        km: '',
        observatii: '',
        plata: { status: '', metoda: '' },
        data: '2026-09-01',
        dataCurenta: false,
        piese: [{ id: 'p1', denumire: 'Filtru', cantitate: 1, pretUnitar: 100 }],
        lucrari: [{ id: 'l1', denumire: 'Manopera', cantitate: 1, pret: 50 }],
        reducerePiesePercent: 0,
        reducereLucrariPercent: 0,
        ...over
      }
      if (over.client) fisa.client = { nume: 'Seed Client', telefon: '0691234567', cui: '', ...over.client }
      if (over.auto) fisa.auto = { nrInmatriculare: 'SEED-1', marca: 'Dacia', model: 'Logan', vin: '', an: '', ...over.auto }
      return window.serviceAuto.fisa.finalize(fisa)
    },
    { over }
  )
}

export async function reload(page) {
  // a clean autosaver never triggers beforeunload; wait for saved state first
  await page.reload()
  await page.getByLabel('Nume client').waitFor({ state: 'visible', timeout: 15000 })
  await dismissModal(page)
  await sleep(500)
}

/** Second raw electron process on the same userData (single-instance test). */
export function spawnSecond(sb) {
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  const cp = spawn(ELECTRON_EXE, [sb.appDir, `--user-data-dir=${sb.userData}`], { env, cwd: sb.appDir, stdio: 'ignore', windowsHide: true })
  const exited = new Promise((res) => cp.once('exit', (code) => res(code)))
  return { cp, exited, t0: Date.now() }
}

export function errorsOf(h) {
  const mainErr = h.logs.main.filter((l) => /\[error\]|\berror\b.*(uncaught|unhandled)/i.test(l) && !NOISE.some((r) => r.test(l)))
  const consoleErr = h.logs.console.filter((l) => l.startsWith('[error]') && !NOISE.some((r) => r.test(l)))
  return { main: mainErr, console: consoleErr, pageErrors: h.logs.pageErrors }
}
