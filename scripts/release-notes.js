// Genereaza notele publice ale unei versiuni (Markdown) din src/shared/whatsNew.js -
// aceeasi lista pe care o vede utilizatorul in fereastra "Ce e nou", ca notele
// din GitHub Release (si bannerul de actualizare) sa nu spuna altceva.
//
//   node scripts/release-notes.js 0.7.0 > notes.md
const fs = require('fs')
const path = require('path')

const TIP = { nou: 'Nou', imbunatatit: 'Îmbunătățit', rezolvat: 'Rezolvat' }

function loadEntries() {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'shared', 'whatsNew.js'), 'utf8')
  // fisierul e ESM simplu (fara importuri): il evaluam fara "export"
  const body = src.replace(/^export\s+/gm, '')
  return new Function(`${body}\nreturn WHATS_NEW`)()
}

function notesFor(version, entries = loadEntries()) {
  const entry = entries.find((e) => e.version === version)
  if (!entry) return null
  const lines = [entry.titlu || `Versiunea ${entry.version}`, '']
  for (const item of entry.items) lines.push(`- **${TIP[item.tip] || 'Nou'}:** ${item.text}`)
  return lines.join('\n') + '\n'
}

module.exports = { notesFor, loadEntries }

if (require.main === module) {
  const version = String(process.argv[2] || '').replace(/^v/, '')
  const notes = notesFor(version)
  if (!notes) {
    console.error(`Nu exista intrare "Ce e nou" pentru versiunea ${version} in src/shared/whatsNew.js`)
    process.exit(1)
  }
  process.stdout.write(notes)
}
