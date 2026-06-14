# Glowbe Studio (web)

React + Vite SPA (English UI). Polls `GET /api/v1/state` and `GET /health` once per second.

## Routes

Single-page UI at **`/`** (scroll: mode badges → mode-specific controls → runtime status). Any other path redirects to **`/`** (SPA fallback / old bookmarks).

## Development

```bash
npm install
npm run dev
```

The Vite dev server proxies `/api` and `/health` to `http://127.0.0.1:8080` by default. For a runtime on another host:

```bash
GLOWBE_RUNTIME_URL=http://192.168.0.10:8080 npm run dev
```

For a static build that talks to another origin, set `VITE_GLOWBE_API_BASE` at build time:

```bash
VITE_GLOWBE_API_BASE=http://192.168.0.10:8080 npm run build
```

## Static hosting (SPA)

Client-side routes only normalize legacy URLs to **`/`**; the app is effectively a single view. Static hosting must still serve `index.html` for unknown paths. `npm run preview` does this automatically.

## Scripts

- `npm run lint`
- `npm run build`
- `npm run preview`
