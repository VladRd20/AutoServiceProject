// Captura de ecran a aplicatiei reale (verificare vizuala): node tests/e2e/shot.mjs <folder-iesire>
import path from 'node:path'
import { prepareTemplate, makeSandbox, launch, closeApp, cleanupAll, sleep, plateInput } from './helpers.mjs'

const out = process.argv[2] || '.'
prepareTemplate()
const sb = makeSandbox('shot')
const h = await launch(sb)
const p = h.page
await p.setViewportSize({ width: 1280, height: 860 }).catch(() => {})
await plateInput(p).fill('C AB 123')
await sleep(300)
await p.screenshot({ path: path.join(out, 'form.png') })
await p.locator('.search-filter-btn').click()
await sleep(400)
await p.screenshot({ path: path.join(out, 'search-open.png'), clip: { x: 700, y: 0, width: 580, height: 420 } })
const box = await p.locator('.search-filter-btn').boundingBox()
const inp = await p.locator('.topbar-search').boundingBox()
console.log('button', JSON.stringify(box), 'input', JSON.stringify(inp))
await closeApp(h)
cleanupAll()
