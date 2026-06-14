#!/usr/bin/env bash
set -euo pipefail
: "${GLOWBE_ROOT:?Set GLOWBE_ROOT in /etc/glowbe/glowbe.env}"
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
# shellcheck source=/dev/null
[[ -s "$NVM_DIR/nvm.sh" ]] && . "$NVM_DIR/nvm.sh"
cd "$GLOWBE_ROOT/web"
exec npm run preview -- --host 0.0.0.0
