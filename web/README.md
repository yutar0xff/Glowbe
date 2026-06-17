# Glowbe Studio (web)

React 19 + Vite 8 SPA (English UI). Styling: **Tailwind CSS v4** (`@tailwindcss/vite`), **shadcn/ui** (Radix Nova preset, Geist), **Lucide** icons. Polls `GET /api/v1/state` and `GET /health` once per second.

Imports use the `@/` alias (`tsconfig` paths → `./src/*`).

## Routes

Single-page UI at **`/`** (scroll: mode badges → mode-specific controls → runtime status). Any other path redirects to **`/`** (SPA fallback / old bookmarks).

## Development

Defaults: **`.env.development`** / **`.env.production`** (committed). Local overrides: **`.env.development.local`** / **`.env.production.local`** (gitignored). Keys: **`.env.example`**, full table: [`docs/ENV.md`](../docs/ENV.md).

```bash
npm install
npm run dev
```

Proxies `/api` and `/health` using **`GLOWBE_RUNTIME_URL`** from **`.env.development`** (default `http://127.0.0.1:8748`). Prefer editing **`.env.development.local`** for machine-specific overrides. For a one-off:

```bash
GLOWBE_RUNTIME_URL=http://192.168.0.10:8748 npm run dev
```

For a static build that talks to another origin, set **`VITE_GLOWBE_API_BASE`** at build time (or **`web/.env.production.local`**):

```bash
VITE_GLOWBE_API_BASE=http://192.168.0.10:8748 npm run build
```

## UI stack

- Tailwind v4 via `@import "tailwindcss"` in `src/index.css` and the Vite plugin.
- shadcn components live under `src/components/ui/` (registry: `npx shadcn@latest add …`).
- The `shadcn` npm package is a **devDependency** so `src/index.css` can `@import "shadcn/tailwind.css"` at build time.

## Static hosting (SPA)

Client-side routes redirect unknown paths to **`/`**; the app is effectively a single view. Static hosting must still serve `index.html` for unknown paths. `npm run preview` does this automatically.

## Scripts

- `npm run lint`
- `npm run build`
- `npm run preview`
