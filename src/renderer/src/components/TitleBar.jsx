import React, { useEffect, useRef } from 'react'
import Icon from './Icon'

// Bara de titlu proprie, in tema aplicatiei (fundal ca al barei laterale, in ambele
// teme). Windows deseneaza doar butoanele ferestrei (overlay) - culorile lor sunt
// sincronizate cu bara la pornire si la fiecare schimbare de tema (manuala sau a sistemului).
export default function TitleBar() {
  const ref = useRef(null)

  useEffect(() => {
    let timer = null
    function sync() {
      const el = ref.current
      if (!el) return
      const cs = getComputedStyle(el)
      window.serviceAuto?.app
        ?.setTitleBarColors?.({ color: cs.backgroundColor, symbolColor: cs.color })
        .catch?.(() => {})
    }
    // tranzitiile de culoare din tema (styles.css) dureaza putin: citim culoarea dupa ce s-au asezat
    const schedule = () => {
      clearTimeout(timer)
      timer = setTimeout(sync, 250)
    }
    sync()
    schedule()
    const mo = new MutationObserver(schedule)
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)')
    mq?.addEventListener?.('change', schedule)
    return () => {
      clearTimeout(timer)
      mo.disconnect()
      mq?.removeEventListener?.('change', schedule)
    }
  }, [])

  return (
    <div className="titlebar" ref={ref}>
      <span className="titlebar-brand">
        <Icon name="wrench" size={14} />
        Service Auto
      </span>
    </div>
  )
}
