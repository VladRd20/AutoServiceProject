import React from 'react'
import { trySaveBackup } from './draftBackup'

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false }
    this.backupPromise = null
  }

  static getDerivedStateFromError() {
    return { hasError: true }
  }

  componentDidCatch(error, info) {
    console.error('[ErrorBoundary] eroare neasteptata in UI', error, info)
    this.backupPromise = trySaveBackup()
  }

  handleRestart = async () => {
    // Un draft care face UI-ul sa cada nu trebuie redeschis automat la repornire (bucla de crash).
    try {
      window.localStorage.removeItem('lastOpenDraftId')
    } catch {
      // localStorage indisponibil
    }
    // Asteptam salvarea de urgenta ca reload-ul sa nu o intrerupa.
    try {
      await this.backupPromise
    } catch {
      // ignoram - reload oricum
    }
    window.location.reload()
  }

  render() {
    if (!this.state.hasError) return this.props.children

    return (
      <div className="crash-screen">
        <h1>A apărut o problemă neașteptată</h1>
        <p>
          Aplicația a întâmpinat o eroare. Am încercat să salvăm automat fișa la care lucrai
          înainte de repornire.
        </p>
        <button onClick={this.handleRestart}>Repornește aplicația</button>
      </div>
    )
  }
}
