import { createRequire } from 'module'
import { describe, expect, it } from 'vitest'
import pkg from '../package.json'
import {
  WHATS_NEW,
  compareVersions,
  entriesToShow,
  parseVersion,
  recentEntries
} from '../src/shared/whatsNew'

const require = createRequire(import.meta.url)
const { notesFor, loadEntries } = require('../scripts/release-notes.js')

// Cuvinte care indica detalii tehnice - nu au ce cauta intr-un mesaj catre utilizator.
const JARGON =
  /\b(json|cache|ipc|api|backend|frontend|refactor\w*|eslint|vitest|playwright|dependen\w*|migrar\w*|commit|electron|node|react|schema|serializ\w*|regex|test(e|ele|s)?|ci\/cd|workflow|bug(uri)?|hook\w*|timeout|mutex|atomic\w*)\b/i

describe('ce e nou - continut (doar ce vede utilizatorul)', () => {
  it('versiunile sunt valide, unice si in ordine descrescatoare', () => {
    const versions = WHATS_NEW.map((e) => e.version)
    expect(versions.every((v) => parseVersion(v))).toBe(true)
    expect(new Set(versions).size).toBe(versions.length)
    for (let i = 1; i < versions.length; i++) expect(compareVersions(versions[i - 1], versions[i])).toBe(1)
  })

  it('versiunea din package.json are notite (altfel nu se poate publica)', () => {
    expect(compareVersions(WHATS_NEW[0].version, pkg.version)).toBeGreaterThanOrEqual(0)
  })

  it('fiecare intrare: titlu, data, cel putin o schimbare, tip valid, text scurt', () => {
    for (const e of WHATS_NEW) {
      expect(e.titlu?.length).toBeGreaterThan(3)
      expect(e.date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(e.items.length).toBeGreaterThan(0)
      for (const item of e.items) {
        expect(['nou', 'imbunatatit', 'rezolvat']).toContain(item.tip)
        expect(item.text.length).toBeGreaterThan(10)
        expect(item.text.length).toBeLessThanOrEqual(220)
        expect(item.text.trim().endsWith('.')).toBe(true)
      }
    }
  })

  it('niciun jargon tehnic in texte', () => {
    for (const e of WHATS_NEW) {
      for (const text of [e.titlu, ...e.items.map((i) => i.text)]) {
        expect(text, `jargon in: ${text}`).not.toMatch(JARGON)
      }
    }
  })
})

describe('ce e nou - logica de afisare', () => {
  const all = [
    { version: '0.7.0', items: [] },
    { version: '0.6.5', items: [] },
    { version: '0.6.0', items: [] },
    { version: '0.8.0', items: [] } // pregatita in avans
  ]
  it('comparare de versiuni (numerica, nu text)', () => {
    expect(compareVersions('0.10.0', '0.9.0')).toBe(1)
    expect(compareVersions('1.0.0', '0.99.99')).toBe(1)
    expect(compareVersions('0.6.0', '0.6.0')).toBe(0)
    expect(compareVersions('gunoi', '0.1.0')).toBe(-1)
    expect(compareVersions(null, undefined)).toBe(0)
  })
  it('doar ce e mai nou decat ultima versiune vazuta si nu mai nou decat cea instalata', () => {
    expect(entriesToShow('0.7.0', '0.6.0', all).map((e) => e.version)).toEqual(['0.7.0', '0.6.5'])
    expect(entriesToShow('0.7.0', '0.7.0', all)).toEqual([])
    expect(entriesToShow('0.7.0', '0.9.0', all)).toEqual([]) // downgrade: nimic
  })
  it('fara "ultima vazuta": doar versiunea curenta', () => {
    expect(entriesToShow('0.7.0', null, all).map((e) => e.version)).toEqual(['0.7.0'])
    expect(entriesToShow('0.6.9', null, all)).toEqual([]) // nicio intrare exact pentru 0.6.9
  })
  it('recente: ultimele n pana la versiunea curenta', () => {
    expect(recentEntries('0.7.0', 2, all).map((e) => e.version)).toEqual(['0.7.0', '0.6.5'])
    expect(recentEntries('0.6.0', 5, all).map((e) => e.version)).toEqual(['0.6.0'])
  })
})

describe('note pentru GitHub Release', () => {
  it('genereaza Markdown din aceeasi lista; versiune fara intrare => null', () => {
    const v = WHATS_NEW[0].version
    const md = notesFor(v)
    expect(md.startsWith(WHATS_NEW[0].titlu)).toBe(true)
    expect(md.match(/^- \*\*/gm)).toHaveLength(WHATS_NEW[0].items.length)
    expect(notesFor('9.9.9')).toBeNull()
    expect(loadEntries()[0].version).toBe(v)
  })
})
