import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const runtimeTarget = process.env.GLOWBE_RUNTIME_URL ?? 'http://127.0.0.1:8080'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: runtimeTarget,
        ws: true,
      },
      '/health': runtimeTarget,
    },
  },
})
