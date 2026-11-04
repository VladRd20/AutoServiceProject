import { describe, expect, it } from 'vitest'
import {
  calcLinieTotalLive,
  calcTotaluri,
  exceedsIntDigits,
  formatPrice,
  formatQuantity,
  parseDecimal,
  toDisplayDecimal
} from '../src/shared/calculations'

describe('parsare numere (reguli RO)', () => {
  it('accepta "48,50" si "48.50"', () => {
    expect(parseDecimal('48,50')).toBe(48.5)
    expect(parseDecimal('48.50')).toBe(48.5)
  })
  it('daca apar ambele separatoare, ultimul e zecimal', () => {
    expect(parseDecimal('1.234,50')).toBe(1234.5)
    expect(parseDecimal('1,234.50')).toBe(1234.5)
  })
  it('spatiul si nbsp sunt separatori de mii', () => {
    expect(parseDecimal('1 234')).toBe(1234)
    expect(parseDecimal('1 234')).toBe(1234)
  })
  it('un singur separator urmat de 3 cifre ramane zecimal', () => {
    expect(parseDecimal('1,234')).toBe(1.234)
    expect(parseDecimal('1.234')).toBe(1.234)
  })
  it('maxim 12 cifre la partea intreaga', () => {
    expect(parseDecimal('999999999999')).toBe(999999999999)
    expect(parseDecimal('1000000000000')).toBeNull()
    expect(parseDecimal('1e21')).toBeNull()
    expect(formatPrice('1000000000000')).toBe('1000000000000')
    expect(exceedsIntDigits('1000000000000')).toBe(true)
    expect(exceedsIntDigits('999999999999,99')).toBe(false)
  })
  it('afisare cu virgula, fara a schimba valoarea stocata', () => {
    expect(toDisplayDecimal('48.50')).toBe('48,50')
    expect(toDisplayDecimal(2.5)).toBe('2,5')
    expect(toDisplayDecimal('12,5')).toBe('12,5')
    expect(toDisplayDecimal(null)).toBe('')
    expect(formatPrice('48,5')).toBe('48.50')
    expect(formatQuantity('2,5')).toBe('2.5')
  })
  it('totalul live foloseste acelasi parser', () => {
    expect(calcLinieTotalLive('1', '1 234')).toBe(1234)
    expect(calcLinieTotalLive('2,5', '1.234,50')).toBe(3086.25)
    expect(calcLinieTotalLive('', 'abc')).toBe(0)
  })
  it('calcTotaluri identic cu versiunea dinaintea modificarii (fixture-uri vechi)', () => {
    const piese = [
      { cantitate: '2', pretUnitar: '48.555' },
      { cantitate: 2.5, pretUnitar: 10 },
      { cantitate: '', pretUnitar: '' },
      { cantitate: '1,5', pretUnitar: '3,33' },
      { cantitate: '3', pretUnitar: '0.1' }
    ]
    const lucrari = [
      { cantitate: 1, pret: '120.00' },
      { cantitate: '1', pret: 100 },
      { cantitate: null, pret: undefined },
      { cantitate: '2', pret: 'abc' }
    ]
    // valorile au fost calculate cu calcTotaluri din commitul 07bb3fd
    expect(calcTotaluri(piese, lucrari, '10', '5.5')).toEqual({
      totalPiese: 127.41,
      totalLucrari: 220,
      totalGeneral: 347.41,
      procentReducerePiese: 10,
      procentReducereLucrari: 5.5,
      valoareReducerePiese: 12.74,
      valoareReducereLucrari: 12.1,
      valoareReducere: 24.84,
      totalFinal: 322.57
    })
    expect(calcTotaluri([], [], '', null).totalFinal).toBe(0)
    expect(calcTotaluri(piese, lucrari, '150', '-3')).toMatchObject({
      procentReducerePiese: 100,
      procentReducereLucrari: 0,
      totalFinal: 220
    })
  })
})
