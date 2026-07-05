import path from 'node:path'
import { fileURLToPath } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

const rootDir = path.dirname(fileURLToPath(import.meta.url))

/** Vite `server.allowedHosts` / `preview.allowedHosts`（`GLOWBE_ALLOWED_HOSTS`） */
function parseAllowedHosts(
  raw: string | undefined,
): true | string[] | undefined {
  const v = raw?.trim()
  if (!v) return undefined
  const lower = v.toLowerCase()
  if (lower === 'true' || lower === 'all' || lower === '*') return true
  const hosts = v
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  return hosts.length ? hosts : undefined
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, rootDir, '')
  const runtimeTarget =
    env.GLOWBE_RUNTIME_URL?.trim() || 'http://127.0.0.1:8748'
  const previewPort = Number(env.GLOWBE_PREVIEW_PORT) || 8090
  const allowedHosts = parseAllowedHosts(env.GLOWBE_ALLOWED_HOSTS)

  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(rootDir, './src'),
        '@glowbe/core': path.resolve(rootDir, '../packages/core/src/index.ts'),
        'shadcn/tailwind.css': path.resolve(
          rootDir,
          'node_modules/shadcn/dist/tailwind.css',
        ),
      },
    },
    server: {
      ...(allowedHosts !== undefined ? { allowedHosts } : {}),
      proxy: {
        '/api': {
          target: runtimeTarget,
          ws: true,
        },
        '/health': runtimeTarget,
      },
    },
    preview: {
      host: true,
      port: previewPort,
      strictPort: true,
      ...(allowedHosts !== undefined ? { allowedHosts } : {}),
      proxy: {
        '/api': {
          target: runtimeTarget,
          ws: true,
        },
        '/health': runtimeTarget,
      },
    },
  }
})
