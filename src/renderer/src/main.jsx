import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import ErrorBoundary from './ErrorBoundary'
import LicenseGate from './LicenseGate'
import { initTheme } from './theme'
import './styles.css'

// Cat mai devreme, inainte de primul render, ca sa nu clipeasca tema gresita.
initTheme()

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <LicenseGate>
        <App />
      </LicenseGate>
    </ErrorBoundary>
  </React.StrictMode>
)
