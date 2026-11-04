// Logica pura a patch-ului local de draft (folosita de App.jsx dupa un autosave
// reusit). Separata ca sa fie testabila fara DOM.
//
// Returneaza { action, next }:
//  - 'ignore'  : draftul a fost finalizat/sters intre timp -> un callback 'saved'
//                intarziat NU are voie sa-l re-insereze in sidebar;
//  - 'refresh' : draft necunoscut in lista (nou) -> refresh complet;
//  - 'patch'   : intrarea se actualizeaza local si urca prima in lista.
export function applyDraftPatch(prev, doc, id, removedIds, now = new Date().toISOString()) {
  if (removedIds.has(id)) return { action: 'ignore', next: prev }
  if (!prev.some((d) => d.id === id)) return { action: 'refresh', next: prev }
  const entry = { ...doc, id, status: 'draft', updatedAt: now }
  return { action: 'patch', next: [entry, ...prev.filter((d) => d.id !== id)] }
}
