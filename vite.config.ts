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
      // Google OAuth must hit the LOCALLY running Node server
      // (npm run build:server && node dist-server/server.js — see DEPLOY.md
      // §9 for the env vars). `changeOrigin` is deliberately left off so the
      // server sees Host `localhost:5173` and the OAuth callback redirects
      // back to the dev origin instead of the production host.
      '/api/google': {
        target: 'http://127.0.0.1:3000',
      },
    },
  },
})