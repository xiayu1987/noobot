#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLIENT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
NOOBOT_DIR="$(cd "$CLIENT_DIR/../.." && pwd)"
SERVICE_DIR="$NOOBOT_DIR/service"
PM2_HOME_DIR="$NOOBOT_DIR/.pm2"
PM2_APP_NAME="${PM2_APP_NAME:-noobot-client}"

if PM2_HOME="$PM2_HOME_DIR" npx pm2 describe "$PM2_APP_NAME" >/dev/null 2>&1; then
  echo "[restart-caddy] pm2 app exists, restarting: $PM2_APP_NAME"
  (cd "$SERVICE_DIR" && PM2_HOME="$PM2_HOME_DIR" npx pm2 restart "$PM2_APP_NAME")
else
  echo "[restart-caddy] pm2 app not found, starting: npm run serve:caddy"
  (cd "$CLIENT_DIR" && nohup npm run serve:caddy >/tmp/noobot-caddy.log 2>&1 < /dev/null &)
fi
