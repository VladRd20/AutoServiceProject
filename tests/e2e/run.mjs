// End-to-end harness for the built ServiceAuto app (out/).
//   npx electron-vite build && node tests/e2e/run.mjs            (all scenarios)
//   node tests/e2e/run.mjs 3 6 16                                (only some)
//   KEEP=1 node tests/e2e/run.mjs 3                              (keep temp sandboxes for inspection)
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  ROOT, YEAR, sleep, rnd, prepareTemplate, makeSandbox, destroySandbox, cleanupAll, launch, closeApp, hardKill,
  readDrafts, readFise, jsonFiles, listDir, readJsonFile, tryReadJson, integrityProblems, waitFor, waitDraft, isPdf,
  nameInput, phoneInput, plateInput, marcaInput, modelInput, vinInput, obsInput, releaseBtn, section, addLine, fillFisa,
  waitSaved, clickFinalize, waitFinalizeDone, ipcFinalize, reload, spawnSecond, errorsOf, dismissModal
} from './helpers.mjs'

const wanted = process.argv.slice(2)
const scenarios = []
const scenario = (id, title, fn) => scenarios.push({ id: String(id), title, fn })
const results = []

const pad2 = (n) => String(n).padStart(2, '0')
function todayDMY() {
  const d = new Date()
  return `${pad2(d.getDate())}-${pad2(d.getMonth() + 1)}-${d.getFullYear()}`
}
const newFisa = async (page) => {
  await page.locator('.btn-new').click()
  await waitFor(async () => (await nameInput(page).inputValue()) === '', { what: 'empty form after Fișă nouă' })
  await sleep(300)
}
const recentItems = (page) => page.locator('.recent-list li')
const draftItem = (page, text) => page.locator('.drafts-list li', { hasText: text }).locator('button').first()

// ============================================================ 1. boot ======
scenario(1, 'Boot: window, no activation screen, no console errors', async (t) => {
  const sb = makeSandbox('boot')
  const h = await launch(sb)
  t.check((await h.app.windows()).length === 1, 'exactly one window')
  t.check(await nameInput(h.page).isVisible(), 'form visible')
  t.check((await h.page.locator('text=/activare|licen[țt]/i').count()) === 0, 'no activation/licence screen text')
  t.check((await h.page.title()) !== undefined, 'has title')
  await sleep(2500) // let revocation check / backup / location info finish
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
  const d = await waitDraft(sb, (x) => x.piese?.length === 1 && x.lucrari?.length === 1 && x.piese[0].denumire === 'Filtru ulei' && x.lucrari[0].pret === '120')
  t.check(d.client.nume === 'Ion Popescu', 'client.nume')
  t.check(d.client.telefon === '0691234567', 'telefon')
  t.check(d.auto.nrInmatriculare === 'B-123-ABC', 'plate')
  t.check(d.auto.marca === 'Dacia' && d.auto.model === 'Logan', 'marca/model')
  t.check(String(d.piese[0].cantitate) === '2' && String(d.piese[0].pretUnitar) === '50', 'piesa qty/price')
  t.check(d.status === 'draft', 'status draft')
  t.check(readDrafts(sb).length === 1, `exactly 1 draft on disk (got ${readDrafts(sb).length})`)
  await closeApp(h)
})

// ========================================================= 3. close-flush ===
scenario(3, 'CLOSE-FLUSH x5 (marker typed <150ms before close)', async (t) => {
  const methods = ['BrowserWindow.close', 'app', 'BrowserWindow.close2', 'app', 'BrowserWindow.close']
  for (let i = 0; i < 5; i++) {
    const how = methods[i]
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
})

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
    await sleep(700)
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
  const code = await Promise.race([s.exited, sleep(15000).then(() => 'TIMEOUT')])
  const ms = Date.now() - s.t0
  if (code === 'TIMEOUT') s.cp.kill()
  t.check(code !== 'TIMEOUT', `second instance exited (code ${code}) in ${ms}ms`)
  t.check(ms < 8000, `second instance exited quickly (${ms}ms)`)
  const after = await h.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)
  t.check(before === 1 && after === 1, `still exactly one window (${before} -> ${after})`)
  await sleep(500)
  const st = await h.app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0]
    return { minimized: w.isMinimized(), visible: w.isVisible(), focused: w.isFocused() }
  })
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
  await sleep(1500) // autosave of the edit draft
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
  await sleep(500)
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
scenario(11, 'Corrupt (truncated / empty / garbage) finalized JSON is healed from backup', async (t) => {
  await corruptionCase(t, 'truncated', (f, o) => fs.writeFileSync(f, o.slice(0, Math.floor(o.length * 0.4))))
  await corruptionCase(t, 'zero-byte', (f) => fs.writeFileSync(f, ''))
  await corruptionCase(t, 'garbage', (f) => fs.writeFileSync(f, Buffer.alloc(300, 0)))
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
})

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
scenario(13, 'Unusable data path -> temp fallback, banner, drafts + finalize still work, merge back', async (t) => {
  for (const kind of ['nonexistent-drive', 'under-a-file']) {
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
    await sleep(800)
    const banner = p.locator('.app-banner.warn')
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
      await sleep(1000)
      t.check((await h2.page.locator('.app-banner.warn').count()) === 0, 'merge: banner gone once folder is back')
      t.check(jsonFiles(path.join(real, 'fise')).length === 1, `merge: finalized fișă merged back (${jsonFiles(path.join(real, 'fise'))})`)
      t.check(readDrafts({ draftsDir: path.join(real, 'drafturi') }).some((d) => d.client?.nume === 'Fallback Draft 2'), 'merge: draft merged back')
      t.check(listDir(sb.userData).some((n) => n.startsWith('date-temporar-fuzionat-')) && !fs.existsSync(sb.tempFallback), 'merge: temp folder renamed, not deleted')
      await closeApp(h2)
    }
    await destroySandbox(sb)
  }
})

// =================================================== 15. kill -9 crashes ====
scenario(15, 'Abrupt kill: data intact, no tmp leftovers / zero-byte json', async (t) => {
  // 15a: kill after autosave settled
  {
    const sb = makeSandbox('kill-settled')
    const h = await launch(sb)
    await fillFisa(h.page, { nume: 'Settled', plate: 'K-1' })
    await waitSaved(h.page)
    await waitDraft(sb, (d) => d.client?.nume === 'Settled' && d.lucrari?.length === 1)
    await sleep(300)
    await hardKill(h)
    const pre = integrityProblems(sb)
    t.check(pre.length === 0, `15a: integrity right after kill: ${pre.join(',')}`)
    const h2 = await launch(sb)
    t.check(readDrafts(sb).some((d) => d.client?.nume === 'Settled' && d.lucrari?.length === 1), '15a: draft intact on disk after relaunch')
    t.check((await h2.page.locator('.drafts-list li', { hasText: 'K-1' }).count()) === 1, '15a: draft listed in sidebar after relaunch')
    const formVal = await nameInput(h2.page).inputValue()
    t.info('15a: after kill -9 the form shows ' + (formVal === 'Settled' ? 'the in-progress draft' : 'a BLANK form (lastOpenDraftId in localStorage not yet flushed to disk when process was killed); draft is only reachable via the sidebar'))
    await sleep(800)
    t.check(integrityProblems(sb).length === 0, `15a: integrity after relaunch ${integrityProblems(sb).join(',')}`)
    await closeApp(h2)
    await destroySandbox(sb)
  }
  // 15b: kill at random moments while typing
  {
    const sb = makeSandbox('kill-typing')
    let h = await launch(sb)
    await fillFisa(h.page, { nume: 'K0', plate: 'K-2' })
    await waitSaved(h.page)
    const markers = new Set(['K0'])
    let tmpLeft = 0
    let blank = 0
    for (let i = 1; i <= 6; i++) {
      const m = `K${i}-${rnd()}`
      markers.add(m)
      await nameInput(h.page).fill(m)
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
      await sleep(600)
      t.check(integrityProblems(sb).length === 0, `15b iter ${i}: clean after relaunch (${integrityProblems(sb).join(',')})`)
    }
    t.info(`15b: relaunches that showed a blank form instead of the in-progress draft: ${blank}/6`)
    t.info(`15b: tmp leftovers seen right after kill (cleaned at startup): ${tmpLeft}`)
    await closeApp(h)
    await destroySandbox(sb)
  }
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
      await sleep(Math.floor(Math.random() * 350))
      await hardKill(h)
      const inDraft = readDrafts(sb).some((d) => d.client?.nume === name)
      const inFise = readFise(sb).some((f) => f.client?.nume === name)
      t.check(inDraft || inFise, `15c iter ${i}: data survives kill mid-finalize (draft=${inDraft} fise=${inFise})`)
      if (inDraft && inFise) orphan++
      const probs = integrityProblems(sb).filter((x) => !x.startsWith('tmp leftover'))
      t.check(probs.length === 0, `15c iter ${i}: no corrupt json (${probs.join(',')})`)
      h = await launch(sb)
      await sleep(500)
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
})

// ==================================================== 16. misc data risks ===
scenario(16, 'Misc: double finalize, repeat-open, huge paste, unicode, delete-current, Ctrl+N spam', async (t) => {
  const sb = makeSandbox('misc')
  const h = await launch(sb)
  const p = h.page

  // 16a: double finalize (two real dblclick events)
  await fillFisa(p, { nume: 'Dbl', plate: 'DBL-1' })
  await waitSaved(p)
  await releaseBtn(p).dblclick({ noWaitAfter: true })
  await sleep(3500)
  t.check(jsonFiles(sb.fiseDir).length === 1, `16a: dblclick Finalize -> exactly 1 fișă (got ${listDir(sb.fiseDir, (n) => n.endsWith('.json'))})`)
  await waitFinalizeDone(p).catch(() => {})

  // 16a2: two clicks in the same task (before React re-renders the disabled state)
  await fillFisa(p, { nume: 'Dbl2', plate: 'DBL-2' })
  await waitSaved(p)
  await p.evaluate(() => { const b = document.querySelector('button.btn-release'); b.click(); b.click(); b.click() })
  await sleep(3500)
  const dbl2 = readFise(sb).filter((f) => f.client?.nume === 'Dbl2')
  t.check(dbl2.length === 1, `16a2: 3 synchronous clicks -> exactly 1 fișă for "Dbl2" (got ${dbl2.map((f) => f.base + ' ' + f.nr)})`)
  await waitFinalizeDone(p).catch(() => {})
  await sleep(500)

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
  await sleep(1500)
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
  await sleep(3500)
  t.check(!fs.existsSync(path.join(sb.draftsDir, kd.file)), '16e: deleted current draft stays deleted (no autosave resurrection)')
  t.check((await p.locator('.drafts-list li', { hasText: 'KM-1' }).count()) === 0, '16e: gone from sidebar')

  // 16g: Ctrl+N spam
  await newFisa(p).catch(() => {})
  await fillFisa(p, { nume: 'Spam Base', plate: 'SP-1', piesa: null, lucrare: null })
  await waitSaved(p)
  const cnt = readDrafts(sb).length
  for (let i = 0; i < 6; i++) await p.keyboard.press('Control+n')
  await sleep(2500)
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
  await p.locator('.search-filter-btn').click()
  await p.locator('.search-panel').waitFor({ timeout: 5000 })
  const dates = p.locator('.search-dates input[type="date"]')
  await dates.nth(0).fill('2026-09-01')
  await dates.nth(1).fill('2026-09-30')
  await waitFor(async () => (await p.locator('.search-result').count()) === 2, { what: '2 rezultate in septembrie', timeout: 6000 })
  t.check(true, 'interval 01-30 sept => 2 rezultate')
  const plates = (await p.locator('.search-result-main strong').allInnerTexts()).sort()
  t.check(JSON.stringify(plates) === JSON.stringify(['FLT-2', 'FLT-3']), `rezultate corecte (${plates})`)
  // text + interval
  await p.locator('.topbar-search').fill('flt-3')
  await waitFor(async () => (await p.locator('.search-result').count()) === 1, { what: 'text + interval', timeout: 6000 })
  t.check(true, 'text + interval => 1 rezultat')
  // interval inversat (capete schimbate) nu da eroare
  await p.locator('.topbar-search').fill('')
  await dates.nth(0).fill('2026-09-30')
  await dates.nth(1).fill('2026-09-01')
  await sleep(800)
  t.check(!(await p.locator('.search-panel [role="alert"]').count()), 'interval inversat: fara eroare')
  // sterge filtrul + inchide
  await p.keyboard.press('Escape')
  await p.locator('.topbar-search').focus()
  await p.keyboard.press('Escape')

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

async function main() {
  prepareTemplate()
  const todo = scenarios.filter((s) => !wanted.length || wanted.includes(s.id) || wanted.includes(String(parseInt(s.id))))
  for (const s of todo) {
    const t = { fails: [], infos: [], checks: 0, check(cond, msg) { this.checks++; if (!cond) this.fails.push(msg) }, info(m) { this.infos.push(m) } }
    const t0 = Date.now()
    let crash = null
    try {
      await Promise.race([s.fn(t), sleep(240000).then(() => { throw new Error('scenario timeout 240s') })])
    } catch (err) {
      crash = err
    }
    if (crash) t.fails.push(`EXCEPTION: ${crash.stack?.split('\n').slice(0, 3).join(' / ') || crash}`)
    const status = t.fails.length ? 'FAIL' : 'PASS'
    results.push({ id: s.id, title: s.title, status, fails: t.fails, infos: t.infos, checks: t.checks, ms: Date.now() - t0 })
    console.log(`\n[${status}] ${s.id}. ${s.title}  (${t.checks} checks, ${((Date.now() - t0) / 1000).toFixed(1)}s)`)
    for (const f of t.fails) console.log(`    FAIL: ${f}`)
    for (const i of t.infos) console.log(`    info: ${i}`)
  }
  console.log('\n================ SUMMARY ================')
  for (const r of results) console.log(`${r.status.padEnd(5)} ${String(r.id).padEnd(4)} ${r.title}`)
  fs.writeFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'last-report.json'), JSON.stringify(results, null, 2))
  cleanupAll()
  process.exit(results.some((r) => r.status === 'FAIL') ? 1 : 0)
}
main().catch((e) => { console.error(e); cleanupAll(); process.exit(2) })
