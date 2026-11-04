import { describe, expect, it } from 'vitest'
import { applyDraftPatch } from '../src/renderer/src/draftPatch.js'

const d = (id, t) => ({ id, updatedAt: t })

describe('applyDraftPatch', () => {
  it('ignora un callback "saved" tardiv pentru un draft finalizat/sters', () => {
    const prev = [d('a', '1'), d('b', '2')]
    const r = applyDraftPatch(prev, { x: 1 }, 'b', new Set(['b']))
    expect(r.action).toBe('ignore')
    expect(r.next).toBe(prev)
  })

  it('draft necunoscut => refresh complet', () => {
    expect(applyDraftPatch([d('a', '1')], {}, 'z', new Set()).action).toBe('refresh')
  })

  it('draft cunoscut urca primul in lista', () => {
    const r = applyDraftPatch([d('a', '1'), d('b', '2')], { nume: 'x' }, 'b', new Set(), 'T')
    expect(r.action).toBe('patch')
    expect(r.next.map((e) => e.id)).toEqual(['b', 'a'])
    expect(r.next[0]).toMatchObject({ nume: 'x', status: 'draft', updatedAt: 'T' })
  })
})
