// electron-builder decide ce pachete din node_modules ajung in build uitandu-se
// daca fiecare dependinta e "co-locata" langa pachetul care o cere
// (node_modules/<cerut de>/node_modules/<pachet>). Cand npm rezolva o
// dependinta prin hoisting la radacina node_modules (foarte comun pentru
// pachete mici, folosite de mai multe altele), electron-builder nu o
// recunoaste si o exclude din build -> "Cannot find module" doar in
// aplicatia instalata, nu si in dezvoltare (unde Node rezolva normal prin
// urcare in arborele de foldere).
//
// Acest script copiaza manual, dupa fiecare `npm install`, pachetele mici
// afectate langa fiecare "cerut de" care nu are deja propria copie -
// electron-builder le vede atunci ca fiind corect co-locate si le include.
//
// Daca in viitor apar erori similare "Cannot find module" DOAR in build-ul
// instalat, adauga pachetul respectiv (si cine il cere, vezi eroarea -
// require stack-ul din popup arata exact lantul) in HOISTED_DEPS de mai jos.

const fs = require('fs')
const path = require('path')

const HOISTED_DEPS = [
  {
    package: 'call-bind-apply-helpers',
    requiredBy: ['call-bound', 'dunder-proto', 'get-intrinsic', 'get-proto']
  }
]

const root = path.join(__dirname, '..', 'node_modules')

for (const { package: pkg, requiredBy } of HOISTED_DEPS) {
  const source = path.join(root, pkg)
  if (!fs.existsSync(source)) continue

  for (const requirer of requiredBy) {
    const requirerDir = path.join(root, requirer)
    if (!fs.existsSync(requirerDir)) continue // pachetul nu e instalat, nimic de facut

    const dest = path.join(requirerDir, 'node_modules', pkg)
    if (fs.existsSync(dest)) continue // are deja propria copie, e OK

    fs.mkdirSync(path.dirname(dest), { recursive: true })
    fs.cpSync(source, dest, { recursive: true })
    console.log(`[fix-hoisted-deps] copiat ${pkg} -> ${requirer}/node_modules/${pkg}`)
  }
}
