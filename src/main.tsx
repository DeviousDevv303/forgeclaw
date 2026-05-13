import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

console.log('[ForgeClaw BOOT] main.tsx reached')

const rootElement = document.getElementById('root')
if (!rootElement) {
  console.error('[ForgeClaw BOOT FAIL] #root element not found')
  document.body.innerHTML =
    '<pre style="color:#f97316;background:#050505;padding:16px;font-family:monospace">ForgeClaw boot failed: #root not found</pre>'
} else {
  try {
    createRoot(rootElement).render(
      <StrictMode>
        <App />
      </StrictMode>,
    )
    console.log('[ForgeClaw BOOT] React mounted successfully')
  } catch (e) {
    console.error('[ForgeClaw BOOT FAIL]', e)
    document.body.innerHTML =
      '<pre style="color:#f97316;background:#050505;padding:16px;font-family:monospace">ForgeClaw boot failed. Check console for error.</pre>'
  }
}
