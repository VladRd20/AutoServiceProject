import { describe, expect, it } from 'vitest'
import {
  calcTotaluri,
  clampPercentText,
  formatKm,
  formatPrice,
  formatQuantity,
  parseDecimal,
  parseKm,
  validateFisa
} from '../src/shared/calculations'

describe('parseDecimal', () => {
  it('accepta virgula si punctul ca separator zecimal', () => {
    expect(parseDecimal('12,5')).toBe(12.5)
    expect(parseDecimal('12.5')).toBe(12.5)
    expect(parseDecimal(' 7 ')).toBe(7)
    expect(parseDecimal(3.25)).toBe(3.25)
  })
  it('intelege separatorii de mii', () => {
    expect(parseDecimal('1 234,50')).toBe(1234.5)
    expect(parseDecimal('1.234,50')).toBe(1234.5)
    expect(parseDecimal('1,234.50')).toBe(1234.5)
    expect(parseDecimal('1,234,567')).toBe(1234567)
  })
  it('gol sau ne-numeric -> null', () => {
    expect(parseDecimal('')).toBeNull()
    expect(parseDecimal(null)).toBeNull()
    expect(parseDecimal('abc')).toBeNull()
    expect(parseDecimal('.')).toBeNull()
    expect(parseDecimal('1.2.3')).toBeNull()
    expect(parseDecimal(NaN)).toBeNull()
  })
})

describe('formatare la blur', () => {
  it('pretul are mereu 2 zecimale', () => {
    expect(formatPrice('12,5')).toBe('12.50')
    expect(formatPrice('100')).toBe('100.00')
    expect(formatPrice(0)).toBe('0.00')
    expect(formatPrice('1,005')).toBe('1.01')
  })
  it('pretul gol sau invalid ramane neschimbat', () => {
    expect(formatPrice('')).toBe('')
    expect(formatPrice('abc')).toBe('abc')
  })
  it('cantitatea are pana la 3 zecimale, fara zerouri finale', () => {
    expect(formatQuantity('2,500')).toBe('2.5')
    expect(formatQuantity('1')).toBe('1')
    expect(formatQuantity('0,12345')).toBe('0.123')
    expect(formatQuantity('')).toBe('')
  })
  it('reducerea e limitata la 0-100', () => {
    expect(clampPercentText('150')).toBe('100')
    expect(clampPercentText('12,5')).toBe('12.5')
    expect(clampPercentText('')).toBe('0')
    expect(clampPercentText('-5')).toBe('0')
  })
})

describe('kilometraj', () => {
  it('se stocheaza ca numar si se afiseaza cu spatiu la mii', () => {
    expect(parseKm('185 000')).toBe(185000)
    expect(parseKm('18a5')).toBe(185)
    expect(parseKm('')).toBe('')
    expect(formatKm(185000)).toBe('185 000')
    expect(formatKm('1234567')).toBe('1 234 567')
    expect(formatKm('')).toBe('')
    expect(formatKm(0)).toBe('0')
  })
  it('un kilometraj formatat/numeric trece validarea', () => {
    expect(validateFisa({ km: parseKm('185 000') }).errors.km).toBeUndefined()
  })
})

describe('calcTotaluri cu valori normalizate', () => {
  it('da acelasi rezultat pentru "12,5", "12.50" si 12.5', () => {
    const mk = (c, p) => [{ cantitate: c, pretUnitar: p }]
    const a = calcTotaluri(mk('2,5', '12,5'), [], '10,5', 0)
    const b = calcTotaluri(mk(formatQuantity('2,5'), formatPrice('12,5')), [], clampPercentText('10,5'), 0)
    expect(b).toEqual(a)
    expect(a.totalFinal).toBe(27.97)
  })
  it('datele vechi raman neschimbate', () => {
    const t = calcTotaluri([{ cantitate: 2, pretUnitar: '50' }], [{ cantitate: 1, pret: 120 }], 10, 0)
    expect(t.totalFinal).toBe(210)
  })
})
