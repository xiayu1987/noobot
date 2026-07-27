#!/usr/bin/env bash
# Copyright (c) 2026 xiayu
# Contact: 126240622+xiayu1987@users.noreply.github.com
# SPDX-License-Identifier: MIT
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
CLIENT_DIR="$ROOT_DIR/client/noobot-chat"
SERVICE_DIR="$ROOT_DIR/service"
AGENT_PROXY_DIR="$ROOT_DIR/agent-proxy"
PM2_HOME_DIR="$ROOT_DIR/.pm2"
PM2_LOG_ROTATE_ENABLED="${PM2_LOG_ROTATE_ENABLED:-true}"
PM2_LOG_ROTATE_MAX_SIZE="${PM2_LOG_ROTATE_MAX_SIZE:-20M}"
PM2_LOG_ROTATE_RETAIN="${PM2_LOG_ROTATE_RETAIN:-14}"
PM2_LOG_ROTATE_WORKER_INTERVAL="${PM2_LOG_ROTATE_WORKER_INTERVAL:-3600}"
CLIENT_APP_NAME="noobot-client"
SERVICE_APP_NAME="noobot-service"
AGENT_PROXY_APP_NAME="noobot-agent-proxy"
CADDY_ADDR="${CADDY_ADDR:-:10060}"
AGENT_PROXY_UPSTREAM="${AGENT_PROXY_UPSTREAM:-127.0.0.1:10062}"
AGENT_PROXY_PORT="${AGENT_PROXY_PORT:-10062}"
AGENT_PROXY_HOST="${AGENT_PROXY_HOST:-127.0.0.1}"
AGENT_PROXY_UPSTREAM_WS_URL="${AGENT_PROXY_UPSTREAM_WS_URL:-ws://127.0.0.1:10061/chat/ws}"
AGENT_PROXY_UPSTREAM_HTTP_BASE="${AGENT_PROXY_UPSTREAM_HTTP_BASE:-http://127.0.0.1:10061}"

run_pm2() {
  (cd "$SERVICE_DIR" && PM2_HOME="$PM2_HOME_DIR" npx pm2 "$@")
}

pm2_has_app() {
  run_pm2 describe "$1" >/dev/null 2>&1
}

pm2_log_rotation_enabled() {
  case "${PM2_LOG_ROTATE_ENABLED,,}" in
    1|true|yes|on) return 0 ;;
    *) return 1 ;;
  esac
}

ensure_pm2_log_rotation() {
  pm2_log_rotation_enabled || return 0
  if ! run_pm2 describe pm2-logrotate >/dev/null 2>&1; then
    echo "Installing PM2 log rotation module"
    if ! run_pm2 install pm2-logrotate; then
      echo "Warning: PM2 log rotation module could not be installed." >&2
      return 0
    fi
  fi
  run_pm2 set pm2-logrotate:max_size "$PM2_LOG_ROTATE_MAX_SIZE"
  run_pm2 set pm2-logrotate:retain "$PM2_LOG_ROTATE_RETAIN"
  run_pm2 set pm2-logrotate:compress true
  run_pm2 set pm2-logrotate:workerInterval "$PM2_LOG_ROTATE_WORKER_INTERVAL"
  run_pm2 set pm2-logrotate:rotateModule true
}

[[ -d "$CLIENT_DIR" ]] || { echo "前端目录不存在: $CLIENT_DIR" >&2; exit 1; }
[[ -d "$SERVICE_DIR" ]] || { echo "后端目录不存在: $SERVICE_DIR" >&2; exit 1; }
[[ -d "$AGENT_PROXY_DIR" ]] || { echo "代理目录不存在: $AGENT_PROXY_DIR" >&2; exit 1; }
mkdir -p "$PM2_HOME_DIR"
ensure_pm2_log_rotation

export CADDY_ADDR AGENT_PROXY_UPSTREAM
export AGENT_PROXY_PORT AGENT_PROXY_HOST AGENT_PROXY_UPSTREAM_WS_URL AGENT_PROXY_UPSTREAM_HTTP_BASE
if pm2_has_app "$SERVICE_APP_NAME"; then
  run_pm2 restart "$SERVICE_APP_NAME" --update-env
else
  run_pm2 start npm --name "$SERVICE_APP_NAME" --cwd "$SERVICE_DIR" -- start
fi

if pm2_has_app "$AGENT_PROXY_APP_NAME"; then
  run_pm2 restart "$AGENT_PROXY_APP_NAME" --update-env
else
  run_pm2 start npm --name "$AGENT_PROXY_APP_NAME" --cwd "$AGENT_PROXY_DIR" -- start
fi

if pm2_has_app "$CLIENT_APP_NAME"; then
  run_pm2 restart "$CLIENT_APP_NAME" --update-env
else
  run_pm2 start npm --name "$CLIENT_APP_NAME" --cwd "$CLIENT_DIR" -- run serve:caddy
fi

run_pm2 ls
