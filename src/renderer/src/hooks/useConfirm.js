import { useCallback, useState } from 'react'

// Inlocuieste window.confirm() nativ (arata cu titlul procesului si stilul
// brut al SO, in afara temei aplicatiei) cu un dialog propriu. confirmAction
// pastreaza acelasi API simplu (Promise<boolean>, await-uibil de la locul
// de apel), doar ca randarea reala e delegata catre ConfirmDialog, controlat
// prin confirmState.
export default function useConfirm() {
  const [confirmState, setConfirmState] = useState(null)
  const confirmAction = useCallback((message, opts) => {
    return new Promise((resolve) => {
      // Un al doilea dialog nu are voie sa lase primul promise nerezolvat.
      setConfirmState((prev) => {
        prev?.resolve(false)
        return { message, resolve, ...opts }
      })
    })
  }, [])
  const handleConfirmResult = useCallback(
    (result) => {
      confirmState?.resolve(result)
      setConfirmState(null)
    },
    [confirmState]
  )
  return { confirmState, confirmAction, handleConfirmResult }
}
