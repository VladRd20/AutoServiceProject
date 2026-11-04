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
/** Ca Promise.race([p, sleep(ms)]) dar fara timer ramas pornit; la expirare rezolva cu `onTimeout` (sau arunca daca lipseste). */
export function withTimeout(p, ms, onTimeout) {
  let timer
  const t = new Promise((res, rej) => {
    timer = setTimeout(() => (onTimeout === undefined ? rej(new Error(`timeout ${ms}ms`)) : res(onTimeout)), ms)
  })
  return Promise.race([p, t]).finally(() => clearTimeout(timer))
}
export const rnd = () => Math.random().toString(36).slice(2, 8)

// ------------------------------------------------------------- sandbox ----
let templateDir = null
let sandboxRoot = null
const allSandboxes = []

export function prepareTemplate() {
  // Fara sweepOrphans() aici: ar omori aplicatiile altei rulari paralele. Curatam doar ce a lansat
  // aceasta rulare (vezi sweepOrphans, care potriveste dupa radacina unica de sandbox-uri).
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
  fs.mkdirSync(path.join(dir, 'tmp'))
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
    // TEMP/TMP al aplicatiei lansate: os.tmpdir() => ServiceAuto-preview nu mai e partajat intre scenarii/rulari
    tmpDir: path.join(dir, 'tmp'),
    live: []
  }
  allSandboxes.push(sb)
  return sb
}

export async function destroySandbox(sb) {
  for (const h of sb.live) await hardKill(h).catch(() => {})
  try {
    // rmdir removes only the junction, never the target's contents.
    fs.rmdirSync(path.join(sb.appDir, 'node_modules'))
  } catch {}
  if (process.env.KEEP) return
  // Windows tine cateva zeci de ms handle-urile deschise dupa iesirea procesului: reincercam des si scurt.
  for (let i = 0; i < 40; i++) {
    try {
      fs.rmSync(sb.dir, { recursive: true, force: true })
      return
    } catch {
      await sleep(100)
    }
  }
}

/**
 * Omoara DOAR procesele electron.exe lansate de aceasta rulare: cele a caror linie de comanda contine radacina
 * unica de sandbox-uri (mkdtemp) a rularii curente. Alte rulari paralele au alta radacina si nu sunt atinse.
 */
export function sweepOrphans() {
  if (!sandboxRoot) return
  try {
    execFileSync('powershell', ['-NoProfile', '-Command',
      "Get-CimInstance Win32_Process -Filter \"Name='electron.exe'\" | Where-Object { $_.CommandLine -and $_.CommandLine.Contains($env:SA_E2E_ROOT) } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"],
    { stdio: 'ignore', env: { ...process.env, SA_E2E_ROOT: sandboxRoot } })
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
    // handle-urile procesului omorat se elibereaza cu mici intarzieri pe Windows: reincercam scurt (sincron)
    for (let i = 0; i < 20; i++) {
      try {
        fs.rmSync(sandboxRoot, { recursive: true, force: true })
        break
      } catch {
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100)
      }
    }
  }
  if (!fs.existsSync(path.join(ROOT, 'node_modules', 'electron'))) {
    console.error('!!! REAL node_modules/electron is missing - junction cleanup went wrong')
  }
}

// -------------------------------------------------------------- launch ----
const NOISE = [/Autofill\./, /DevTools/i, /Request Autofill/]

/** Launch the app. Returns handle { app, page, logs, exited }. */
export async function launch(sb, { env = {}, waitReady = true } = {}) {
  const e = { ...process.env, ...env, ELECTRON_ENABLE_LOGGING: '1', TEMP: sb.tmpDir, TMP: sb.tmpDir }
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
  // Formularul e vizibil abia dupa poarta de pornire (drafturi + prima rulare). "Ce e nou" cere IPC-ul imediat dupa
  // aceea: settle() trece prin acelasi canal IPC (raspunsurile vin in ordine) + doua cadre de randare, deci modalul
  // (daca exista) e deja in DOM cand il inchidem. Fara asta un modal tardiv acoperea butoanele si click-urile expirau.
  await settle(p)
  await dismissModal(p)
  await settle(p)
}

/**
 * Inlocuieste sleep-urile "sa se aseze UI-ul": un drum complet prin IPC (ordonat in main) + doua cadre de randare,
 * adica React a aplicat deja starile declansate de cererile anterioare.
 */
export async function settle(page) {
  await page.evaluate(async () => {
    await window.serviceAuto.fisa.listDrafts()
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
  })
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
  await withTimeout(h.exited, 5000, null)
}

/** Graceful close through electronApp.close(); falls back to kill. Resolves with { graceful, ms }. */
export async function closeApp(h, how = 'app') {
  const t0 = Date.now()
  let graceful = true
  try {
    if (how === 'app') await withTimeout(h.app.close(), 15000)
    else if (how === 'BrowserWindow.close2') {
      // double-click on the X: two close requests back to back
      h.app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.close(); w.close() }).catch(() => {})
      await withTimeout(h.exited, 15000)
    } else if (how === 'BrowserWindow.close') {
      h.app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].close() }).catch(() => {})
      await withTimeout(h.exited, 15000)
    }
  } catch (err) {
    graceful = false
    h.closeError = String(err.message || err)
    await hardKill(h)
  }
  // Procesul principal a iesit => blocarea de instanta unica si handle-urile pe userData sunt eliberate; nu mai asteptam "din pura prudenta".
  await withTimeout(h.exited, 5000, null)
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

export async function waitFor(fn, { timeout = 8000, interval = 50, what = 'condition' } = {}) {
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

/** Asteapta un fisier (optional cu predicat pe cale). Returneaza calea. */
export async function waitForFile(p, { timeout = 15000, pred = null, what } = {}) {
  await waitFor(() => fs.existsSync(p) && (!pred || pred(p)), { timeout, what: what || `file ${p}` })
  return p
}

/** Asteapta o linie din logul procesului principal (stdout/stderr) potrivita cu `re`. */
export const waitForLog = (h, re, { timeout = 15000 } = {}) =>
  waitFor(() => h.logs.main.find((l) => re.test(l)), { timeout, what: `main log ${re}` })

/** Asteapta un selector in pagina (implicit vizibil). */
export const waitForSelector = (page, sel, { state = 'visible', timeout = 15000 } = {}) =>
  page.locator(sel).first().waitFor({ state, timeout })

/**
 * Asteapta ca arborele de fisiere de sub `dirs` sa nu se mai schimbe `quietMs` (nume + marime + mtime).
 * Pentru cazurile in care testul afirma "nu mai apare nimic in plus" dupa o actiune: fereastra de liniste
 * inlocuieste un sleep fix mare. Pentru afirmatii de absenta peste autosave foloseste quietMs > debounce (1s).
 * Returneaza false daca nu s-a linistit in `timeout`.
 */
export async function waitQuiet(dirs, { quietMs = 300, timeout = 15000 } = {}) {
  const snap = () => {
    const out = []
    const walk = (d) => {
      let ents
      try {
        ents = fs.readdirSync(d, { withFileTypes: true })
      } catch {
        return
      }
      for (const e of ents) {
        const p = path.join(d, e.name)
        if (e.isDirectory()) {
          if (e.name !== 'node_modules') walk(p)
        } else {
          try {
            const st = fs.statSync(p)
            out.push(`${p}|${st.size}|${st.mtimeMs}`)
          } catch {}
        }
      }
    }
    for (const d of [].concat(dirs)) walk(d)
    return out.sort().join('\n')
  }
  let last = snap()
  let since = Date.now()
  const t0 = Date.now()
  while (Date.now() - since < quietMs) {
    if (Date.now() - t0 > timeout) return false
    await sleep(50)
    const cur = snap()
    if (cur !== last) {
      last = cur
      since = Date.now()
    }
  }
  return true
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
  await page.locator('.autosave-status.saved').waitFor({ state: 'visible', timeout: 15000 })
}

/** Wait until a draft on disk satisfies pred. (Chip-ul "Salvat" nu garanteaza fisierul: debounce 1s - de aceea se asteapta si pe disc.) */
export const waitDraft = (sb, pred, what = 'draft on disk') =>
  waitFor(() => readDrafts(sb).find(pred), { timeout: 15000, what })

const prevNames = new WeakMap()
/** Memoreaza numele curent, ca waitFinalizeDone sa stie cand s-a golit formularul (si pentru finalizari fara clickFinalize). */
export async function markFinalize(page) {
  prevNames.set(page, await nameInput(page).inputValue().catch(() => ''))
  await dismissToasts(page)
}

/**
 * Toast-ul de dupa o finalizare sta ~10s peste butonul "Finalizeaza" si Playwright asteapta sa dispara inainte
 * de click (asta era cea mai mare pierdere de timp din suita). Il inchidem inainte, ca un utilizator grabit;
 * astfel waitFinalizeDone vede si toast-ul NOU, nu pe cel vechi.
 */
export async function dismissToasts(page) {
  await page.locator('.toast-close').evaluateAll((els) => els.forEach((e) => e.click())).catch(() => {})
  await page.locator('.toast').first().waitFor({ state: 'detached', timeout: 2000 }).catch(() => {})
}
export async function clickFinalize(page) {
  await markFinalize(page)
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
  await settle(page)
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
  await settle(page)
  await dismissModal(page)
  await settle(page)
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
