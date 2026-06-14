import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const runtimeTarget = process.env.GLOWBE_RUNTIME_URL ?? 'http://127.0.0.1:8080'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
        'shadcn/tailwind.css': path.resolve(__dirname, 'node_modules/shadcn/dist/tailwind.css'),
      },
  },
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
