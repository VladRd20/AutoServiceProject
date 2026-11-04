import React, { lazy } from 'react'

// import() dinamic care mai incearca o data daca chunk-ul nu s-a putut incarca
// (disc lent, antivirus care blocheaza scurt fisierul) inainte sa dea eroare.
export function lazyRetry(loader) {
  return lazy(() => loader().catch(() => new Promise((resolve) => setTimeout(resolve, 300)).then(() => loader())))
}

// Granita de eroare locala pentru modalele incarcate la cerere: un chunk care
// nu se incarca inchide doar modalul (cu un toast), nu intreaga aplicatie.
export default class LazyBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { failed: false }
  }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(error) {
    console.error('[LazyBoundary] modalul nu s-a putut incarca', error)
    const { showToast, onClose } = this.props
    showToast?.('error', 'Fereastra nu a putut fi deschisă. Încearcă din nou.')
    onClose?.()
  }

  render() {
    return this.state.failed ? null : this.props.children
  }
}
