# 環境変数（Glowbe）

## Web（`web/`）

| 変数 | 読み込み | 説明 |
|------|----------|------|
| `GLOWBE_RUNTIME_URL` | `vite.config.ts` | `/api`・`/health` のプロキシ先。既定 `http://127.0.0.1:8748` |
| `GLOWBE_PREVIEW_PORT` | 同上 | `vite preview` の TCP ポート。既定 `8090` |
| `GLOWBE_ALLOWED_HOSTS` | 同上 | `server.allowedHosts` と `preview.allowedHosts`。カンマ区切りのホスト名、または `true` / `*`（全ホスト許可・注意） |
| `VITE_GLOWBE_API_BASE` | ブラウザ（ビルド時埋め込み） | API の絶対 URL。空なら相対 URL |

Vite: `.env.development`、`.env.production`、および gitignore される `.env.*.local`。テンプレートは `web/.env.example`。

## systemd

`glowbe-web.service` の `EnvironmentFile=-/etc/glowbe/web.env`。雛形は `deploy/systemd/glowbe-web.env.example`。配置前に `sudo mkdir -p /etc/glowbe`。

## ランタイム

HTTP ポートは `config.toml` の `[server] bind` のみ。
