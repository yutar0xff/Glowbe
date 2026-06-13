# Glowbe Web Dashboard

Phase 1.5 の読み取り専用ダッシュボード。`GET /api/v1/state` と `GET /health` を 1 秒ごとにポーリングし、ランタイム・ESP の状態を表示する。

## Development

```bash
npm install
npm run dev
```

Vite dev server は既定で `/api` と `/health` を `http://127.0.0.1:8080` へプロキシする。別ホストの runtime に接続する場合:

```bash
GLOWBE_RUNTIME_URL=http://192.168.0.10:8080 npm run dev
```

静的ビルド後に別オリジンの API を叩く場合は、ビルド時に `VITE_GLOWBE_API_BASE` を指定する。

```bash
VITE_GLOWBE_API_BASE=http://192.168.0.10:8080 npm run build
```

## Scripts

- `npm run lint`
- `npm run build`
- `npm run preview`
