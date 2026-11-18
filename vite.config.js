import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { viteSingleFile } from 'vite-plugin-singlefile'

// "npm run build" makes the normal site (dist/).
// "npm run build:single" makes one self-contained HTML file (dist-single/).
export default defineConfig(({ mode }) => ({
  base: process.env.VITE_BASE || '/', // '/repochat/' when published on GitHub Pages
  plugins: [react(), mode === 'single' && viteSingleFile()].filter(Boolean),
  build: mode === 'single' ? { outDir: 'dist-single' } : {},
}))
