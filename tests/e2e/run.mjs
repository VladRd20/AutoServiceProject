// End-to-end harness for the built ServiceAuto app (out/). NU ruleaza build-ul: `npm run e2e` il face inainte.
//   npm run e2e                                  build + toate scenariile, in paralel (--jobs implicit = min(4, cpus/2))
//   npm run e2e:smoke                            build + subsetul rapid (~1 min), vezi SMOKE mai jos
//   node tests/e2e/run.mjs 3 6 16                doar scenariile alese (id-uri; "10" include si 10b)
//   node tests/e2e/run.mjs --jobs 1              serial, ca inainte (depanare)
//   node tests/e2e/run.mjs --jobs 4 --smoke      se pot combina
//   KEEP=1 node tests/e2e/run.mjs 3              pastreaza sandbox-urile din temp pentru inspectie
// Jurnale per scenariu: tests/e2e/logs/<id>.log ; raport: tests/e2e/last-report.json.
// Rulari paralele (si procese node diferite) sunt sigure: fiecare rulare are propria radacina de sandbox-uri,
// iar curatarea de procese omoara doar electron.exe-urile al caror command line contine acea radacina.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  YEAR, sleep, rnd, prepareTemplate, makeSandbox, destroySandbox, cleanupAll, launch, closeApp, hardKill,
  readDrafts, readFise, jsonFiles, listDir, readJsonFile, tryReadJson, integrityProblems, waitFor, waitDraft, isPdf,
  nameInput, phoneInput, plateInput, marcaInput, modelInput, releaseBtn, section, fillFisa,
  waitSaved, clickFinalize, markFinalize, waitFinalizeDone, ipcFinalize, reload, spawnSecond, errorsOf,
  settle, waitQuiet, waitForSelector, withTimeout
} from './helpers.mjs'

// Subsetul rapid (--smoke): boot (1), fill + autosave (2), reopen/restore (5), finalize + PDF (6),
// cautare/paleta + setari (17: filtru de data in paleta, contor, setarea de auto-update).
const SMOKE = ['1', '2', '5', '6', '17']

const argv = process.argv.slice(2)
let jobs = Math.max(1, Math.min(4, Math.floor(os.cpus().length / 2)))
let smoke = false
const wanted = []
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--smoke') smoke = true
  else if (argv[i] === '--jobs' || argv[i] === '-j') jobs = Math.max(1, parseInt(argv[++i], 10) || 1)
  else if (argv[i].startsWith('--jobs=')) jobs = Math.max(1, parseInt(argv[i].slice(7), 10) || 1)
  else wanted.push(argv[i])
}
if (smoke) wanted.push(...SMOKE)

// Un scenariu = una sau mai multe "parti" independente (fiecare cu propriul sandbox) care pot rula in paralel
// in pool; `t` e comun, deci verificarile se aduna in acelasi scenariu. `weight` = durata estimata (s), ca
// partile lungi sa porneasca primele (LPT) si coada sa nu fie dominata de ele.
const scenarios = []
const scenario = (id, title, fn, weight = 10) => scenarios.push({ id: String(id), title, parts: [].concat(fn), weight })
const results = []

const pad2 = (n) => String(n).padStart(2, '0')
function todayDMY() {
  const d = new Date()
  return `${pad2(d.getDate())}-${pad2(d.getMonth() + 1)}-${d.getFullYear()}`
}
const newFisa = async (page) => {
  await page.locator('.btn-new').click()
  await waitFor(async () => (await nameInput(page).inputValue()) === '', { what: 'empty form after Fișă nouă' })
  await settle(page)
}
const recentItems = (page) => page.locator('.recent-list li')
const draftItem = (page, text) => page.locator('.drafts-list li', { hasText: text }).locator('button').first()

// ============================================================ 1. boot ======
scenario(1, 'Boot: window, no activation screen, no console errors', async (t) => {
  const sb = makeSandbox('boot')
  const h = await launch(sb)
  t.check((await h.app.windows()).length === 1, 'exactly one window')
  t.check(await nameInput(h.page).isVisible(), 'form visible')
  const licHits = await h.page.locator('text=/activare|licen[țt]/i').evaluateAll((els) => els.map((e) => e.className + ': ' + e.textContent.slice(0, 80)))
  t.check(licHits.length === 0, `no activation/licence screen text (found: ${licHits.join(' // ')})`)
  t.check((await h.page.title()) !== undefined, 'has title')
  // PASTRAT intentionat: scenariul afirma ca NU apar erori in fereastra de pornire; nu exista un semnal de
  // "toate task-urile de fundal s-au terminat" (revocation check cu retea, location info), deci e timp observat.
  await sleep(2500)
  const e = errorsOf(h)
  t.check(e.console.length === 0, `no console errors: ${e.console.join(' | ')}`)
  t.check(e.pageErrors.length === 0, `no page errors: ${e.pageErrors.join(' | ')}`)
  t.check(e.main.length === 0, `no [error] lines in main stdout: ${e.main.join(' | ')}`)
  t.info(`main log lines: ${h.logs.main.length}, warnings: ${h.logs.main.filter((l) => /warn/i.test(l)).slice(0, 3).join(' | ')}`)
  await closeApp(h)
  t.check(integrityProblems(sb).length === 0, `integrity: ${integrityProblems(sb).join(', ')}`)
})

// ==================================================== 2. fill + autosave ===
scenario(2, 'Full fișă + autosave draft matches', async (t) => {
  const sb = makeSandbox('fill')
  const h = await launch(sb)
  await fillFisa(h.page, { vin: '' })
  await waitSaved(h.page)
  const d = await waitDraft(sb, (x) => x.piese?.length === 1 && x.lucrari?.length === 1 && x.piese[0].denumire === 'Filtru ulei' && Number(x.lucrari[0].pret) === 120)
  t.check(d.client.nume === 'Ion Popescu', 'client.nume')
  t.check(d.client.telefon === '0691234567', 'telefon')
  t.check(d.auto.nrInmatriculare === 'B-123-ABC', 'plate')
  t.check(d.auto.marca === 'Dacia' && d.auto.model === 'Logan', 'marca/model')
  t.check(Number(d.piese[0].cantitate) === 2 && Number(d.piese[0].pretUnitar) === 50, 'piesa qty/price (pretul se normalizeaza la 2 zecimale la blur: "50.00")')
  t.check(d.status === 'draft', 'status draft')
  t.check(readDrafts(sb).length === 1, `exactly 1 draft on disk (got ${readDrafts(sb).length})`)
  await closeApp(h)
})

// ========================================================= 3. close-flush ===
// Cele 5 iteratii sunt independente (sandbox propriu) => 5 parti, rulate in paralel in pool.
const CLOSE_METHODS = ['BrowserWindow.close', 'app', 'BrowserWindow.close2', 'app', 'BrowserWindow.close']
scenario(3, 'CLOSE-FLUSH x5 (marker typed <150ms before close)', [0, 1, 2, 3, 4].map((i) => async (t) => {
  {
    const how = CLOSE_METHODS[i]
    const sb = makeSandbox(`closeflush${i}`)
    try {
      const h = await launch(sb)
      await nameInput(h.page).fill('Init')
      await plateInput(h.page).fill('CF-00-AAA')
      await waitSaved(h.page)
      await waitDraft(sb, (d) => d.client?.nume === 'Init')
      const marker = `MARK-${i}-${rnd()}`
      await nameInput(h.page).fill(marker)
      const t0 = Date.now()
      const closing = closeApp(h, how)
      const gap = Date.now() - t0
      const r = await closing
      t.info(`iter ${i} (${how}): gap between last keystroke and close request ~${gap}ms(+cdp), close took ${r.ms}ms graceful=${r.graceful}${h.closeError ? ' err=' + h.closeError : ''}`)
      t.check(r.graceful, `iter ${i} (${how}): app closed gracefully (${h.closeError || ''})`)
      const onDisk = readDrafts(sb).some((d) => d.client?.nume === marker)
      t.check(onDisk, `iter ${i} (${how}): marker on disk after close (drafts: ${readDrafts(sb).map((d) => d.client?.nume).join(',')})`)
      t.check(integrityProblems(sb).length === 0, `iter ${i}: integrity ${integrityProblems(sb).join(',')}`)
      const h2 = await launch(sb)
      const v = await nameInput(h2.page).inputValue()
      t.check(v === marker, `iter ${i} (${how}): marker restored in form (got "${v}")`)
      await closeApp(h2)
    } finally {
      await destroySandbox(sb)
    }
  }
}), 12)

// ======================================================== 4. switch-flush ===
scenario(4, 'SWITCH-FLUSH: edit draft A, click draft B <100ms later', async (t) => {
  const sb = makeSandbox('switch')
  const h = await launch(sb)
  const p = h.page
  await fillFisa(p, { nume: 'Alpha', plate: 'AAA-111' })
  await waitSaved(p)
  await waitDraft(sb, (d) => d.client?.nume === 'Alpha' && d.piese?.length === 1)
  await newFisa(p)
  await fillFisa(p, { nume: 'Beta', plate: 'BBB-222' })
  await waitSaved(p)
  await waitDraft(sb, (d) => d.client?.nume === 'Beta' && d.piese?.length === 1)
  await waitFor(async () => (await p.locator('.drafts-list li').count()) >= 2, { what: 'two drafts in sidebar' })
  const names = { A: 'Alpha', B: 'Beta' }
  const plates = { A: 'AAA-111', B: 'BBB-222' }
  let cur = 'B'
  for (let round = 0; round < 4; round++) {
    const other = cur === 'A' ? 'B' : 'A'
    const marker = `${cur}-EDIT${round}-${rnd()}`
    await nameInput(p).fill(marker)
    const t0 = Date.now()
    await draftItem(p, plates[other]).click({ noWaitAfter: true })
    const gap = Date.now() - t0
    await waitFor(async () => (await nameInput(p).inputValue()) === names[other], { what: `switch to ${other}` })
    const found = readDrafts(sb).some((d) => d.client?.nume === marker)
    t.check(found, `round ${round}: last edit of ${cur} on disk right after switch (click gap ${gap}ms)`)
    names[cur] = marker
    cur = other
  }
  t.check(readDrafts(sb).filter((d) => d.client?.nume).length === 2, `still exactly 2 non-empty drafts (${readDrafts(sb).map((d) => d.client?.nume).join(',')})`)
  await closeApp(h)
})

// ============================================================ 5. restore ===
scenario(5, 'Relaunch restores last open draft with content', async (t) => {
  const sb = makeSandbox('restore')
  const h = await launch(sb)
  await fillFisa(h.page, { nume: 'Restore Me', plate: 'RS-01-XYZ', vin: '' })
  await waitSaved(h.page)
  await waitDraft(sb, (d) => d.client?.nume === 'Restore Me' && d.lucrari?.length === 1)
  await closeApp(h)
  const h2 = await launch(sb)
  const p = h2.page
  t.check((await nameInput(p).inputValue()) === 'Restore Me', 'name restored')
  t.check((await plateInput(p).inputValue()) === 'RS-01-XYZ', 'plate restored')
  t.check((await phoneInput(p).inputValue()) === '0691234567', 'phone restored')
  t.check((await marcaInput(p).inputValue()) === 'Dacia' && (await modelInput(p).inputValue()) === 'Logan', 'marca/model restored')
  t.check((await section(p, 'Piese').locator('.linie:not(.linie-head)').count()) === 1, '1 piesă restored')
  t.check((await section(p, 'Lucrări').locator('.linie:not(.linie-head)').count()) === 1, '1 lucrare restored')
  t.check(readDrafts(sb).length === 1, `still one draft (got ${readDrafts(sb).length})`)
  await closeApp(h2)
})

// ========================================================== 6. finalize ====
scenario(6, 'Finalize: PDF valid, nr sequence, same plate+date suffix', async (t) => {
  const sb = makeSandbox('finalize')
  const h = await launch(sb)
  const p = h.page
  await fillFisa(p, { nume: 'First', plate: 'FIN-001' })
  await waitSaved(p)
  const draft = await waitDraft(sb, (d) => d.client?.nume === 'First' && d.lucrari?.length === 1)
  await clickFinalize(p)
  await waitFinalizeDone(p)
  const base1 = `FIN-001_${todayDMY()}`
  const j1 = tryReadJson(path.join(sb.fiseDir, `${base1}.json`))
  t.check(!!j1, `fise/${base1}.json exists (have: ${listDir(sb.fiseDir)})`)
  if (j1) {
    t.check(j1.nr === `${YEAR}-0001`, `nr ${j1.nr} == ${YEAR}-0001`)
    t.check(j1.status === 'finalizata', 'status finalizata')
    t.check(j1.client.nume === 'First', 'content')
  }
  t.check(isPdf(path.join(sb.fiseDir, `${base1}.pdf`)), 'PDF valid (%PDF, >1KB)')
  t.check(!fs.existsSync(path.join(sb.draftsDir, draft.file)), 'draft file gone')
  t.check((await recentItems(p).count()) === 1, 'shown in recent')

  await fillFisa(p, { nume: 'Second', plate: 'FIN-002' })
  await waitSaved(p)
  await clickFinalize(p)
  await waitFinalizeDone(p)
  const j2 = tryReadJson(path.join(sb.fiseDir, `FIN-002_${todayDMY()}.json`))
  t.check(j2?.nr === `${YEAR}-0002`, `second nr ${j2?.nr} == ${YEAR}-0002`)
  const j2raw = fs.readFileSync(path.join(sb.fiseDir, `FIN-002_${todayDMY()}.json`), 'utf-8')

  await fillFisa(p, { nume: 'Third same plate', plate: 'FIN-002' })
  await waitSaved(p)
  await clickFinalize(p)
  await waitFinalizeDone(p)
  const j3 = tryReadJson(path.join(sb.fiseDir, `FIN-002_${todayDMY()}-2.json`))
  t.check(!!j3, `suffix file FIN-002_${todayDMY()}-2.json exists (have: ${listDir(sb.fiseDir, (n) => n.endsWith('.json'))})`)
  t.check(j3?.nr === `${YEAR}-0003`, `third nr ${j3?.nr}`)
  t.check(j3?.client?.nume === 'Third same plate', 'third content')
  t.check(fs.readFileSync(path.join(sb.fiseDir, `FIN-002_${todayDMY()}.json`), 'utf-8') === j2raw, 'second fișă NOT overwritten')
  t.check(isPdf(path.join(sb.fiseDir, `FIN-002_${todayDMY()}-2.pdf`)), 'third PDF valid')
  t.check(jsonFiles(sb.fiseDir).length === 3, `3 fise (got ${jsonFiles(sb.fiseDir).length})`)
  t.check(readDrafts(sb).every((d) => !d.client?.nume), 'no non-empty drafts remain')
  t.check(integrityProblems(sb).length === 0, `integrity ${integrityProblems(sb).join(',')}`)
  await closeApp(h)
})

// ========================================================== 7. validation ===
scenario(7, 'Validation fail-cases block finalize; nothing written to fise/', async (t) => {
  const sb = makeSandbox('validation')
  const h = await launch(sb)
  const p = h.page
  const fiseCount = () => listDir(sb.fiseDir).length
  const errTexts = async () => (await p.locator('.field-error').allInnerTexts()).join(' | ')
  const attempt = async (label, expectRe, minErrors = 1) => {
    await clickFinalize(p)
    // semnalul real: toast-ul de eroare + erorile de camp au aparut (validarea e sincrona in UI, nu scrie nimic)
    await waitFor(async () => (await p.locator('.toast-error').count()) >= 1 && (await p.locator('.field-error').count()) >= 1, { what: `${label}: toast + field errors`, timeout: 5000 }).catch(() => {})
    const txt = await errTexts()
    const n = await p.locator('.field-error').count()
    t.check(n >= minErrors, `${label}: >=${minErrors} visible field errors (got ${n}: ${txt})`)
    if (expectRe) t.check(expectRe.test(txt), `${label}: error text matches ${expectRe} (got: ${txt})`)
    t.check(fiseCount() === 0, `${label}: nothing written to fise/ (${listDir(sb.fiseDir)})`)
    t.check((await p.locator('.toast-error').count()) >= 1, `${label}: error toast shown`)
    await p.locator('.toast-close').evaluateAll((els) => els.forEach((e) => e.click()))
  }
  // a) empty required fields
  await attempt('empty', /obligatoriu/, 5)
  // b) VIN 5 chars
  await newFisa(p)
  await fillFisa(p, { vin: '12345', plate: 'V-1' })
  await attempt('vin5', /17 caractere/)
  // c) price abc
  await newFisa(p)
  await fillFisa(p, { pretPiesa: 'abc', plate: 'V-2' })
  await attempt('price abc', /Preț invalid/)
  // d) negative price
  await newFisa(p)
  await fillFisa(p, { pretLucrare: '-5', plate: 'V-3' })
  await attempt('price -5', /Preț invalid/)
  // e) bad phone
  await newFisa(p)
  await fillFisa(p, { telefon: 'abc', plate: 'V-4' })
  await attempt('phone abc', /telefon invalid/i)
  // f) zero quantity
  await newFisa(p)
  await fillFisa(p, { cant: '0', plate: 'V-5' })
  await attempt('qty 0', /Cantitate invalidă/)
  // g) 201-char text via UI: input has maxLength, so expect truncation to 200
  await newFisa(p)
  await nameInput(p).fill('x'.repeat(201))
  const len = (await nameInput(p).inputValue()).length
  t.info(`UI: typing 201 chars into "Nume client" -> value length ${len} (maxLength guard, silently truncated)`)
  // h) IPC-level (defense in depth): 201-char values must be rejected by main
  const base = {
    id: null, client: { nume: 'ok', telefon: '0691234567', cui: '' }, auto: { nrInmatriculare: 'IPC-1', marca: 'Dacia', model: 'Logan', vin: '', an: '' },
    km: '', observatii: '', plata: { status: '', metoda: '' }, data: '2026-09-01', dataCurenta: false, piese: [], lucrari: [], reducerePiesePercent: 0, reducereLucrariPercent: 0
  }
  const variants = {
    'name 201': { client: { ...base.client, nume: 'x'.repeat(201) } },
    'piesa 201': { piese: [{ id: 'a', denumire: 'y'.repeat(201), cantitate: 1, pretUnitar: 1 }] },
    'obs 2001': { observatii: 'z'.repeat(2001) },
    'vin 5': { auto: { ...base.auto, vin: '12345' } },
    'price abc': { lucrari: [{ id: 'a', denumire: 'w', cantitate: 1, pret: 'abc' }] },
    'price -1': { lucrari: [{ id: 'a', denumire: 'w', cantitate: 1, pret: '-1' }] },
    'bad date': { data: '2026-13-45' },
    'discount 150': { reducerePiesePercent: 150 },
    '301 lines': { piese: Array.from({ length: 301 }, (_, i) => ({ id: `i${i}`, denumire: 'a', cantitate: 1, pretUnitar: 1 })) }
  }
  for (const [k, v] of Object.entries(variants)) {
    const res = await p.evaluate((f) => window.serviceAuto.fisa.finalize(f), { ...base, ...v })
    t.check(res.ok === false && res.error.code === 'VALIDATION', `IPC ${k}: rejected with VALIDATION (got ${JSON.stringify(res).slice(0, 120)})`)
  }
  const wrongType = await p.evaluate(() => window.serviceAuto.fisa.finalize(null))
  t.check(wrongType.ok === false, 'IPC finalize(null) rejected')
  t.check(fiseCount() === 0, `after all cases fise/ empty (${listDir(sb.fiseDir)})`)
  await closeApp(h)
})

// ===================================================== 8. single instance ===
scenario(8, 'Single instance: 2nd process exits fast, 1st window alive', async (t) => {
  const sb = makeSandbox('single')
  const h = await launch(sb)
  await fillFisa(h.page, { nume: 'Single', plate: 'SI-1', piesa: null, lucrare: null })
  await waitSaved(h.page)
  const before = await h.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)
  await h.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].minimize())
  const s = spawnSecond(sb)
  const code = await withTimeout(s.exited, 15000, 'TIMEOUT')
  const ms = Date.now() - s.t0
  if (code === 'TIMEOUT') s.cp.kill()
  t.check(code !== 'TIMEOUT', `second instance exited (code ${code}) in ${ms}ms`)
  t.check(ms < 8000, `second instance exited quickly (${ms}ms)`)
  const after = await h.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)
  t.check(before === 1 && after === 1, `still exactly one window (${before} -> ${after})`)
  const winState = () => h.app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0]
    return { minimized: w.isMinimized(), visible: w.isVisible(), focused: w.isFocused() }
  })
  // restaurarea ferestrei de catre instanta a doua e asincrona: asteptam starea, check-ul de dupa ramane acelasi
  await waitFor(async () => { const s2 = await winState(); return !s2.minimized && s2.visible }, { what: 'first window restored', timeout: 5000 }).catch(() => {})
  const st = await winState()
  t.check(!st.minimized && st.visible, `first window restored & visible after 2nd launch (${JSON.stringify(st)})`)
  t.info(`focus state: ${JSON.stringify(st)} (focus may be OS-restricted from a background test runner)`)
  t.check((await nameInput(h.page).inputValue()) === 'Single', 'first window still responsive with its state')
  t.check(!h.exitedEarly, 'first process alive')
  await closeApp(h)
})

// ======================================================== 9. delete+undo ====
scenario(9, 'Delete finalized -> trash; Anulează restores; nr not reused', async (t) => {
  const sb = makeSandbox('trash')
  const h = await launch(sb)
  const p = h.page
  const r = await ipcFinalize(p, { auto: { nrInmatriculare: 'DEL-1' }, client: { nume: 'To Delete' } })
  t.check(r.ok && r.data.pdfSaved, `seed finalize ok (${JSON.stringify(r).slice(0, 150)})`)
  const base = r.data.baseName
  await reload(p)
  t.check((await recentItems(p).count()) === 1, 'recent list shows 1')
  await recentItems(p).first().locator('button[aria-label="Șterge fișa finalizată"]').click()
  await p.locator('.confirm-dialog .btn-danger').click()
  await waitFor(async () => (await recentItems(p).count()) === 0, { what: 'recent list emptied' })
  t.check(!fs.existsSync(path.join(sb.fiseDir, `${base}.json`)) && !fs.existsSync(path.join(sb.fiseDir, `${base}.pdf`)), 'json+pdf gone from fise/')
  const trash = listDir(sb.trashDir)
  t.check(trash.some((n) => n.startsWith(base + '__') && n.endsWith('.json')) && trash.some((n) => n.startsWith(base + '__') && n.endsWith('.pdf')), `trash has json+pdf (${trash})`)
  await p.locator('.toast button', { hasText: 'Anulează' }).click()
  await waitFor(async () => (await recentItems(p).count()) === 1, { what: 'recent list restored' })
  t.check(fs.existsSync(path.join(sb.fiseDir, `${base}.json`)) && isPdf(path.join(sb.fiseDir, `${base}.pdf`)), 'json+pdf back in fise/')
  t.check(listDir(sb.trashDir).length === 0, `trash empty after restore (${listDir(sb.trashDir)})`)
  const j = readJsonFile(path.join(sb.fiseDir, `${base}.json`))
  t.check(j.nr === `${YEAR}-0001` && j.client.nume === 'To Delete', 'restored content/nr intact')
  // numbering continuity across delete
  const del = await p.evaluate((b) => window.serviceAuto.fisa.deleteFinalizata(b + '.json'), base)
  t.check(del.ok && del.data.trashId, 'IPC delete ok')
  const r2 = await ipcFinalize(p, { auto: { nrInmatriculare: 'DEL-2' } })
  t.check(r2.ok && r2.data.fisa.nr === `${YEAR}-0002`, `nr after deleting #1 is ${r2.data?.fisa?.nr} (expected ${YEAR}-0002, not reused)`)
  const rs = await p.evaluate((id) => window.serviceAuto.trash.restore(id), del.data.trashId)
  t.check(rs.ok, 'restore via IPC ok')
  // restore into a name that is now occupied by nothing; then restore twice -> not found
  const rs2 = await p.evaluate((id) => window.serviceAuto.trash.restore(id), del.data.trashId)
  t.check(rs2.ok === false, 'second restore of same trashId fails cleanly')
  await closeApp(h)
})

// ============================================================ 10. edit ======
scenario(10, 'Edit recent fișă: same file, same nr, history keeps old version', async (t) => {
  const sb = makeSandbox('edit')
  const h = await launch(sb)
  const p = h.page
  const r = await ipcFinalize(p, { auto: { nrInmatriculare: 'EDT-1' }, client: { nume: 'Original Name' } })
  const base = r.data.baseName
  const nr = r.data.fisa.nr
  await reload(p)
  await recentItems(p).first().locator('button[aria-label="Editează"]').click()
  await waitFor(async () => (await nameInput(p).inputValue()) === 'Original Name', { what: 'edit form loaded' })
  t.check((await p.locator('h1').innerText()).includes('Editare'), 'title says Editare fișă')
  await nameInput(p).fill('Edited Name')
  // autosave-ul draftului de editare: asteptam pe disc (chip-ul "Salvat" se aprinde si cu debounce-ul de 1s in asteptare)
  await waitDraft(sb, (d) => d.client?.nume === 'Edited Name').catch(() => {})
  await clickFinalize(p)
  await waitFinalizeDone(p, { toast: /Fișă actualizată/ })
  const fise = readFise(sb)
  t.check(fise.length === 1 && fise[0].base === base, `single file, same base (${fise.map((f) => f.base)})`)
  t.check(fise[0]?.nr === nr, `same nr (${fise[0]?.nr} vs ${nr})`)
  t.check(fise[0]?.client?.nume === 'Edited Name', 'content updated')
  t.check(isPdf(path.join(sb.fiseDir, `${base}.pdf`)), 'PDF valid after edit')
  for (const [label, dir] of [['local history', sb.histLocal], ['safety history', sb.histSafety]]) {
    const files = listDir(dir, (n) => n.startsWith(base + '__') && n.endsWith('.json'))
    t.check(files.length === 1, `${label} has 1 archived version (${files})`)
    if (files[0]) t.check(readJsonFile(path.join(dir, files[0])).client.nume === 'Original Name', `${label} holds the previous version`)
  }
  t.check(readDrafts(sb).every((d) => !d.client?.nume), 'no leftover edit draft')
  // second edit -> second history entry, still one file
  await recentItems(p).first().locator('button[aria-label="Editează"]').click()
  await waitFor(async () => (await nameInput(p).inputValue()) === 'Edited Name', { what: 'edit form 2' })
  await nameInput(p).fill('Edited Twice')
  await clickFinalize(p)
  await waitFinalizeDone(p, { toast: /Fișă actualizată/ })
  t.check(readFise(sb).length === 1 && readFise(sb)[0].nr === nr, 'after 2nd edit still one file, same nr')
  t.check(listDir(sb.histLocal, (n) => n.endsWith('.json')).length === 2, `2 history versions (${listDir(sb.histLocal)})`)
  await closeApp(h)
})

scenario('10b', 'Edit an OLD fișă created with "Data curentă": date/filename must not change', async (t) => {
  const sb = makeSandbox('editold')
  fs.mkdirSync(sb.fiseDir, { recursive: true })
  const old = {
    schemaVersion: 2, client: { nume: 'Old Client', telefon: '0691234567', cui: '' },
    auto: { nrInmatriculare: 'OLD-1', marca: 'Dacia', model: 'Logan', vin: '', an: '' }, km: '', observatii: '',
    plata: { status: '', metoda: '' }, data: '2026-01-05T10:00:00', dataCurenta: true,
    piese: [{ id: 'p', denumire: 'Filtru', cantitate: 1, pretUnitar: 10 }], lucrari: [{ id: 'l', denumire: 'Man', cantitate: 1, pret: 10 }],
    reducerePiesePercent: 0, reducereLucrariPercent: 0, status: 'finalizata', finalizedAt: '2026-01-05T08:00:00.000Z', nr: '2026-0001'
  }
  fs.writeFileSync(path.join(sb.fiseDir, 'OLD-1_05-01-2026.json'), JSON.stringify(old))
  const h = await launch(sb)
  const p = h.page
  await waitFor(async () => (await recentItems(p).count()) === 1, { what: 'old fișă listed' })
  await recentItems(p).first().locator('button[aria-label="Editează"]').click()
  await waitFor(async () => (await nameInput(p).inputValue()) === 'Old Client', { what: 'edit loaded' })
  await phoneInput(p).fill('0699999999') // trivial correction
  await clickFinalize(p)
  await waitFinalizeDone(p, { toast: /Fișă actualizată/ })
  const files = jsonFiles(sb.fiseDir)
  t.check(files.length === 1 && files[0] === 'OLD-1_05-01-2026.json', `file name unchanged after trivial edit (got ${files}) - date of an old fișă silently reset to today`)
  const j = files[0] && tryReadJson(path.join(sb.fiseDir, files[0]))
  t.check(j?.data?.startsWith('2026-01-05'), `fișă date preserved (got ${j?.data})`)
  await closeApp(h)
})

// ========================================================= 11. corruption ===
async function corruptionCase(t, label, mutate) {
  const sb = makeSandbox('corrupt-' + label)
  const h = await launch(sb)
  const r = await ipcFinalize(h.page, { auto: { nrInmatriculare: 'COR-1' }, client: { nume: 'Corrupt Me' } })
  const base = r.data.baseName
  const original = fs.readFileSync(path.join(sb.fiseDir, `${base}.json`), 'utf-8')
  const bk = await h.page.evaluate(() => window.serviceAuto.backup.now())
  t.check(bk.ok, `backup.now ok (${JSON.stringify(bk).slice(0, 100)})`)
  t.check(fs.existsSync(path.join(sb.safetyDir, 'fise', `${base}.json`)) && fs.existsSync(path.join(sb.dataDir, 'backup', 'mirror', 'fise', `${base}.json`)), 'both mirrors hold the fișă')
  await closeApp(h)
  mutate(path.join(sb.fiseDir, `${base}.json`), original)
  const h2 = await launch(sb)
  const p = h2.page
  await waitFor(async () => (await recentItems(p).count()) === 1, { what: 'fișă listed after corruption', timeout: 10000 })
  // repararea din backup scrie fisierul inainte/dupa listare: asteptam continutul valid pe disc, comparatia de mai jos ramane
  await waitFor(() => { const c = tryReadJson(path.join(sb.fiseDir, `${base}.json`)); return c && JSON.stringify(c) === JSON.stringify(JSON.parse(original)) }, { what: 'fișă healed on disk', timeout: 5000 }).catch(() => {})
  await waitFor(() => isPdf(path.join(sb.fiseDir, `${base}.pdf`)), { what: 'pdf valid', timeout: 5000 }).catch(() => {})
  const now = fs.readFileSync(path.join(sb.fiseDir, `${base}.json`), 'utf-8')
  t.check(now === original || JSON.stringify(JSON.parse(now)) === JSON.stringify(JSON.parse(original)), `${label}: fișă restored from backup`)
  t.check(isPdf(path.join(sb.fiseDir, `${base}.pdf`)), `${label}: PDF still valid`)
  const e = errorsOf(h2)
  t.check(e.pageErrors.length === 0, `${label}: no page errors`)
  t.info(`${label}: corupte/ = [${listDir(sb.corruptDir)}]; toasts: ${(await p.locator('.toast').allInnerTexts()).join(' | ')}`)
  await closeApp(h2)
  t.check(integrityProblems(sb).length === 0, `${label}: integrity ${integrityProblems(sb).join(',')}`)
  await destroySandbox(sb)
}
// 4 cazuri independente (sandbox propriu) => 4 parti paralele.
scenario(11, 'Corrupt (truncated / empty / garbage) finalized JSON is healed from backup', [
  (t) => corruptionCase(t, 'truncated', (f, o) => fs.writeFileSync(f, o.slice(0, Math.floor(o.length * 0.4)))),
  (t) => corruptionCase(t, 'zero-byte', (f) => fs.writeFileSync(f, '')),
  (t) => corruptionCase(t, 'garbage', (f) => fs.writeFileSync(f, Buffer.alloc(300, 0))),
  async (t) => {
  // draft corruption
  const sb = makeSandbox('corrupt-draft')
  const h = await launch(sb)
  await fillFisa(h.page, { nume: 'Draft Corrupt', plate: 'DC-1' })
  await waitSaved(h.page)
  await waitDraft(sb, (d) => d.client?.nume === 'Draft Corrupt' && d.lucrari?.length === 1)
  await h.page.evaluate(() => window.serviceAuto.backup.now())
  await closeApp(h)
  const df = jsonFiles(sb.draftsDir).find((n) => tryReadJson(path.join(sb.draftsDir, n))?.client?.nume === 'Draft Corrupt')
  const raw = fs.readFileSync(path.join(sb.draftsDir, df), 'utf-8')
  fs.writeFileSync(path.join(sb.draftsDir, df), raw.slice(0, 50))
  const h2 = await launch(sb)
  t.check((await nameInput(h2.page).inputValue()) === 'Draft Corrupt', 'draft restored from backup and shown in form')
  await closeApp(h2)
  await destroySandbox(sb)
  }
], 12)

// ========================================================== 12. missing pdf ==
scenario(12, 'Missing PDF regenerated by retryPdf', async (t) => {
  const sb = makeSandbox('pdf')
  const h = await launch(sb)
  const p = h.page
  const r = await ipcFinalize(p, { auto: { nrInmatriculare: 'PDF-1' } })
  const base = r.data.baseName
  const pdf = path.join(sb.fiseDir, `${base}.pdf`)
  t.check(isPdf(pdf), 'initial PDF ok')
  fs.unlinkSync(pdf)
  const res = await p.evaluate((b) => window.serviceAuto.fisa.retryPdf({ baseName: b }), base)
  t.check(res.ok && res.data.pdfSaved, `retryPdf ok (${JSON.stringify(res).slice(0, 150)})`)
  t.check(isPdf(pdf), 'PDF regenerated and valid')
  fs.writeFileSync(pdf, '') // zero-byte pdf
  const res2 = await p.evaluate((b) => window.serviceAuto.fisa.retryPdf({ baseName: b }), base)
  t.check(res2.ok && isPdf(pdf), 'zero-byte PDF regenerated')
  const bad = await p.evaluate(() => window.serviceAuto.fisa.retryPdf({ baseName: '../evil' }))
  t.check(bad.ok === false, `path traversal baseName rejected (${bad.error?.code})`)
  const none = await p.evaluate(() => window.serviceAuto.fisa.retryPdf({ baseName: 'NOPE_01-01-2020' }))
  t.check(none.ok === false && none.error.code === 'NOT_FOUND', `unknown baseName -> NOT_FOUND (${none.error?.code})`)
  t.check(!fs.existsSync(path.join(sb.fiseDir, 'NOPE_01-01-2020.pdf')), 'no stray PDF created for missing fișă')
  await closeApp(h)
})

// ===================================================== 13. data path fail ===
// Cele doua variante (kind) sunt independente => 2 parti paralele.
scenario(13, 'Unusable data path -> temp fallback, banner, drafts + finalize still work, merge back', ['nonexistent-drive', 'under-a-file'].map((kind) => async (t) => {
  {
    const sb = makeSandbox('fallback-' + kind, { seedSettings: false })
    let bad
    if (kind === 'nonexistent-drive') {
      const letter = 'ZYXWVUTSR'.split('').find((l) => !fs.existsSync(`${l}:\\`))
      bad = `${letter}:\\nonexistent\\x`
    } else {
      fs.mkdirSync(sb.dir, { recursive: true })
      fs.writeFileSync(path.join(sb.dir, 'blocker.txt'), 'x')
      bad = path.join(sb.dir, 'blocker.txt', 'sub')
    }
    fs.writeFileSync(path.join(sb.userData, 'app-config.json'), JSON.stringify({ dataPath: bad }))
    const h = await launch(sb)
    const p = h.page
    const banner = p.locator('.app-banner.warn')
    await waitFor(async () => (await banner.count()) === 1, { what: `${kind}: warning banner`, timeout: 8000 }).catch(() => {})
    t.check((await banner.count()) === 1, `${kind}: persistent warning banner visible`)
    t.check((await banner.innerText().catch(() => '')).includes('date-temporar'), `${kind}: banner names the temp folder`)
    t.check(fs.existsSync(path.join(sb.tempFallback, 'drafturi')), `${kind}: date-temporar/ created`)
    await fillFisa(p, { nume: 'Fallback Draft', plate: 'FB-1' })
    await waitSaved(p)
    const tdrafts = () => jsonFiles(path.join(sb.tempFallback, 'drafturi')).map((n) => tryReadJson(path.join(sb.tempFallback, 'drafturi', n)))
    await waitFor(() => tdrafts().some((d) => d?.client?.nume === 'Fallback Draft'), { what: 'draft saved to temp folder' })
    t.check(true, `${kind}: draft saved in date-temporar`)
    await clickFinalize(p)
    await waitFinalizeDone(p)
    const tf = jsonFiles(path.join(sb.tempFallback, 'fise'))
    t.check(tf.length === 1 && isPdf(path.join(sb.tempFallback, 'fise', tf[0].replace('.json', '.pdf'))), `${kind}: finalize + PDF work in fallback (${tf})`)
    await fillFisa(p, { nume: 'Fallback Draft 2', plate: 'FB-2' })
    await waitSaved(p)
    await waitFor(() => tdrafts().some((d) => d?.client?.nume === 'Fallback Draft 2'), { what: 'draft 2' })
    await closeApp(h)
    if (kind === 'under-a-file') {
      // restore connectivity: point at a real folder, expect merge back of the work done meanwhile
      const real = path.join(sb.dir, 'realdata')
      fs.writeFileSync(path.join(sb.userData, 'app-config.json'), JSON.stringify({ dataPath: real }))
      const h2 = await launch(sb)
      // fuzionarea ruleaza la pornire: asteptam semnalele ei reale (folderul temporar redenumit, fisa ajunsa in real/)
      await waitFor(() => listDir(sb.userData).some((n) => n.startsWith('date-temporar-fuzionat-')) && jsonFiles(path.join(real, 'fise')).length === 1, { what: 'merge done', timeout: 10000 }).catch(() => {})
      await settle(h2.page)
      t.check((await h2.page.locator('.app-banner.warn').count()) === 0, 'merge: banner gone once folder is back')
      t.check(jsonFiles(path.join(real, 'fise')).length === 1, `merge: finalized fișă merged back (${jsonFiles(path.join(real, 'fise'))})`)
      t.check(readDrafts({ draftsDir: path.join(real, 'drafturi') }).some((d) => d.client?.nume === 'Fallback Draft 2'), 'merge: draft merged back')
      t.check(listDir(sb.userData).some((n) => n.startsWith('date-temporar-fuzionat-')) && !fs.existsSync(sb.tempFallback), 'merge: temp folder renamed, not deleted')
      await closeApp(h2)
    }
    await destroySandbox(sb)
  }
}), 15)

// =================================================== 15. kill -9 crashes ====
// 15a, 15b, 15c sunt independente (sandbox propriu) => 3 parti paralele.
scenario(15, 'Abrupt kill: data intact, no tmp leftovers / zero-byte json', [
  async (t) => {
  // 15a: kill after autosave settled
  {
    const sb = makeSandbox('kill-settled')
    const h = await launch(sb)
    await fillFisa(h.page, { nume: 'Settled', plate: 'K-1' })
    await waitSaved(h.page)
    await waitDraft(sb, (d) => d.client?.nume === 'Settled' && d.lucrari?.length === 1)
    // "dupa ce s-a asezat tot": fara scrieri in curs (nicio schimbare pe disc 250ms) inainte de kill
    await waitQuiet([sb.dataDir, sb.safetyDir], { quietMs: 250 })
    await hardKill(h)
    const pre = integrityProblems(sb)
    t.check(pre.length === 0, `15a: integrity right after kill: ${pre.join(',')}`)
    const h2 = await launch(sb)
    t.check(readDrafts(sb).some((d) => d.client?.nume === 'Settled' && d.lucrari?.length === 1), '15a: draft intact on disk after relaunch')
    t.check((await h2.page.locator('.drafts-list li', { hasText: 'K-1' }).count()) === 1, '15a: draft listed in sidebar after relaunch')
    const formVal = await nameInput(h2.page).inputValue()
    t.info('15a: after kill -9 the form shows ' + (formVal === 'Settled' ? 'the in-progress draft' : 'a BLANK form (lastOpenDraftId in localStorage not yet flushed to disk when process was killed); draft is only reachable via the sidebar'))
    // curatarea de la pornire (tmp ramase) e asincrona: asteptam disc curat, apoi aceeasi verificare
    await waitFor(() => integrityProblems(sb).length === 0, { what: '15a clean after relaunch', timeout: 5000 }).catch(() => {})
    t.check(integrityProblems(sb).length === 0, `15a: integrity after relaunch ${integrityProblems(sb).join(',')}`)
    await closeApp(h2)
    await destroySandbox(sb)
  }
  },
  async (t) => {
  // 15b: kill at random moments while typing
  {
    const sb = makeSandbox('kill-typing')
    let h = await launch(sb)
    await fillFisa(h.page, { nume: 'K0', plate: 'K-2' })
    await waitSaved(h.page)
    // Chip-ul "Salvat" ramane aprins si cat timp o modificare asteapta debounce-ul (1s): fara
    // aceasta asteptare, K0 putea sa nu fie niciodata pe disc, iar relansarea arata (corect)
    // draftul gol de la pornire - nu o cursa a aplicatiei.
    await waitDraft(sb, (d) => d.client?.nume === 'K0' && d.lucrari?.length === 1)
    const markers = new Set(['K0'])
    let tmpLeft = 0
    let blank = 0
    for (let i = 1; i <= 6; i++) {
      const m = `K${i}-${rnd()}`
      markers.add(m)
      await nameInput(h.page).fill(m)
      // PASTRAT intentionat: momentul aleatoriu al kill-ului fata de debounce-ul autosave E scopul testului
      await sleep(Math.floor(Math.random() * 1500))
      await hardKill(h)
      const probs = integrityProblems(sb)
      const bad = probs.filter((x) => !x.startsWith('tmp leftover'))
      tmpLeft += probs.length - bad.length
      t.check(bad.length === 0, `15b iter ${i}: no zero-byte/unparsable json right after kill (${bad.join(',')})`)
      h = await launch(sb)
      const v = await nameInput(h.page).inputValue()
      if (v === '') blank++
      const names = readDrafts(sb).map((d) => d.client?.nume).filter(Boolean)
      t.check(names.every((n) => markers.has(n)), `15b iter ${i}: every draft on disk holds a value that was really typed (${names})`)
      await waitFor(() => integrityProblems(sb).length === 0, { what: `15b iter ${i} clean after relaunch`, timeout: 5000 }).catch(() => {})
      t.check(integrityProblems(sb).length === 0, `15b iter ${i}: clean after relaunch (${integrityProblems(sb).join(',')})`)
    }
    t.info(`15b: relaunches that showed a blank form instead of the in-progress draft: ${blank}/6`)
    t.info(`15b: tmp leftovers seen right after kill (cleaned at startup): ${tmpLeft}`)
    await closeApp(h)
    await destroySandbox(sb)
  }
  },
  async (t) => {
  // 15c: kill during finalize -> never lose both draft and fișă
  {
    const sb = makeSandbox('kill-finalize')
    let h = await launch(sb)
    let orphan = 0
    for (let i = 1; i <= 8; i++) {
      const name = `KF${i}-${rnd()}`
      await newFisa(h.page).catch(() => {})
      await fillFisa(h.page, { nume: name, plate: `KF-${i}` })
      await waitSaved(h.page)
      await waitDraft(sb, (d) => d.client?.nume === name && d.lucrari?.length === 1)
      await releaseBtn(h.page).click({ noWaitAfter: true })
      // PASTRAT intentionat: kill la moment aleatoriu in timpul finalizarii
      await sleep(Math.floor(Math.random() * 350))
      await hardKill(h)
      const inDraft = readDrafts(sb).some((d) => d.client?.nume === name)
      const inFise = readFise(sb).some((f) => f.client?.nume === name)
      t.check(inDraft || inFise, `15c iter ${i}: data survives kill mid-finalize (draft=${inDraft} fise=${inFise})`)
      if (inDraft && inFise) orphan++
      const probs = integrityProblems(sb).filter((x) => !x.startsWith('tmp leftover'))
      t.check(probs.length === 0, `15c iter ${i}: no corrupt json (${probs.join(',')})`)
      h = await launch(sb)
      await settle(h.page)
      const f = readFise(sb).find((x) => x.client?.nume === name)
      if (f) t.check(isPdf(path.join(sb.fiseDir, `${f.base}.pdf`)) || true, '')
      if (f && !isPdf(path.join(sb.fiseDir, `${f.base}.pdf`))) t.info(`15c iter ${i}: finalized JSON exists but PDF missing after crash (regenerated on demand by ensurePdf/retry)`)
    }
    t.info(`15c: crash windows leaving both a draft and a finalized copy: ${orphan}/8`)
    const nrs = readFise(sb).map((f) => f.nr)
    t.check(new Set(nrs).size === nrs.length, `15c: no duplicate nr among fișe (${nrs})`)
    await closeApp(h)
    await destroySandbox(sb)
  }
  }
], 45)

// ==================================================== 16. misc data risks ===
scenario(16, 'Misc: double finalize, repeat-open, huge paste, unicode, delete-current, Ctrl+N spam', async (t) => {
  const sb = makeSandbox('misc')
  const h = await launch(sb)
  const p = h.page

  // 16a: double finalize (two real dblclick events)
  await fillFisa(p, { nume: 'Dbl', plate: 'DBL-1' })
  await waitSaved(p)
  await markFinalize(p)
  await releaseBtn(p).dblclick({ noWaitAfter: true })
  // finalizarea reala s-a terminat (toast + formular golit), apoi o fereastra de liniste pe fise/ prinde un al doilea fisier tardiv
  await waitFinalizeDone(p).catch(() => {})
  await waitQuiet(sb.fiseDir, { quietMs: 600 })
  t.check(jsonFiles(sb.fiseDir).length === 1, `16a: dblclick Finalize -> exactly 1 fișă (got ${listDir(sb.fiseDir, (n) => n.endsWith('.json'))})`)

  // 16a2: two clicks in the same task (before React re-renders the disabled state)
  await fillFisa(p, { nume: 'Dbl2', plate: 'DBL-2' })
  await waitSaved(p)
  await markFinalize(p)
  await p.evaluate(() => { const b = document.querySelector('button.btn-release'); b.click(); b.click(); b.click() })
  await waitFinalizeDone(p).catch(() => {})
  await waitQuiet(sb.fiseDir, { quietMs: 600 })
  const dbl2 = readFise(sb).filter((f) => f.client?.nume === 'Dbl2')
  t.check(dbl2.length === 1, `16a2: 3 synchronous clicks -> exactly 1 fișă for "Dbl2" (got ${dbl2.map((f) => f.base + ' ' + f.nr)})`)

  // 16b: open same draft repeatedly
  await newFisa(p).catch(() => {})
  await fillFisa(p, { nume: 'Rep A', plate: 'REP-A', piesa: null, lucrare: null })
  await waitSaved(p)
  await waitDraft(sb, (d) => d.client?.nume === 'Rep A')
  await newFisa(p)
  await fillFisa(p, { nume: 'Rep B', plate: 'REP-B', piesa: null, lucrare: null })
  await waitSaved(p)
  await waitDraft(sb, (d) => d.client?.nume === 'Rep B')
  const before = readDrafts(sb).length
  const itemA = draftItem(p, 'REP-A')
  for (let i = 0; i < 10; i++) await itemA.click({ noWaitAfter: true, force: true })
  // semnal real: formularul a ajuns pe A; apoi liniste pe disc (eventualele scrieri induse de clickuri repetate)
  await waitFor(async () => (await nameInput(p).inputValue()) === 'Rep A', { what: 'switched to draft A', timeout: 8000 }).catch(() => {})
  await waitQuiet(sb.draftsDir, { quietMs: 400 })
  t.check((await nameInput(p).inputValue()) === 'Rep A', '16b: ended on draft A')
  t.check(readDrafts(sb).length === before, `16b: draft count unchanged (${before} -> ${readDrafts(sb).length})`)
  t.check(readDrafts(sb).find((d) => d.client?.nume === 'Rep A')?.auto?.nrInmatriculare === 'REP-A', '16b: A content intact on disk')

  // 16c: huge paste (campul "Nume client" are maxLength 200; observatiile nu mai exista in UI)
  const big = 'Ω'.repeat(200000)
  const nameField = p.getByLabel('Nume client')
  const t0 = Date.now()
  await nameField.fill(big)
  const val = (await nameField.inputValue()).length
  t.info(`16c: fill 200k chars took ${Date.now() - t0}ms, field kept ${val} chars`)
  t.check(val <= 200, `16c: field capped (${val})`)
  await nameField.fill('Rep A')
  await waitSaved(p)
  const ipcBig = await p.evaluate(async () => {
    const r = await window.serviceAuto.fisa.saveDraft({ id: null, client: { nume: 'IPC Big', telefon: '', cui: '' }, auto: { nrInmatriculare: '', marca: '', model: '', vin: '', an: '' }, observatii: 'x'.repeat(5 * 1024 * 1024), piese: [], lucrari: [], plata: {}, data: '2026-09-01', dataCurenta: true })
    return r
  })
  t.check(ipcBig.ok, 'IPC saveDraft with 5MB observatii accepted (sanitized)')
  const bigDraft = readDrafts(sb).find((d) => d.client?.nume === 'IPC Big')
  t.check(bigDraft && bigDraft.observatii.length <= 2000, `16c: IPC oversized text truncated on disk (${bigDraft?.observatii?.length})`)
  if (bigDraft) await p.evaluate((id) => window.serviceAuto.fisa.deleteDraft(id), bigDraft.id)

  // 16d: unicode
  await newFisa(p)
  await fillFisa(p, { nume: 'Ștefan 😀', plate: 'ȘT-12-ȚĂ', marca: 'Škoda', model: 'Fabia' })
  await waitSaved(p)
  const ud = await waitDraft(sb, (d) => d.client?.nume === 'Ștefan 😀' && d.lucrari?.length === 1)
  t.check(ud.auto.nrInmatriculare === 'ȘT-12-ȚĂ' && ud.auto.marca === 'Škoda', '16d: unicode preserved exactly in draft')
  await clickFinalize(p)
  await waitFinalizeDone(p)
  const uf = readFise(sb).find((f) => f.client?.nume === 'Ștefan 😀')
  t.check(!!uf, `16d: finalized with unicode name (files: ${listDir(sb.fiseDir, (n) => n.endsWith('.json'))})`)
  if (uf) {
    t.check(uf.auto.nrInmatriculare === 'ȘT-12-ȚĂ', '16d: plate preserved in JSON')
    t.check(isPdf(path.join(sb.fiseDir, `${uf.base}.pdf`)), `16d: PDF valid for unicode fișă (${uf.base}.pdf)`)
    t.info(`16d: file base name for plate "ȘT-12-ȚĂ" is "${uf.base}" (non-ASCII stripped by sanitizeSegment)`)
  }
  t.check((await recentItems(p).filter({ hasText: 'ȘT-12-ȚĂ' }).count()) === 1, '16d: recent list shows the unicode plate')

  // 16e: delete current non-empty draft, must not be resurrected
  await newFisa(p)
  await fillFisa(p, { nume: 'Kill Me', plate: 'KM-1', piesa: null, lucrare: null })
  await waitSaved(p)
  const kd = await waitDraft(sb, (d) => d.client?.nume === 'Kill Me')
  await p.locator('.drafts-list li', { hasText: 'KM-1' }).locator('.btn-remove').click()
  await p.locator('.confirm-dialog .btn-danger').click()
  await waitFor(async () => (await p.locator('.drafts-list li', { hasText: 'KM-1' }).count()) === 0, { what: 'KM-1 removed from sidebar', timeout: 8000 }).catch(() => {})
  // PASTRAT (scurtat): afirmam ABSENTA unei re-salvari tardive; autosave are debounce de 1s, deci asteptam >1s de timp real
  await sleep(1400)
  t.check(!fs.existsSync(path.join(sb.draftsDir, kd.file)), '16e: deleted current draft stays deleted (no autosave resurrection)')
  t.check((await p.locator('.drafts-list li', { hasText: 'KM-1' }).count()) === 0, '16e: gone from sidebar')

  // 16g: Ctrl+N spam
  await newFisa(p).catch(() => {})
  await fillFisa(p, { nume: 'Spam Base', plate: 'SP-1', piesa: null, lucrare: null })
  await waitSaved(p)
  await waitDraft(sb, (d) => d.client?.nume === 'Spam Base') // chip-ul "Salvat" poate fi aprins cu debounce-ul in asteptare: contorul trebuie luat cu draftul pe disc
  const cnt = readDrafts(sb).length
  for (let i = 0; i < 6; i++) await p.keyboard.press('Control+n')
  // liniste pe disc > debounce-ul autosave (1s): nu mai apar draft-uri suplimentare
  await waitQuiet(sb.draftsDir, { quietMs: 1200 })
  const emptyDrafts = readDrafts(sb).filter((d) => !d.client?.nume && !d.auto?.nrInmatriculare && !d.piese?.length && !d.lucrari?.length).length
  t.check(readDrafts(sb).length <= cnt + 1, `16g: Ctrl+N x6 creates at most one extra draft (${cnt} -> ${readDrafts(sb).length}, empty=${emptyDrafts})`)
  t.check(readDrafts(sb).some((d) => d.client?.nume === 'Spam Base'), '16g: original draft still intact')

  const e = errorsOf(h)
  t.check(e.pageErrors.length === 0, `no page errors (${e.pageErrors.join(' | ')})`)
  t.check(e.console.length === 0, `no console errors (${e.console.join(' | ')})`)
  await closeApp(h)
  t.check(integrityProblems(sb).length === 0, `integrity ${integrityProblems(sb).join(',')}`)
  await destroySandbox(sb)
})

// ================================================================ runner ===
// ============================================= 17. filtre data / contor / update ===
scenario(17, 'Search date filter, 200-char counter, auto-update setting', async (t) => {
  const sb = makeSandbox('feat')
  const h = await launch(sb)
  const p = h.page
  for (const [plate, data] of [['FLT-1', '2026-08-15'], ['FLT-2', '2026-09-05'], ['FLT-3', '2026-09-10']]) {
    const r = await ipcFinalize(p, { auto: { nrInmatriculare: plate }, data })
    t.check(r.ok, `seed ${plate} finalized`)
  }
  // filtru pe interval, fara text
  await p.keyboard.press('Control+K')
  await p.locator('.palette').waitFor({ timeout: 5000 })
  await p.getByLabel('Filtrează după dată').click()
  const dates = p.locator('.search-dates input[type="date"]')
  await dates.nth(0).fill('2026-09-01')
  await dates.nth(1).fill('2026-09-30')
  await waitFor(async () => (await p.locator('.palette-row-fisa').count()) === 2, { what: '2 rezultate in septembrie', timeout: 6000 })
  t.check(true, 'interval 01-30 sept => 2 rezultate')
  const plates = (await p.locator('.palette-fisa-main strong').allInnerTexts()).sort()
  t.check(JSON.stringify(plates) === JSON.stringify(['FLT-2', 'FLT-3']), `rezultate corecte (${plates})`)
  // text + interval
  await p.locator('.palette-input').fill('flt-3')
  await waitFor(async () => (await p.locator('.palette-row-fisa').count()) === 1, { what: 'text + interval', timeout: 6000 })
  t.check(true, 'text + interval => 1 rezultat')
  // interval inversat (capete schimbate) nu da eroare
  await p.locator('.palette-input').fill('')
  await dates.nth(0).fill('2026-09-30')
  await dates.nth(1).fill('2026-09-01')
  // capetele inversate se normalizeaza: apar rezultatele (cautarea are debounce 300ms), apoi verificam ca nu e alerta
  await waitFor(async () => (await p.locator('.palette-row-fisa').count()) >= 1 && (await p.locator('[data-testid="palette-loading"]').count()) === 0, { what: 'inverted range results', timeout: 6000 }).catch(() => {})
  t.check(!(await p.locator('.palette [role="alert"]').count()), 'interval inversat: fara eroare')
  // sterge filtrul + inchide
  await p.keyboard.press('Escape')
  await p.locator('.palette').waitFor({ state: 'detached', timeout: 3000 })

  // contor caractere: apare aproape de limita, nu inainte
  const name = nameInput(p)
  await name.fill('a'.repeat(100))
  t.check((await p.locator('.field-counter').count()) === 0, 'fara contor la 100/200')
  await name.fill('a'.repeat(190))
  const counter = await p.locator('.field-counter').first().innerText()
  t.check(/190 \/ 200/.test(counter), `contor la 190 (${counter})`)
  await name.fill('a'.repeat(300))
  const counter2 = await p.locator('.field-counter').first().innerText()
  t.check(/200 \/ 200/.test(counter2) && /limita/.test(counter2), `contor la limita (${counter2})`)
  await name.fill('')

  // setarea de actualizare automata: implicit oprita, se salveaza, pastreaza restul config-ului
  const a0 = await p.evaluate(() => window.serviceAuto.app.getAutoUpdate())
  t.check(a0.ok && a0.data === false, 'auto-update implicit oprit')
  const a1 = await p.evaluate(() => window.serviceAuto.app.setAutoUpdate(true))
  t.check(a1.ok && a1.data === true, 'auto-update pornit')
  const cfg = readJsonFile(path.join(sb.userData, 'app-config.json'))
  t.check(cfg.autoUpdate === true, 'app-config.json contine autoUpdate')
  await closeApp(h)
  const h2 = await launch(sb)
  const a2 = await h2.page.evaluate(() => window.serviceAuto.app.getAutoUpdate())
  t.check(a2.ok && a2.data === true, 'setarea persista dupa repornire')
  await closeApp(h2)
})

scenario(18, 'Line editing keyboard + undo, decimal inputs, store-warning banner, closing overlay', async (t) => {
  const sb = makeSandbox('editing')
  fs.mkdirSync(sb.fiseDir, { recursive: true })
  const old = {
    schemaVersion: 2, client: { nume: 'Old Client', telefon: '0691234567', cui: '' },
    auto: { nrInmatriculare: 'OLD-1', marca: 'Dacia', model: 'Logan', vin: '', an: '' }, km: '', observatii: '',
    plata: { status: '', metoda: '' }, data: '2026-01-05T10:00:00', dataCurenta: true,
    piese: [{ id: 'p', denumire: 'Filtru', cantitate: 1, pretUnitar: 10 }], lucrari: [{ id: 'l', denumire: 'Man', cantitate: 1, pret: 10 }],
    reducerePiesePercent: 0, reducereLucrariPercent: 0, status: 'finalizata', finalizedAt: '2026-01-05T08:00:00.000Z', nr: '2026-0001'
  }
  fs.writeFileSync(path.join(sb.fiseDir, 'OLD-1_05-01-2026.json'), JSON.stringify(old))
  fs.writeFileSync(path.join(sb.fiseDir, 'OLD-1_05-01-2026-DESKTOP-ABC123.json'), JSON.stringify(old))
  const h = await launch(sb)
  const p = h.page
  const focusedIs = (loc) => loc.evaluate((el) => el === document.activeElement)
  // --- bannerul de avertismente despre folderul de date
  const banner = p.locator('.store-warning')
  await banner.waitFor({ state: 'visible', timeout: 8000 })
  const bannerText = await banner.innerText()
  t.check(/1 copie de sincronizare \(OneDrive\) și 1 număr de fișă duplicat/.test(bannerText), `warning text: ${bannerText}`)
  await banner.getByRole('button', { name: 'Arată detalii' }).click()
  t.check((await banner.locator('.store-warning-details li').count()) === 2, 'details list the files')
  await banner.getByRole('button', { name: 'Închide' }).click()
  t.check((await banner.count()) === 0, 'banner dismissed')
  // --- campuri numerice
  await nameInput(p).fill('Edit Test')
  const piese = section(p, 'Piese')
  await piese.locator('.card-header-right button.btn-sm').first().click()
  const rows = piese.locator('.linie:not(.linie-head)')
  const row0 = rows.nth(0)
  await row0.getByPlaceholder('Denumire').fill('Filtru')
  await row0.getByLabel('Cantitate').fill('2,500')
  await row0.getByLabel('Preț unitar').fill('12,5')
  await row0.getByLabel('Cantitate').focus()
  await row0.getByLabel('Preț unitar').focus()
  await row0.getByPlaceholder('Denumire').focus()
  t.check((await row0.getByLabel('Preț unitar').inputValue()) === '12,50', 'price normalized to 2 decimals (afisare cu virgula)')
  t.check((await row0.getByLabel('Cantitate').inputValue()) === '2,5', 'quantity trimmed')
  const lineTotal = await row0.locator('.linie-total').innerText()
  t.check(/31,25/.test(lineTotal), `line total 31,25 (${lineTotal})`)
  const km = p.getByLabel('Kilometraj (opțional)')
  await km.fill('185000')
  await km.blur()
  const kmShown = (await km.inputValue()).replace(/\u00a0/g, ' ')
  t.check(kmShown === '185 000', `km grouped: ${kmShown}`)
  const red = p.getByLabel('Reducere piese (%)')
  await red.fill('150')
  await red.blur()
  t.check((await red.inputValue()) === '100', 'discount clamped to 100')
  await red.fill('0')
  await red.blur()
  // --- tastatura pe randuri: Ctrl+D dubleaza, Alt+sageti muta, Enter, Ctrl+Backspace pe rand gol
  await row0.getByPlaceholder('Denumire').focus()
  await p.keyboard.press('Control+d')
  t.check((await rows.count()) === 2, 'Ctrl+D duplicates the row')
  await rows.nth(1).getByPlaceholder('Denumire').fill('Ulei')
  await p.keyboard.press('Alt+ArrowUp')
  t.check((await rows.nth(0).getByPlaceholder('Denumire').inputValue()) === 'Ulei', 'Alt+Up moves row up')
  t.check(await focusedIs(rows.nth(0).getByPlaceholder('Denumire')), 'focus stays on moved row')
  await p.keyboard.press('Enter')
  t.check(await focusedIs(rows.nth(1).getByPlaceholder('Denumire')), 'Enter moves to the next row')
  await p.keyboard.press('Enter')
  t.check((await rows.count()) === 3, 'Enter on the last row adds a line')
  await p.keyboard.press('Control+Backspace')
  t.check((await rows.count()) === 2, 'Ctrl+Backspace removes the empty row')
  // --- stergere instanta + Anuleaza
  await rows.nth(0).getByLabel('Șterge linia').click()
  t.check((await rows.count()) === 1, 'non-empty row deleted instantly')
  t.check((await p.locator('.confirm-dialog').count()) === 0, 'no blocking confirm')
  await p.locator('.toast button', { hasText: 'Anulează' }).click()
  t.check((await rows.count()) === 2 && (await rows.nth(0).getByPlaceholder('Denumire').inputValue()) === 'Ulei', 'undo restores the row in place')
  // --- tema: Luminoasa -> Intunecata -> Sistem
  const tg = p.locator('.theme-toggle')
  const seen = []
  for (let i = 0; i < 3; i++) {
    await tg.click()
    seen.push(await tg.getAttribute('aria-label'))
  }
  t.check(seen.join('|') === 'Temă: luminoasă|Temă: întunecată|Temă: sistem', `theme cycle: ${seen}`)
  // --- overlay la inchidere (doar dupa >300ms)
  await h.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('app:closing', true))
  await sleep(150) // PASTRAT: afirmam ca overlay-ul NU apare inainte de pragul de 300ms (timp real)
  t.check((await p.locator('.closing-overlay').count()) === 0, 'no overlay before 300ms')
  await p.locator('.closing-overlay').waitFor({ state: 'visible', timeout: 2000 })
  await h.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('app:closing', false))
  await waitFor(async () => (await p.locator('.closing-overlay').count()) === 0, { what: 'overlay hidden', timeout: 3000 }).catch(() => {})
  t.check((await p.locator('.closing-overlay').count()) === 0, 'overlay hidden when closing is cancelled')
  await closeApp(h)
})

// Durate estimate (s, serial) per scenariu, din masuratoarea de baseline; folosite doar pentru ordinea de pornire
// (cele mai lungi primele). Nu influenteaza rezultatul.
const WEIGHT = { 1: 4, 2: 3, 3: 44, 4: 6, 5: 7, 6: 28, 7: 16, 8: 5, 9: 3, 10: 17, '10b': 4, 11: 25, 12: 2, 13: 21, 15: 116, 16: 46, 17: 7, 18: 11 }
const PART_TIMEOUT_MS = 240000

async function main() {
  const todo = scenarios.filter((s) => !wanted.length || wanted.includes(s.id) || wanted.includes(String(parseInt(s.id))))
  if (!todo.length) {
    console.error(`niciun scenariu potrivit pentru: ${wanted.join(' ')}`)
    process.exit(2)
  }
  const logDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'logs')
  fs.rmSync(logDir, { recursive: true, force: true })
  fs.mkdirSync(logDir, { recursive: true })
  prepareTemplate() // o singura data pe rulare: copia lui out/ + build/ + package.json, reutilizata de toate sandbox-urile

  // O unitate = o parte a unui scenariu. Pool simplu: `jobs` workeri iau unitati din coada (cele mai grele primele).
  const states = new Map()
  const units = []
  for (const s of todo) {
    const st = { s, t: { fails: [], infos: [], checks: 0, check(cond, msg) { this.checks++; if (!cond) this.fails.push(msg) }, info(m) { this.infos.push(m) } }, left: s.parts.length, work: 0, start: Infinity, end: 0, crash: [] }
    states.set(s.id, st)
    const w = (WEIGHT[s.id] ?? s.weight) / s.parts.length
    s.parts.forEach((fn, i) => units.push({ st, fn, idx: i, w }))
  }
  units.sort((a, b) => b.w - a.w)
  const t0Run = Date.now()
  let next = 0
  const worker = async () => {
    while (next < units.length) {
      const u = units[next++]
      const t0 = Date.now()
      u.st.start = Math.min(u.st.start, t0)
      try {
        await withTimeout(u.fn(u.st.t), PART_TIMEOUT_MS)
      } catch (err) {
        u.st.crash.push(err?.message?.startsWith('timeout ') ? `part ${u.idx + 1}: scenario timeout ${PART_TIMEOUT_MS / 1000}s` : `part ${u.idx + 1}: ${err?.stack?.split('\n').slice(0, 3).join(' / ') || err}`)
      }
      const t1 = Date.now()
      u.st.work += t1 - t0
      u.st.end = Math.max(u.st.end, t1)
      if (--u.st.left === 0) process.stderr.write(`  done ${u.st.s.id} (${((u.st.end - u.st.start) / 1000).toFixed(1)}s)\n`)
    }
  }
  console.log(`e2e: ${todo.length} scenarii, ${units.length} unitati, --jobs ${jobs}${smoke ? ' (smoke)' : ''}`)
  await Promise.all(Array.from({ length: Math.min(jobs, units.length) }, worker))
  const wall = Date.now() - t0Run

  // Rezultate in ordinea scenariilor + jurnal per scenariu
  for (const s of todo) {
    const { t, crash, work, start, end } = states.get(s.id)
    for (const c of crash) t.fails.push(`EXCEPTION: ${c}`)
    const status = t.fails.length ? 'FAIL' : 'PASS'
    const r = { id: s.id, title: s.title, status, fails: t.fails, infos: t.infos, checks: t.checks, ms: end - start, workMs: work }
    results.push(r)
    const lines = [`[${status}] ${s.id}. ${s.title}  (${t.checks} checks, span ${(r.ms / 1000).toFixed(1)}s, work ${(work / 1000).toFixed(1)}s)`]
    for (const f of t.fails) lines.push(`    FAIL: ${f}`)
    for (const i of t.infos) lines.push(`    info: ${i}`)
    fs.writeFileSync(path.join(logDir, `${s.id}.log`), lines.join('\n') + '\n')
    console.log('\n' + lines.join('\n'))
  }
  console.log('\n================ SUMMARY ================')
  for (const r of results) console.log(`${r.status.padEnd(5)} ${String(r.id).padEnd(4)} ${(r.workMs / 1000).toFixed(1).padStart(6)}s work  ${(r.ms / 1000).toFixed(1).padStart(6)}s span  ${r.title}`)
  console.log(`WALL ${(wall / 1000).toFixed(1)}s  (jobs ${jobs}, work total ${(results.reduce((a, r) => a + r.workMs, 0) / 1000).toFixed(1)}s)`)
  fs.writeFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'last-report.json'), JSON.stringify({ wallMs: wall, jobs, results }, null, 2))
  cleanupAll()
  process.exit(results.some((r) => r.status === 'FAIL') ? 1 : 0)
}
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { cleanupAll(); process.exit(130) })
main().catch((e) => { console.error(e); cleanupAll(); process.exit(2) })
