import { describe, expect, it } from 'vitest'
import { pickStartupDraft } from '../src/renderer/src/fisaModel'

const draft = (id, updatedAt, nume = 'Client') => ({ id, updatedAt, client: { nume }, piese: [], lucrari: [] })
const gol = (id, updatedAt) => ({ id, updatedAt, client: { nume: '' }, piese: [], lucrari: [] })

describe('pickStartupDraft', () => {
  it('alege cel mai recent modificat draft cu continut', () => {
    const list = [
      draft('a', '2026-01-01T10:00:00Z'),
      draft('b', '2026-01-01T12:00:00Z'),
      draft('c', '2026-01-01T11:00:00Z')
    ]
    expect(pickStartupDraft(list).id).toBe('b')
  })

  it('ignora drafturile goale cat timp exista unul cu continut, chiar daca sunt mai noi', () => {
    const list = [gol('g', '2026-01-02T00:00:00Z'), draft('a', '2026-01-01T10:00:00Z')]
    expect(pickStartupDraft(list).id).toBe('a')
  })

  it('fara continut: reutilizeaza cel mai recent draft gol', () => {
    const list = [gol('g1', '2026-01-01T00:00:00Z'), gol('g2', '2026-01-02T00:00:00Z')]
    expect(pickStartupDraft(list).id).toBe('g2')
  })

  it('independent de ordinea listei; fara updatedAt ajunge la coada', () => {
    const list = [draft('old', undefined), draft('new', '2026-01-01T10:00:00Z')]
    expect(pickStartupDraft(list).id).toBe('new')
    expect(pickStartupDraft([])).toBeNull()
    expect(pickStartupDraft(undefined)).toBeNull()
  })
})
