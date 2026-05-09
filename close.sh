#!/usr/bin/env bash
# Copyright (c) 2026 xiayu
# Contact: 126240622+xiayu1987@users.noreply.github.com
# SPDX-License-Identifier: MIT
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
SERVICE_DIR="$ROOT_DIR/service"
AGENT_PROXY_DIR="$ROOT_DIR/agent-proxy"
PM2_HOME_DIR="$ROOT_DIR/.pm2"
CLIENT_APP_NAME="noobot-client"
SERVICE_APP_NAME="noobot-service"
AGENT_PROXY_APP_NAME="noobot-agent-proxy"

log() {
  echo "[$(date '+%F %T')] $*"
}

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "缺少命令: $1" >&2
    exit 1
  fi
}

run_pm2() {
  (cd "$SERVICE_DIR" && PM2_HOME="$PM2_HOME_DIR" npx pm2 "$@")
}

pm2_has_app() {
  run_pm2 describe "$1" >/dev/null 2>&1
}

stop_and_delete_app() {
  local app_name="$1"
  if pm2_has_app "$app_name"; then
    log "停止并删除 PM2 服务: $app_name"
    run_pm2 delete "$app_name"
  else
    log "PM2 服务不存在，跳过: $app_name"
  fi
}

kill_pm2_daemon() {
  log "关闭 PM2 守护进程..."
  run_pm2 kill || true
}

cleanup_orphaned_client_processes() {
  log "清理遗留前端进程..."
  pkill -f "$ROOT_DIR/client/noobot-chat/deploy/bin/caddy run" || true
  pkill -f "npm run serve:caddy" || true
}

cleanup_orphaned_service_processes() {
  log "清理遗留后端进程..."
  pkill -f "$ROOT_DIR/service/app.js" || true
}

cleanup_orphaned_agent_proxy_processes() {
  log "清理遗留代理进程..."
  pkill -f "$ROOT_DIR/agent-proxy/agent-proxy.js" || true
}

main() {
  require_cmd npm

  [[ -d "$SERVICE_DIR" ]] || { echo "后端目录不存在: $SERVICE_DIR" >&2; exit 1; }
  [[ -d "$AGENT_PROXY_DIR" ]] || { echo "代理目录不存在: $AGENT_PROXY_DIR" >&2; exit 1; }

  log "关闭 noobot 服务..."
  stop_and_delete_app "$CLIENT_APP_NAME"
  stop_and_delete_app "$SERVICE_APP_NAME"
  stop_and_delete_app "$AGENT_PROXY_APP_NAME"
  kill_pm2_daemon
  cleanup_orphaned_client_processes
  cleanup_orphaned_service_processes
  cleanup_orphaned_agent_proxy_processes

  log "当前 PM2 进程列表:"
  run_pm2 ls || true

  log "已完成关闭。"
}

main "$@"
