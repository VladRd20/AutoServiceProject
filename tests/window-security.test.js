import { describe, it, expect } from 'vitest'
import fs from 'fs'

const src = fs.readFileSync(new URL('../src/main/index.js', import.meta.url), 'utf-8')
const prop = (name, val) => new RegExp(`${name}\\s*:\\s*${val}\\b`)

describe('securitate fereastra principala (index.js)', () => {
  const wp = src.match(/webPreferences\s*:\s*\{[^}]*\}/)?.[0] || ''
  it('webPreferences are izolare + sandbox, fara nodeIntegration', () => {
    expect(wp).not.toBe('')
    expect(wp).toMatch(prop('contextIsolation', 'true'))
    expect(wp).toMatch(prop('sandbox', 'true'))
    expect(wp).toMatch(prop('nodeIntegration', 'false'))
  })

  it('setWindowOpenHandler permite doar https si refuza fereastra noua', () => {
    const m = src.match(/setWindowOpenHandler\s*\([\s\S]*?\n\s*\}\)/)
    expect(m).not.toBeNull()
    expect(m[0]).toMatch(/https:/)
    expect(m[0]).toMatch(/action\s*:\s*['"]deny['"]/)
    expect(m[0]).not.toMatch(/action\s*:\s*['"]allow['"]/)
  })
})
