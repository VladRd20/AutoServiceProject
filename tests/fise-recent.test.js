import fs from 'fs'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fisa, makeEnv } from './helpers'

// Separat de fise.test.js ca sa ruleze in paralel cu restul (setup-ul cu 60 de fise e lent).
let env
beforeEach(async () => {
  env = await makeEnv()
})
afterEach(() => env.cleanup())

const fiseDir = () => path.join(env.dataDir, 'fise')

describe('listRecentFise - esantion rapid (fara cache)', () => {
  it('nu citeste/parseaza TOATE fisele finalizate doar pentru cele mai recente cateva', async () => {
    const { fise } = env.s
    const total = 60
    // Finalizari in paralel (coada interna le serializeaza): setup-ul dureaza mult mai putin.
    await Promise.all(
      Array.from({ length: total }, (_, i) =>
        fise.finalizeFisa(fisa({ auto: { ...fisa().auto, nrInmatriculare: `AB ${100 + i}` } }))
      )
    )
    const s2 = await env.restart()
    const realReadFile = (await import('fs/promises')).default.readFile
    let reads = 0
    const spy = vi
      .spyOn((await import('fs/promises')).default, 'readFile')
      .mockImplementation((p, ...rest) => {
        if (String(p).includes(fiseDir())) reads++
        return realReadFile(p, ...rest)
      })
    const list = await s2.fise.listRecentFise(3)
    spy.mockRestore()
    expect(list).toHaveLength(3)
    // Esantionul (vezi listRecentFiseFast) e marginit - cu 60 de fise si
    // limita 3 nu ar trebui sa citeasca/parseze toate cele 60.
    expect(reads).toBeLessThan(total)
  })

  it('ordinea ramane dupa finalizedAt (continut), nu dupa mtime, cand cele doua nu coincid', async () => {
    const { fise } = env.s
    const a = await fise.finalizeFisa(fisa({ auto: { ...fisa().auto, nrInmatriculare: 'OLD 1' } }))
    const b = await fise.finalizeFisa(fisa({ auto: { ...fisa().auto, nrInmatriculare: 'NEW 1' } }))
    // "a" e de fapt mai recent re-salvat pe disc (mtime nou), dar finalizedAt
    // din continut arata ca "b" a fost finalizat ultimul - trebuie sa ramana primul.
    const p = path.join(fiseDir(), `${a.baseName}.json`)
    fs.writeFileSync(p, fs.readFileSync(p))
    const future = new Date(Date.now() + 60000)
    fs.utimesSync(p, future, future)
    const s2 = await env.restart()
    const list = await s2.fise.listRecentFise(2)
    expect(list.map((f) => f._file)).toEqual([`${b.baseName}.json`, `${a.baseName}.json`])
  })

  it('cand cache-ul e deja incarcat (ex. dupa o cautare), listRecentFise foloseste cache-ul', async () => {
    const { fise } = env.s
    await fise.finalizeFisa(fisa())
    await fise.searchFise('', { from: '2000-01-01', to: '2100-01-01' })
    const list = await fise.listRecentFise()
    expect(list).toHaveLength(1)
  })
})
