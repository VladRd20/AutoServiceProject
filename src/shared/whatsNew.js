// "Ce e nou" - lista schimbarilor pe care le vede UTILIZATORUL, afisata o singura
// data dupa fiecare actualizare (si oricand din meniul "Ce e nou").
//
// REGULI (verificate de tests/whatsnew.test.js):
//  * Doar ce se vede sau se simte in aplicatie: functii noi, ecrane, mesaje,
//    comportamente schimbate, probleme rezolvate pe care utilizatorul le-ar fi
//    observat. NIMIC despre cod, teste, dependente, refactorizari, CI, backend.
//  * Text scurt, in romana, la persoana a II-a, fara jargon ("fisiere JSON",
//    "cache", "IPC", "migrare" etc. nu au ce cauta aici).
//  * Cea mai noua versiune prima. La fiecare versiune noua (package.json) se
//    adauga aici o intrare - altfel testele pica si versiunea nu se poate publica.
//  * `tip`: 'nou' (functie noua) | 'imbunatatit' | 'rezolvat'.

export const WHATS_NEW = [
  {
    version: '0.7.1',
    date: '2026-09-21',
    titlu: 'Actualizări mai simple, aspect mai unitar',
    items: [
      { tip: 'nou', text: 'Aplicația caută singură versiuni noi, la câteva minute, și te anunță printr-un banner când găsește una. Nu mai trebuie să cauți tu manual.' },
      { tip: 'imbunatatit', text: 'Verificarea manuală a actualizărilor s-a mutat în Setări → Actualizări, unde vezi și versiunea curentă. În bara de sus apare un buton doar când există o actualizare de instalat.' },
      { tip: 'imbunatatit', text: 'Bara ferestrei are acum aceeași temă ca aplicația, în modul deschis și în cel închis.' },
      { tip: 'imbunatatit', text: 'Numărul de înmatriculare are un câmp propriu, cu drapelul Moldovei, în formatul ABC 123.' }
    ]
  },
  {
    version: '0.7.0',
    date: '2026-09-20',
    titlu: 'Mai sigur, mai ușor de folosit',
    items: [
      { tip: 'nou', text: 'Fișele se salvează acum și la închiderea aplicației și când treci pe altă fișă — nu se mai pierd ultimele modificări.' },
      { tip: 'nou', text: 'Fișele șterse ajung în Coșul de gunoi timp de 30 de zile. Le poți recupera imediat cu „Anulează” sau din Setări.' },
      { tip: 'nou', text: 'Fiecare fișă finalizată primește un număr de ordine (de ex. 2026-0001), afișat pe PDF și în căutare.' },
      { tip: 'nou', text: 'Căutare după dată: alegi un interval sau o perioadă rapidă (Luna aceasta, Luna trecută…), cu sau fără text.' },
      { tip: 'nou', text: 'Rapoartele au un interval de date la alegere, iar exportul CSV pentru contabil folosește același interval.' },
      { tip: 'nou', text: 'Câmpuri noi pe fișă: kilometraj și CUI/IDNO pentru clienții firmă.' },
      { tip: 'nou', text: 'Backup și restaurare în Setări: backup imediat, export într-un fișier (de ex. pe stick) și restaurare, fără să se suprascrie fișele existente.' },
      { tip: 'nou', text: 'Setare pentru actualizări automate: se descarcă în fundal și se instalează când închizi aplicația.' },
      { tip: 'imbunatatit', text: 'Dacă o fișă se strică sau dispare din greșeală, aplicația o reface automat din backup și te anunță.' },
      { tip: 'imbunatatit', text: 'Dacă folderul cu fișe (stick, rețea) nu e disponibil, poți lucra în continuare; datele se aduc înapoi automat când revine.' },
      { tip: 'imbunatatit', text: 'Se arată câte caractere mai ai într-un câmp când te apropii de limită.' },
      { tip: 'imbunatatit', text: 'Dacă licența este revocată, aplicația trece în mod doar-citire: îți poți vedea, tipări și exporta în continuare fișele.' },
      { tip: 'rezolvat', text: 'Anularea tipăririi nu mai afișează o eroare.' },
      { tip: 'rezolvat', text: 'Editarea unei fișe mai vechi nu îi mai schimbă data.' },
      { tip: 'rezolvat', text: 'Numerele de înmatriculare cu diacritice (ȘT-12-ȚĂ) apar corect în numele fișierelor.' }
    ]
  }
]

// ---- logica (pura, testata) -------------------------------------------------

export function parseVersion(v) {
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(String(v || '').trim())
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null
}

// -1 / 0 / 1; o versiune invalida se considera cea mai veche.
export function compareVersions(a, b) {
  const pa = parseVersion(a)
  const pb = parseVersion(b)
  if (!pa && !pb) return 0
  if (!pa) return -1
  if (!pb) return 1
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] < pb[i] ? -1 : 1
  return 0
}

// Intrarile de afisat: mai noi decat `lastSeen` si nu mai noi decat versiunea
// instalata (o intrare "din viitor", pregatita in avans, nu se arata inca).
// Cele mai noi primele. lastSeen gol => doar intrarea versiunii curente.
export function entriesToShow(current, lastSeen, all = WHATS_NEW) {
  const upTo = all.filter((e) => compareVersions(e.version, current) <= 0)
  const sorted = [...upTo].sort((a, b) => compareVersions(b.version, a.version))
  if (!lastSeen) return sorted.filter((e) => compareVersions(e.version, current) === 0)
  return sorted.filter((e) => compareVersions(e.version, lastSeen) > 0)
}

// Ultimele `n` intrari (pentru meniul "Ce e nou"), indiferent de ce s-a vazut.
export function recentEntries(current, n = 5, all = WHATS_NEW) {
  return [...all]
    .filter((e) => compareVersions(e.version, current) <= 0)
    .sort((a, b) => compareVersions(b.version, a.version))
    .slice(0, n)
}
