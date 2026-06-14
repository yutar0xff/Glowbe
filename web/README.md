# Glowbe Web Dashboard

React + Vite SPA (English UI). Polls `GET /api/v1/state` and `GET /health` once per second.

## Routes

| Path | Purpose |
|------|---------|
| `/` | Status metrics and raw JSON |
| `/mode` | Mode overview: **Idle** on/off (blackout, clears sequence), links to Loop and Ripple |
| `/mode/loop` | Sequence selection; sets runtime mode to `loop` when opened |
| `/mode/ripple` | UV map + WebSocket controls; sets runtime mode to `ripple` when opened |

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

Client-side routes (`/mode/loop`, etc.) require the host to serve `index.html` for unknown paths (same as any SPA). `npm run preview` does this automatically.

## Scripts

- `npm run lint`
- `npm run build`
- `npm run preview`
