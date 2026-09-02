import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/ics': {
        target: 'https://calendar.f1nn.me',
        changeOrigin: true,
      },
      '/api/storage': {
        target: 'https://calendar.f1nn.me',
        changeOrigin: true,
      },
    },
  },
})