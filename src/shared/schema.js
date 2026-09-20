import { reduceriDinFisa } from './calculations'

// Versiunea formatului fiselor de pe disc. Creste doar cand se schimba forma
// datelor; migrateFisa() aduce orice fisa mai veche la forma curenta la citire
// (main process) - fisierul de pe disc se rescrie in noul format abia la
// urmatoarea salvare, nu se atinge la simpla citire.
//  1 (lipsa) - un singur camp `reducerePercent`
//  2         - reducere separata piese/lucrari, camp `schemaVersion`
export const SCHEMA_VERSION = 2

export function migrateFisa(f) {
  if (!f || typeof f !== 'object') return f
  let out = f
  if (
    out.reducerePiesePercent === undefined &&
    out.reducereLucrariPercent === undefined &&
    out.reducerePercent !== undefined
  ) {
    const r = reduceriDinFisa(out)
    const { reducerePercent: _legacy, ...rest } = out
    out = { ...rest, reducerePiesePercent: r.piese, reducereLucrariPercent: r.lucrari }
  }
  if (out.schemaVersion !== SCHEMA_VERSION) out = { ...out, schemaVersion: SCHEMA_VERSION }
  return out
}
