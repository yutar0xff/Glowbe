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

### 1. 機械用設定 `/etc/glowbe/glowbe.env`

`GLOWBE_ROOT` に **リポジトリの絶対パス**を書く（clone 先がどこでもよい）。`GLOWBE_RUNTIME_URL` など preview 用の変数もここにまとめます。

```bash
sudo mkdir -p /etc/glowbe
sudo cp deploy/systemd/glowbe.env.example /etc/glowbe/glowbe.env
sudo nano /etc/glowbe/glowbe.env
```

`*.service` の `User` / `Group` は、このマシンでランタイムと preview を動かす UNIX ユーザーに合わせて編集してください（既定は `main`）。

### 2. ランタイムのビルド

```bash
cd /path/to/Glowbe/runtime
cargo build --release
```

### 3. Web のビルド（preview はビルド成果物を使います）

```bash
cd /path/to/Glowbe/web
npm ci
npm run build
```

### 4. unit をインストール

systemd は `WorkingDirectory` と `ExecStart` の実行ファイルに **リテラルの絶対パス**を要求するため、`GLOWBE_ROOT` は unit 内の `bash -c` で展開しています（`systemd-analyze verify` で確認済み）。

リポジトリのルートで:

```bash
sudo cp deploy/systemd/glowbe-runtime.service /etc/systemd/system/
sudo cp deploy/systemd/glowbe-web.service /etc/systemd/system/
sudo systemctl daemon-reload
```

`glowbe-web-preview.sh` に実行権限:

```bash
chmod +x deploy/systemd/glowbe-web-preview.sh
```

### 5. 有効化と起動

```bash
sudo systemctl enable --now glowbe-runtime.service
sudo systemctl enable --now glowbe-web.service
```

Web だけ手元で試す場合は `glowbe-web` を無効のままにしても構いません。

### 6. 状態確認

```bash
systemctl status glowbe-runtime.service
systemctl status glowbe-web.service
journalctl -u glowbe-runtime.service -f
```

LAN 側のブラウザでは `http://<サーバIP>:8090` を開き、ランタイムだけ試す場合は `http://<サーバIP>:8748/health` などで確認できます。

## Audio Visualizer

Studio の Audio タブでは次の入力を使えます。

1. **タブ音声キャプチャ（PC）** — `getDisplayMedia` で別タブ（YouTube Music 等）の音声を取り込み、解析のみ（二重再生しない）。デスクトップ Chrome 向け。
2. **ホスト PipeWire マイク（任意）** — ブラウザ ingest をしていないときだけ選択可能。

Studio が PCM を **`/api/v1/ws/audio-ingest`** へ送り、Runtime の Visualizer が LED を駆動します。

### 任意: ホスト PipeWire

```bash
# Ubuntu / Debian 例（ホストマイク用）
sudo apt install pipewire pipewire-bin pipewire-audio
```

ランタイムの実行ユーザー（unit の `User=`、既定 `main`）がログインセッションの PipeWire に届く必要があります。`glowbe-runtime.service` は `XDG_RUNTIME_DIR=/run/user/%U` を設定します。

```toml
[audio]
default_input = "alsa_input.usb-example.mono-fallback"
```

### 流れ（タブキャプチャ）

1. Studio Audio で Capture tab audio
2. 共有ダイアログで対象タブを選び、タブ音声をオン

### 権限・トラブル

| 症状 | 確認 |
|------|------|
| タブに音声がない | 「タブの音声も共有」にチェック（Chrome） |
| スマホでタブキャプチャ不可 | ホストマイクを使うか、PC ブラウザから操作 |
| ホストマイク unavailable | `pw-cli` / `XDG_RUNTIME_DIR` |
| Windows ホスト | PipeWire マイクは利用不可。タブキャプチャはクライアント側 |
