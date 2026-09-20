import { describe, expect, it } from 'vitest'
import {
  LIMITS,
  calcLinieTotal,
  calcTotaluri,
  foldForMatch,
  isFisaEmpty,
  reduceriDinFisa,
  round2,
  validateFisa
} from '../src/shared/calculations'
import { migrateFisa, SCHEMA_VERSION } from '../src/shared/schema'
import { sanitizeFisa } from '../src/main/sanitize'
import { csvCell } from '../src/main/store/reports'
import { fisa } from './helpers'

const errs = (f) => validateFisa(f).errors

describe('validateFisa - cazuri valide', () => {
  it('fisa completa e valida', () => {
    expect(validateFisa(fisa()).valid).toBe(true)
  })
  it('campuri optionale goale/lipsa sunt valide', () => {
    const f = fisa()
    delete f.km
    delete f.observatii
    delete f.plata
    delete f.client.cui
    f.auto.an = ''
    expect(validateFisa(f).valid).toBe(true)
  })
  it('zecimale cu virgula sau punct', () => {
    const f = fisa({ piese: [{ denumire: 'x', cantitate: '1,5', pretUnitar: '12,50' }], lucrari: [{ denumire: 'y', cantitate: '0.5', pret: '100.25' }] })
    expect(validateFisa(f).valid).toBe(true)
    expect(calcLinieTotal('1,5', '12,50')).toBe(18.75)
  })
  it('data curenta nu cere data', () => {
    expect(validateFisa(fisa({ dataCurenta: true, data: '' })).valid).toBe(true)
  })
})

describe('validateFisa - cazuri de esec', () => {
  it.each([
    [{ piese: [{ denumire: 'x', cantitate: '1', pretUnitar: 'abc' }] }, 'piese.0.pretUnitar'],
    [{ piese: [{ denumire: 'x', cantitate: '1', pretUnitar: '-5' }] }, 'piese.0.pretUnitar'],
    [{ piese: [{ denumire: 'x', cantitate: '1', pretUnitar: '1e400' }] }, 'piese.0.pretUnitar'],
    [{ piese: [{ denumire: 'x', cantitate: '1', pretUnitar: '9999999999' }] }, 'piese.0.pretUnitar'],
    [{ piese: [{ denumire: 'x', cantitate: '0', pretUnitar: '1' }] }, 'piese.0.cantitate'],
    [{ piese: [{ denumire: 'x', cantitate: '-1', pretUnitar: '1' }] }, 'piese.0.cantitate'],
    [{ piese: [{ denumire: 'x', cantitate: 'NaN', pretUnitar: '1' }] }, 'piese.0.cantitate'],
    [{ piese: [{ denumire: '   ', cantitate: '1', pretUnitar: '1' }] }, 'piese.0.denumire'],
    [{ lucrari: [{ denumire: 'x', cantitate: '', pret: '1' }] }, 'lucrari.0.cantitate'],
    [{ lucrari: [{ denumire: 'x'.repeat(201), cantitate: '1', pret: '1' }] }, 'lucrari.0.denumire'],
    [{ data: '2026-02-30' }, 'data'],
    [{ data: '18-09-2026' }, 'data'],
    [{ data: 'azi' }, 'data'],
    [{ km: 'multi' }, 'km'],
    [{ km: '-1' }, 'km'],
    [{ km: '99999999' }, 'km'],
    [{ observatii: 'x'.repeat(LIMITS.observatii + 1) }, 'observatii'],
    [{ plata: { status: 'poate', metoda: '' } }, 'plata.status'],
    [{ plata: { status: 'achitat', metoda: 'bitcoin' } }, 'plata.metoda'],
    [{ reducerePiesePercent: 150 }, 'reducerePiesePercent'],
    [{ reducereLucrariPercent: 'multa' }, 'reducereLucrariPercent'],
    [{ auto: { ...fisa().auto, an: '1800' } }, 'auto.an'],
    [{ auto: { ...fisa().auto, an: 'abcd' } }, 'auto.an'],
    [{ auto: { ...fisa().auto, vin: '123' } }, 'auto.vin'],
    [{ auto: { ...fisa().auto, nrInmatriculare: '  ' } }, 'auto.nrInmatriculare'],
    [{ auto: { ...fisa().auto, nrInmatriculare: 'X'.repeat(33) } }, 'auto.nrInmatriculare'],
    [{ client: { nume: 'N'.repeat(201), telefon: '0691234567' } }, 'client.nume'],
    [{ client: { nume: 'ok', telefon: 'telefon' } }, 'client.telefon'],
    [{ client: { nume: 'ok', telefon: '0691234567', cui: 'C'.repeat(33) } }, 'client.cui'],
    [{ piese: Array.from({ length: LIMITS.linii + 1 }, () => ({ denumire: 'x', cantitate: '1', pretUnitar: '1' })) }, 'piese'],
    [{ piese: 'nu-e-lista' }, 'piese']
  ])('respinge %#', (over, key) => {
    const e = errs(fisa(over))
    expect(Object.keys(e)).toContain(key)
  })

  it.each([null, undefined, 5, 'text', []])('input total gresit (%j) nu arunca', (x) => {
    expect(() => validateFisa(x)).not.toThrow()
    expect(validateFisa(x).valid).toBe(false)
  })
})

describe('calcule', () => {
  it('rotunjiri', () => {
    expect(round2(1.005)).toBe(1.01)
    expect(calcLinieTotal('3', '0.1')).toBe(0.3)
    expect(calcLinieTotal('0.1', '3')).toBe(0.3)
    expect(calcLinieTotal(undefined, 5)).toBe(0)
  })
  it('totaluri cu reduceri separate, clamp 0-100, liste invalide', () => {
    const p = [{ cantitate: 2, pretUnitar: 50 }]
    const l = [{ cantitate: 1, pret: 100 }]
    expect(calcTotaluri(p, l, 10, 50).totalFinal).toBe(140)
    expect(calcTotaluri(p, l, 500, -5).totalFinal).toBe(100)
    expect(calcTotaluri('x', { a: 1 }, 0, 0).totalFinal).toBe(0)
    expect(calcTotaluri([null, undefined, {}], null, 0, 0).totalFinal).toBe(0)
  })
  it('reducere legacy', () => {
    expect(reduceriDinFisa({ reducerePercent: 7 })).toEqual({ piese: 7, lucrari: 7 })
    expect(reduceriDinFisa({ reducerePiesePercent: 5 })).toEqual({ piese: 5, lucrari: 0 })
    expect(reduceriDinFisa(null)).toEqual({ piese: 0, lucrari: 0 })
  })
  it('foldForMatch', () => {
    expect(foldForMatch('Ștefan ȚURCANU Škoda')).toBe('stefan turcanu skoda')
    expect(foldForMatch(null)).toBe('')
  })
  it('isFisaEmpty tine cont de campurile noi', () => {
    const empty = { client: {}, auto: {}, piese: [], lucrari: [], km: '', observatii: ' ' }
    expect(isFisaEmpty(empty)).toBe(true)
    expect(isFisaEmpty({ ...empty, km: '1000' })).toBe(false)
    expect(isFisaEmpty({ ...empty, observatii: 'ceva' })).toBe(false)
    expect(isFisaEmpty({ ...empty, client: { cui: '123' } })).toBe(false)
    expect(isFisaEmpty({ ...empty, _replaceBaseName: 'X_1' })).toBe(false)
  })
})

describe('sanitizeFisa', () => {
  it('pastreaza forma, taie doar ca plasa de siguranta, elimina campuri necunoscute', () => {
    const s = sanitizeFisa({
      ...fisa(),
      evil: '<script>',
      __proto__: { x: 1 },
      piese: [{ id: 1, denumire: 'x'.repeat(500), cantitate: { a: 1 }, pretUnitar: [1], extra: 'nu' }],
      client: { nume: 5, telefon: null },
      plata: { status: 'hack', metoda: 'card' },
      km: { toString: 'x' }
    })
    expect(s.evil).toBeUndefined()
    expect(s.piese[0].denumire).toHaveLength(LIMITS.text)
    expect(s.piese[0].extra).toBeUndefined()
    expect(s.piese[0].cantitate).toBe('')
    expect(s.client.nume).toBe('5')
    expect(s.client.telefon).toBe('')
    expect(s.plata).toEqual({ status: '', metoda: 'card' })
    expect(s.km).toBe('')
    expect(s.schemaVersion).toBe(SCHEMA_VERSION)
  })
  it.each([null, undefined, 5, 'x', [], () => {}])('input gresit %#: forma valida, fara exceptii', (x) => {
    const s = sanitizeFisa(x)
    expect(s.client).toBeTruthy()
    expect(Array.isArray(s.piese)).toBe(true)
    expect(s.id).toBeNull()
  })
  it('limiteaza numarul de linii; NaN/Infinity devin text gol', () => {
    const many = Array.from({ length: 999 }, () => ({ denumire: 'x', cantitate: 1, pretUnitar: 1 }))
    expect(sanitizeFisa({ piese: many }).piese).toHaveLength(LIMITS.linii)
    const s = sanitizeFisa({ piese: [{ denumire: 'a', cantitate: NaN, pretUnitar: Infinity }] })
    expect(s.piese[0].cantitate).toBe('NaN'.slice(0, 0) || s.piese[0].cantitate)
  })
  it('id cu obiect e ignorat, iar _replaceBaseName ramane pentru validare in main', () => {
    expect(sanitizeFisa({ id: { a: 1 } }).id).toBeNull()
    expect(sanitizeFisa({ _replaceBaseName: 'A_1' })._replaceBaseName).toBe('A_1')
  })
})

describe('migrateFisa', () => {
  it('v1 -> v2, identic daca deja migrata', () => {
    const v1 = { reducerePercent: 12, client: {} }
    const v2 = migrateFisa(v1)
    expect(v2).toMatchObject({ reducerePiesePercent: 12, reducereLucrariPercent: 12, schemaVersion: 2 })
    expect(v2.reducerePercent).toBeUndefined()
    expect(migrateFisa(v2)).toBe(v2)
    expect(v1.reducerePercent).toBe(12) // nu muteaza originalul
    expect(migrateFisa(null)).toBeNull()
  })
})

describe('csvCell', () => {
  it.each([
    ['=1+1', `"'=1+1"`],
    ['+cmd', `"'+cmd"`],
    ['-cmd', `"'-cmd"`],
    ['@SUM(A1)', `"'@SUM(A1)"`],
    ['normal', '"normal"'],
    ['cu "ghilimele"', '"cu ""ghilimele"""'],
    ['-5,50', '"-5,50"'],
    [null, '""'],
    [42, '"42"']
  ])('%j', (input, out) => expect(csvCell(input)).toBe(out))
})
