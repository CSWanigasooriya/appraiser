import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Tauri expects a fixed dev port (see src-tauri/tauri.conf.json).
  server: { port: 5173, strictPort: true },
  clearScreen: false,
})
