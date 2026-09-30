import { createRoot } from 'react-dom/client'
import { App } from './App'
import './styles.css'
import './refresh.css'
import './file-actions.css'
import './buttons.css'

const root = document.getElementById('root')!

if (!window.spoon) {
  root.innerHTML =
    '<div style="font:14px Segoe UI;padding:32px">Spoon could not connect to the desktop process. Close this window and run <code>npm run dev</code>.</div>'
} else {
  createRoot(root).render(<App />)
}
