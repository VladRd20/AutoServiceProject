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
        <h1>A aparut o problema neasteptata</h1>
        <p>
          Aplicatia a intampinat o eroare. Am incercat sa salvam automat fisa la care lucrai
          inainte de repornire.
        </p>
        <button onClick={this.handleRestart}>Reporneste aplicatia</button>
      </div>
    )
  }
}
