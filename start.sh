#!/usr/bin/env bash
# Copyright (c) 2026 xiayu
# Contact: 126240622+xiayu1987@users.noreply.github.com
# SPDX-License-Identifier: MIT
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
CLIENT_DIR="$ROOT_DIR/client/noobot-chat"
SERVICE_DIR="$ROOT_DIR/service"
PM2_HOME_DIR="$ROOT_DIR/.pm2"
CLIENT_APP_NAME="noobot-client"
SERVICE_APP_NAME="noobot-service"
CADDY_ADDR="${CADDY_ADDR:-:10060}"
API_UPSTREAM="${API_UPSTREAM:-127.0.0.1:10061}"
CLIENT_CADDY_BIN="$CLIENT_DIR/deploy/bin/caddy"
CLIENT_CADDY_CONFIG="$CLIENT_DIR/deploy/Caddyfile"
CLIENT_DIST_DIR="$CLIENT_DIR/dist"
FRONTEND_URL_ADDR="$CADDY_ADDR"
if [[ "$FRONTEND_URL_ADDR" == :* ]]; then
  FRONTEND_URL_ADDR="127.0.0.1$FRONTEND_URL_ADDR"
fi

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

update_code() {
  if git -C "$ROOT_DIR" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    local branch upstream
    branch="$(git -C "$ROOT_DIR" rev-parse --abbrev-ref HEAD)"
    upstream="$(git -C "$ROOT_DIR" rev-parse --abbrev-ref --symbolic-full-name "@{u}" 2>/dev/null || true)"

    if [[ -n "$upstream" ]]; then
      log "更新代码: git pull --rebase (branch: $branch, upstream: $upstream)"
      git -C "$ROOT_DIR" pull --rebase
    else
      log "当前分支($branch)未设置 upstream，跳过 git pull"
    fi
  else
    log "非 git 仓库，跳过代码更新"
  fi
}

start_pm2() {
  local app_name="$1"
  shift

  log "启动 PM2 服务: $app_name"
  run_pm2 start "$@"
}

main() {
  require_cmd npm

  [[ -d "$CLIENT_DIR" ]] || { echo "前端目录不存在: $CLIENT_DIR" >&2; exit 1; }
  [[ -d "$SERVICE_DIR" ]] || { echo "后端目录不存在: $SERVICE_DIR" >&2; exit 1; }
  mkdir -p "$PM2_HOME_DIR"

  # log "1/5 更新代码"
  # update_code

  log "2/5 安装依赖"
  npm --prefix "$CLIENT_DIR" install
  npm --prefix "$SERVICE_DIR" install

  log "3/5 构建前端"
  npm --prefix "$CLIENT_DIR" run build

  log "4/5 重建 PM2 服务"
  if pm2_has_app "$SERVICE_APP_NAME"; then
    run_pm2 delete "$SERVICE_APP_NAME"
  fi
  if pm2_has_app "$CLIENT_APP_NAME"; then
    run_pm2 delete "$CLIENT_APP_NAME"
  fi

  log "5/5 用 PM2 启动服务"
  export CADDY_ADDR API_UPSTREAM
  start_pm2 "$SERVICE_APP_NAME" npm --name "$SERVICE_APP_NAME" --cwd "$SERVICE_DIR" -- start
  start_pm2 "$CLIENT_APP_NAME" npm --name "$CLIENT_APP_NAME" --cwd "$CLIENT_DIR" -- run serve:caddy

  log "完成。当前 PM2 进程列表:"
  run_pm2 ls

  log "路径信息:"
  log "ROOT_DIR=$ROOT_DIR"
  log "CLIENT_DIR=$CLIENT_DIR"
  log "SERVICE_DIR=$SERVICE_DIR"
  log "PM2_HOME_DIR=$PM2_HOME_DIR"
  log "CLIENT_DIST_DIR=$CLIENT_DIST_DIR"
  log "CLIENT_CADDY_CONFIG=$CLIENT_CADDY_CONFIG"
  log "CLIENT_CADDY_BIN=$CLIENT_CADDY_BIN"
  log "前端访问地址: http://${FRONTEND_URL_ADDR}"
  log "后端 API(供前端反代): http://${API_UPSTREAM}"
}

main "$@"
