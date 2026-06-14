#!/usr/bin/env bash
set -euo pipefail
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
# shellcheck source=/dev/null
[[ -s "$NVM_DIR/nvm.sh" ]] && . "$NVM_DIR/nvm.sh"
cd "$(dirname "$0")/../../web"
# ポートは web/.env.production の GLOWBE_PREVIEW_PORT（既定 8090）。CLI で上書きしない。
exec npm run preview -- --host 0.0.0.0
