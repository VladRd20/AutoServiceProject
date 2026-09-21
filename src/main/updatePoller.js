// Planificator pentru verificarea periodica a actualizarilor (logica pura, testata).
//
//  * la fiecare `intervalMs` (implicit 10 min) +/- `jitterMs`: PC-urile unui service
//    nu lovesc GitHub toate in aceeasi secunda si nu se sincronizeaza intre ele;
//  * la esec (fara internet, GitHub indisponibil) intervalul se dubleaza pana la
//    `maxBackoffMs` (1 h) si revine la normal dupa primul succes - nu batem un server
//    care nu raspunde si nu consumam bateria/reteaua degeaba;
//  * `nudge()` (ex: fereastra a primit din nou focusul) verifica imediat DOAR daca
//    ultima verificare e mai veche de `minGapMs` (5 min);
//  * `pause()` opreste verificarile cand exista deja o versiune noua (gasita sau
//    descarcata) - nu are rost sa mai intrebam.
export function createUpdatePoller({
  check,
  intervalMs = 10 * 60 * 1000,
  jitterMs = 60 * 1000,
  minGapMs = 5 * 60 * 1000,
  maxBackoffMs = 60 * 60 * 1000,
  now = () => Date.now(),
  random = Math.random,
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (t) => clearTimeout(t)
}) {
  let timer = null
  let running = false
  let paused = true
  let failures = 0
  let lastCheckAt = 0

  function nextDelay() {
    const base = Math.min(intervalMs * 2 ** failures, maxBackoffMs)
    const jitter = (random() * 2 - 1) * jitterMs
    return Math.max(1000, Math.round(base + jitter))
  }

  function schedule() {
    if (timer) clearTimer(timer)
    timer = null
    if (paused) return
    timer = setTimer(tick, nextDelay())
  }

  async function tick() {
    timer = null
    if (paused || running) return schedule()
    running = true
    try {
      const ok = await check()
      failures = ok === false ? Math.min(failures + 1, 10) : 0
    } catch {
      failures = Math.min(failures + 1, 10)
    } finally {
      lastCheckAt = now()
      running = false
    }
    schedule()
  }

  return {
    // `initialCheckDone`: true daca o verificare tocmai s-a facut (la pornire) - o numaram.
    start({ initialCheckDone = false } = {}) {
      paused = false
      if (initialCheckDone) lastCheckAt = now()
      schedule()
    },
    pause() {
      paused = true
      if (timer) clearTimer(timer)
      timer = null
    },
    resume() {
      if (!paused) return
      paused = false
      schedule()
    },
    nudge() {
      if (paused || running) return false
      if (now() - lastCheckAt < minGapMs) return false
      if (timer) clearTimer(timer)
      timer = null
      tick()
      return true
    },
    // Pentru teste / diagnostic
    state: () => ({ paused, running, failures, lastCheckAt, scheduled: timer !== null })
  }
}
