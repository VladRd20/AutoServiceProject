// Autosave pentru fisa curenta, ca modul pur (fara React) - testabil in Node.
//
// Garantii:
//  * salvarile sunt SERIALIZATE (una dupa alta): doua salvari fara id nu pot
//    crea doua drafturi, iar o salvare veche nu poate depasi una noua;
//  * flush() salveaza IMEDIAT ce e nesalvat si asteapta orice salvare in curs
//    - se apeleaza inainte de a comuta pe alta fisa, la inchiderea ferestrei
//    si inainte de finalizare;
//  * la esec ("disc plin", folder blocat) starea devine 'error', ramane
//    "murdar" si se reincearca automat la fiecare `retryMs`;
//  * reset() schimba documentul: orice salvare programata sau in curs pentru
//    documentul vechi nu mai are voie sa influenteze pe cel nou.

// Doua versiuni ale fisei sunt "la fel" daca toate campurile de la primul nivel
// sunt aceleasi referinte, cu exceptia id-ului (UI-ul face actualizari
// imutabile, deci o referinta neschimbata = continut neschimbat).
export function sameExceptId(a, b) {
  if (a === b) return true
  if (!a || !b) return false
  const keys = new Set([...Object.keys(a), ...Object.keys(b)])
  for (const k of keys) if (k !== 'id' && a[k] !== b[k]) return false
  return true
}

export function createAutosaver({
  save,
  delayMs = 1000,
  retryMs = 5000,
  onState = () => {},
  onId = () => {},
  now = () => new Date(),
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (t) => clearTimeout(t)
}) {
  let doc = null // ultima versiune primita prin update()
  let savedDoc = null // ultima versiune cunoscuta ca fiind pe disc
  let currentId = null
  let gen = 0
  let timer = null
  let retryTimer = null
  let chain = Promise.resolve(true)
  let state = 'idle'
  let lastError = null
  let savedAt = null
  let disposed = false

  function setState(next, extra = {}) {
    state = next
    lastError = extra.error || null
    if (next === 'saved') savedAt = now()
    onState({ state, error: lastError, savedAt })
  }

  const isDirty = () => Boolean(doc) && !sameExceptId(doc, savedDoc)

  function clearTimers() {
    if (timer) clearTimer(timer)
    if (retryTimer) clearTimer(retryTimer)
    timer = retryTimer = null
  }

  async function run(myGen) {
    if (disposed || myGen !== gen) return true
    if (!isDirty()) return true
    const snapshot = doc
    const payload = snapshot.id || !currentId ? snapshot : { ...snapshot, id: currentId }
    setState('saving')
    let res
    try {
      res = await save(payload)
    } catch (err) {
      res = { ok: false, error: { message: err?.message || String(err) } }
    }
    if (myGen !== gen) return Boolean(res?.ok) // documentul s-a schimbat intre timp
    if (!res?.ok) {
      setState('error', { error: res?.error })
      scheduleRetry(myGen)
      return false
    }
    if (!currentId && res.data) {
      currentId = res.data
      if (!snapshot.id) onId(currentId, snapshot)
    }
    savedDoc = snapshot
    // Daca utilizatorul a mai scris cat timp se salva, ramane programata urmatoarea salvare.
    if (isDirty()) setState('saving')
    else setState('saved')
    return true
  }

  function enqueue() {
    const myGen = gen
    chain = chain.then(
      () => run(myGen),
      () => run(myGen)
    )
    return chain
  }

  function scheduleRetry(myGen) {
    if (retryTimer) clearTimer(retryTimer)
    retryTimer = setTimer(() => {
      retryTimer = null
      if (myGen === gen && isDirty()) enqueue()
    }, retryMs)
  }

  return {
    // Apelat la fiecare schimbare a fisei.
    update(fisa) {
      if (disposed) return
      doc = fisa
      if (!isDirty()) return
      if (timer) clearTimer(timer)
      // Prima salvare a unei fise noi (fara id) e imediata: apare direct in
      // "Fise in lucru"; urmatoarele asteapta ca utilizatorul sa se opreasca din tastat.
      const delay = !fisa.id && !currentId ? 0 : delayMs
      const myGen = gen
      timer = setTimer(() => {
        timer = null
        if (myGen === gen) enqueue()
      }, delay)
    },

    // Salveaza acum tot ce e nesalvat si asteapta terminarea. true = totul e pe disc.
    flush() {
      if (timer) {
        clearTimer(timer)
        timer = null
      }
      return enqueue()
    },

    // Comuta pe alt document. `clean: true` = documentul vine de pe disc (nimic de salvat).
    reset(fisa, { clean = false } = {}) {
      gen += 1
      clearTimers()
      doc = fisa || null
      savedDoc = clean ? doc : null
      currentId = fisa?.id || null
      setState(clean && fisa ? 'saved' : 'idle')
    },

    getId: () => currentId,
    getState: () => ({ state, error: lastError, savedAt }),
    isDirty,

    dispose() {
      disposed = true
      gen += 1
      clearTimers()
    }
  }
}
