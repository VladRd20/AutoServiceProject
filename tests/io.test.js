import fs from 'fs'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { copyFileAtomic, faults, ioHooks, moveFile, withRetry, writeJsonAtomic, writeStreamAtomic } from '../src/main/store/io.js'
import { mkTmp } from './helpers'

let dir
beforeEach(() => {
  dir = mkTmp('sa-io-')
})
afterEach(() => {
  faults.beforeRename = null
  fs.rmSync(dir, { recursive: true, force: true })
})

const err = (code) => Object.assign(new Error(code), { code })

describe('withRetry', () => {
  it('reincearca pe erori tranzitorii si reuseste daca una din reincercari trece', async () => {
    let calls = 0
    const result = await withRetry(() => {
      calls++
      if (calls < 3) throw err('EBUSY')
      return 'ok'
    })
    expect(result).toBe('ok')
    expect(calls).toBe(3)
  })

  it('epuizeaza toate incercarile si arunca ULTIMA eroare tranzitorie', async () => {
    let calls = 0
    await expect(
      withRetry(() => {
        calls++
        throw err('EPERM')
      }, 4)
    ).rejects.toMatchObject({ code: 'EPERM' })
    expect(calls).toBe(4)
  })

  it('o eroare NEtranzitorie nu e reincercata', async () => {
    let calls = 0
    await expect(
      withRetry(() => {
        calls++
        throw err('ENOSPC')
      })
    ).rejects.toMatchObject({ code: 'ENOSPC' })
    expect(calls).toBe(1)
  })
})

describe('moveFile', () => {
  it('muta fisierul cu un rename simplu cand sursa/destinatia sunt pe acelasi volum', async () => {
    const src = path.join(dir, 'a.txt')
    const dest = path.join(dir, 'b.txt')
    fs.writeFileSync(src, 'continut')
    await moveFile(src, dest)
    expect(fs.existsSync(src)).toBe(false)
    expect(fs.readFileSync(dest, 'utf-8')).toBe('continut')
  })

  it('EXDEV (volume diferite) declanseaza fallback copiere+stergere, nu pierde/trunchiaza continutul', async () => {
    const src = path.join(dir, 'a.txt')
    const dest = path.join(dir, 'b.txt')
    fs.writeFileSync(src, 'continut-exdev')
    let threw = false
    faults.beforeRename = (from) => {
      if (from === src && !threw) {
        threw = true
        throw err('EXDEV')
      }
    }
    await moveFile(src, dest)
    expect(fs.existsSync(src)).toBe(false)
    expect(fs.readFileSync(dest, 'utf-8')).toBe('continut-exdev')
  })

  it('o eroare EXDEV persistenta pe fallback-ul de copiere nu lasa fisiere .tmp- orfane', async () => {
    const src = path.join(dir, 'a.txt')
    const dest = path.join(dir, 'does-not-exist', 'b.txt')
    fs.writeFileSync(src, 'x')
    faults.beforeRename = () => {
      throw err('EXDEV')
    }
    await expect(moveFile(src, dest)).rejects.toBeTruthy()
    expect(fs.existsSync(src)).toBe(true)
    expect(fs.readdirSync(dir).some((n) => n.includes('.tmp-'))).toBe(false)
  })
})

describe('copyFileAtomic', () => {
  it('EBUSY tranzitoriu pe rename-ul final e reincercat automat', async () => {
    const src = path.join(dir, 'a.txt')
    const dest = path.join(dir, 'b.txt')
    fs.writeFileSync(src, 'y')
    let calls = 0
    faults.beforeRename = () => {
      calls++
      if (calls === 1) throw err('EBUSY')
    }
    await copyFileAtomic(src, dest)
    expect(fs.readFileSync(dest, 'utf-8')).toBe('y')
    expect(calls).toBe(2)
  })
})

describe('cârlige de scriere (ioHooks)', () => {
  afterEach(() => {
    ioHooks.onWriteOk = null
    ioHooks.onWriteFail = null
  })

  it('writeStreamAtomic raporteaza succesul si esecul ca writeJsonAtomic', async () => {
    const ok = vi.fn()
    const fail = vi.fn()
    ioHooks.onWriteOk = ok
    ioHooks.onWriteFail = fail
    const f = path.join(dir, 's.txt')
    await writeStreamAtomic(f, async (w) => w('abc'))
    expect(ok).toHaveBeenCalledWith(f)
    expect(fail).not.toHaveBeenCalled()
    await expect(writeStreamAtomic(path.join(dir, 'nu', 'exista', 's.txt'), async (w) => w('x'))).rejects.toBeTruthy()
    expect(fail).toHaveBeenCalledTimes(1)
  })

  it('writeJsonAtomic respecta bugetul de reincercari redus', async () => {
    let calls = 0
    faults.beforeRename = () => {
      calls++
      throw err('EBUSY')
    }
    await expect(
      writeJsonAtomic(path.join(dir, 'd.json'), { a: 1 }, undefined, { attempts: 3, baseMs: 1, maxMs: 2 })
    ).rejects.toBeTruthy()
    expect(calls).toBe(3)
  })
})
