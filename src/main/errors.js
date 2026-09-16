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
  ENOSPC: 'Nu mai este spatiu liber pe disc. Elibereaza spatiu si incearca din nou.',
  EACCES: 'Acces refuzat la fisier/folder. Verifica permisiunile sau ruleaza ca administrator.',
  EPERM: 'Acces refuzat la fisier/folder. Verifica permisiunile sau ruleaza ca administrator.',
  ENOENT: 'Fisierul sau folderul nu a fost gasit.',
  EBUSY: 'Fisierul este folosit de alt program. Inchide-l si incearca din nou.'
}

// Transforma o eroare bruta de Node (fs, etc) intr-un AppError cu mesaj uman.
export function toAppError(err, fallbackMessage) {
  if (err instanceof AppError) return err
  const code = err?.code
  const userMessage = MESAJE[code] || fallbackMessage || 'A aparut o problema neasteptata.'
  return new AppError(code || 'UNKNOWN', userMessage, err)
}
