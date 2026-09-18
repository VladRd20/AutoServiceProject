// Eroare cu mesaj clar pentru utilizator, separat de detaliul tehnic (care merge doar in log).
export class AppError extends Error {
  constructor(code, userMessage, cause) {
    super(userMessage)
    this.name = 'AppError'
    this.code = code
    this.userMessage = userMessage
    this.cause = cause
  }
}

const MESAJE = {
  ENOSPC: 'Nu mai este spațiu liber pe disc. Eliberează spațiu și încearcă din nou.',
  EACCES: 'Acces refuzat la fișier/folder. Verifică permisiunile sau rulează ca administrator.',
  EPERM: 'Acces refuzat la fișier/folder. Verifică permisiunile sau rulează ca administrator.',
  ENOENT: 'Fișierul sau folderul nu a fost găsit.',
  EBUSY: 'Fișierul este folosit de alt program. Închide-l și încearcă din nou.'
}

// Transforma o eroare bruta de Node (fs, etc) intr-un AppError cu mesaj uman.
export function toAppError(err, fallbackMessage) {
  if (err instanceof AppError) return err
  const code = err?.code
  const userMessage = MESAJE[code] || fallbackMessage || 'A apărut o problemă neașteptată.'
  return new AppError(code || 'UNKNOWN', userMessage, err)
}
