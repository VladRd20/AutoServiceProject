import React from 'react'
import { trySaveBackup } from './draftBackup'

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError() {
    return { hasError: true }
  }

  componentDidCatch(error, info) {
    // eslint-disable-next-line no-console
    console.error('[ErrorBoundary] eroare neasteptata in UI', error, info)
    trySaveBackup()
  }

  handleRestart = () => {
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
