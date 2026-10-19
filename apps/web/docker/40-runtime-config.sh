#!/bin/sh
# Writes /config.js from container env so one image works for any bot/domain.
# Run by the nginx image's entrypoint (/docker-entrypoint.d) before nginx starts.
set -eu

json_escape() {
  printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g'
}

API_URL="${API_URL:-}"
# Accept "@name" or "name"
BOT_USERNAME="$(printf '%s' "${BOT_USERNAME:-}" | sed 's/^@//')"

cat > /usr/share/nginx/html/config.js <<CONFIG
window.__TBOT_CONFIG__ = { "apiUrl": "$(json_escape "$API_URL")", "botUsername": "$(json_escape "$BOT_USERNAME")" };
CONFIG

echo "runtime-config: apiUrl=${API_URL:-<build default>} botUsername=${BOT_USERNAME:-<build default>}"
