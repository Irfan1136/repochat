import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import './styles.css'

// Motion is on unless the visitor asked their device for less of it.
if (!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) document.documentElement.dataset.anim = '1'

createRoot(document.getElementById('root')).render(<App />)
