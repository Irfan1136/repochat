// Edit these lines. Nothing else needs to change.
export const DEVELOPER = 'Mohamed Irfan'
export const PORTFOLIO_URL = 'https://irfan1136.github.io/portfolio11/' // your live portfolio site (github.io), not the code page
export const LOGO_URL = (import.meta.env?.BASE_URL || '/') + 'logo.svg' // replace the file public/logo.svg with your own logo

// Where the AI server (api/explain.js) lives. Empty = the same site (Vercel).
// On GitHub Pages, set the repository variable VITE_API_URL to your Vercel address, e.g. https://repochat.vercel.app
const api = import.meta.env?.VITE_API_URL || ''
export const API_URL = /^https:\/\/[\w.-]+(:\d+)?$/.test(api.replace(/\/$/, '')) ? api.replace(/\/$/, '') : ''
