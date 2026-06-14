# systemd で LAN 公開

## ポートの選び方

デプロイ前に **対象マシン上** で次のコマンドを実行し、Glowbe が使う TCP ポートが他プロセスと重複していないか確認してください。

```bash
ss -tlnp
# または
sudo ss -tulpn
```

Glowbe が使う既定**例**（すべて `config.toml` や `web/.env.*` で変更可能）:

| 役割 | 既定例 | 設定の所在 |
|------|--------|-------------|
| ランタイム HTTP / WebSocket | **8748** | `config.toml` の `[server] bind` |
| Studio（`vite preview`） | **8090** | `web/.env.production` の `GLOWBE_PREVIEW_PORT` |
| フレーム UDP | **49152** | `config.toml` の `[output] udp_port` |
| STATUS UDP | **49153** | `config.toml` の `[output] status_port` |

他アプリと衝突する場合は上記をずらし、`web/vite.config.ts` のプロキシ先・ファイアウォール・ESP 側の受信ポート設定を一貫させてください。

- LAN からランタイムだけ試す: `http://<サーバのIP>:8748/health`（ポートは `bind` に従う）
- LAN から Studio（preview）: `http://<サーバのIP>:8090`（`GLOWBE_PREVIEW_PORT` に従う）。`/api` は同じマシン上のランタイムへプロキシ（`GLOWBE_RUNTIME_URL`、既定 `http://127.0.0.1:8748`）

手動で `glowbe-runtime` が動いている場合は、unit 有効化の前に停止してください（ポート競合します）。

## 手順

### 1. ランタイムのビルド

```bash
cd /path/to/Glowbe/runtime
cargo build --release
```

### 2. Web のビルド（preview はビルド成果物を使います）

```bash
cd /path/to/Glowbe/web
npm ci
npm run build
```

### 3. unit をインストール

リポジトリのルート（`Glowbe/`）で:

```bash
sudo cp deploy/systemd/glowbe-runtime.service /etc/systemd/system/
sudo cp deploy/systemd/glowbe-web.service /etc/systemd/system/
sudo systemctl daemon-reload
```

`*.service` の `User` / `Group` と `WorkingDirectory` / `ExecStart` の `%h/projects/Glowbe` は、ホーム直下に `projects/Glowbe` としてクローンした場合を想定しています。別の配置の場合は unit を編集してください。

（任意）ランタイムと別ホストで preview するなど、`GLOWBE_RUNTIME_URL` を変えたい場合:

```bash
sudo mkdir -p /etc/glowbe
sudo cp deploy/systemd/glowbe-web.env.example /etc/glowbe/web.env
sudo nano /etc/glowbe/web.env
```

`glowbe-web.service` は **`EnvironmentFile=-/etc/glowbe/web.env`** を読みます（ファイルが無くても起動します）。

`glowbe-web.service` は `deploy/systemd/glowbe-web-preview.sh` を実行します（nvm を読み込み、リポジトリ内の `web` で `vite preview`）。スクリプトに実行権限を付けてください。

```bash
chmod +x deploy/systemd/glowbe-web-preview.sh
```

### 4. 有効化と起動

```bash
sudo systemctl enable --now glowbe-runtime.service
sudo systemctl enable --now glowbe-web.service
```

Web だけ手元で試す場合は `glowbe-web` を無効のままにしても構いません。

### 5. 状態確認

```bash
systemctl status glowbe-runtime.service
systemctl status glowbe-web.service
journalctl -u glowbe-runtime.service -f
```

LAN 側のブラウザでは `http://<サーバIP>:8090` を開き、ランタイムだけ試す場合は `http://<サーバIP>:8748/health` などで確認できます。
