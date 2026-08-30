import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { icsProxyPlugin } from './src/server/viteIcsProxyPlugin.ts'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), icsProxyPlugin()],
})
