#!/usr/bin/env bash
# Copyright (c) 2026 xiayu
# Contact: 126240622+xiayu1987@users.noreply.github.com
# SPDX-License-Identifier: MIT
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
SERVICE_DIR="$ROOT_DIR/service"
AGENT_PROXY_DIR="$ROOT_DIR/agent-proxy"
MODEL_PROXY_DIR="$ROOT_DIR/model-proxy"
PM2_HOME_DIR="$ROOT_DIR/.pm2"
CLIENT_APP_NAME="noobot-client"
SERVICE_APP_NAME="noobot-service"
AGENT_PROXY_APP_NAME="noobot-agent-proxy"
MODEL_PROXY_APP_NAME="noobot-model-proxy"
PM2_PID_FILE="$PM2_HOME_DIR/pm2.pid"

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
  local err_file out_file
  err_file="$(mktemp)"
  out_file="$(mktemp)"
  (cd "$SERVICE_DIR" && PM2_HOME="$PM2_HOME_DIR" npx --no-install pm2 "$@" >"$out_file" 2>"$err_file")
  local exit_code=$?
  if [[ "$exit_code" -eq 0 ]]; then
    cat "$out_file"
    rm -f "$out_file" "$err_file"
    return 0
  fi

  local err_text out_text combined_text
  err_text="$(cat "$err_file" 2>/dev/null || true)"
  out_text="$(cat "$out_file" 2>/dev/null || true)"
  rm -f "$out_file" "$err_file"
  combined_text="${out_text}"$'\n'"${err_text}"

  if echo "$combined_text" | grep -qiE "Cannot find module .*pm2|ProcessContainerFork\\.js|could not determine executable to run|pm2: not found"; then
    log "pm2 missing/broken detected, reinstall pm2 and retry once"
    rm -rf "$SERVICE_DIR/node_modules/pm2" "$SERVICE_DIR/node_modules/.bin/pm2"
    (cd "$SERVICE_DIR" && npm install pm2@latest --no-save)
    (cd "$SERVICE_DIR" && PM2_HOME="$PM2_HOME_DIR" npx --no-install pm2 "$@")
    return $?
  fi

  echo "$combined_text" >&2
  return "$exit_code"
}

pm2_has_app() {
  pm2_daemon_running || return 1
  run_pm2 describe "$1" >/dev/null 2>&1
}

pm2_daemon_running() {
  local daemon_pid
  [[ -r "$PM2_PID_FILE" ]] || return 1
  daemon_pid="$(cat "$PM2_PID_FILE" 2>/dev/null || true)"
  [[ "$daemon_pid" =~ ^[0-9]+$ ]] && kill -0 "$daemon_pid" 2>/dev/null
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
  if ! pm2_daemon_running; then
    log "PM2 守护进程未运行，跳过。"
    return 0
  fi
  log "关闭 PM2 守护进程..."
  run_pm2 kill || true
}

collect_executable_pids() {
  local executable="$1"
  local proc_exe resolved_executable

  for proc_exe in /proc/[0-9]*/exe; do
    resolved_executable="$(readlink "$proc_exe" 2>/dev/null || true)"
    if [[ "$resolved_executable" == "$executable" || "$resolved_executable" == "$executable (deleted)" ]]; then
      basename "$(dirname "$proc_exe")"
    fi
  done
}

terminate_executable_processes() {
  local label="$1"
  local executable="$2"
  local -a pids=()
  local deadline

  mapfile -t pids < <(collect_executable_pids "$executable")
  ((${#pids[@]} > 0)) || return 0

  log "停止遗留${label}进程: ${pids[*]}"
  kill -TERM "${pids[@]}" 2>/dev/null || true
  deadline=$((SECONDS + 5))
  while ((SECONDS < deadline)); do
    mapfile -t pids < <(collect_executable_pids "$executable")
    ((${#pids[@]} == 0)) && return 0
    sleep 0.1
  done

  log "${label}进程未在 5 秒内退出，强制终止: ${pids[*]}"
  kill -KILL "${pids[@]}" 2>/dev/null || true
}

cleanup_orphaned_client_processes() {
  log "清理遗留前端进程..."
  terminate_executable_processes "Caddy" "$ROOT_DIR/client/noobot-chat/deploy/bin/caddy"
}

cleanup_orphaned_service_processes() {
  log "清理遗留后端进程..."
  pkill -f "$ROOT_DIR/service/app.js" || true
}

cleanup_orphaned_agent_proxy_processes() {
  log "清理遗留代理进程..."
  pkill -f "$ROOT_DIR/agent-proxy/agent-proxy.js" || true
}

cleanup_orphaned_model_proxy_processes() {
  log "清理遗留模型代理进程..."
  pkill -f "$ROOT_DIR/model-proxy/src/index.js" || true
}

main() {
  require_cmd npm

  [[ -d "$SERVICE_DIR" ]] || { echo "后端目录不存在: $SERVICE_DIR" >&2; exit 1; }
  [[ -d "$AGENT_PROXY_DIR" ]] || { echo "代理目录不存在: $AGENT_PROXY_DIR" >&2; exit 1; }
  [[ -d "$MODEL_PROXY_DIR" ]] || { echo "模型代理目录不存在: $MODEL_PROXY_DIR" >&2; exit 1; }

  log "关闭 noobot 服务..."
  stop_and_delete_app "$CLIENT_APP_NAME"
  stop_and_delete_app "$SERVICE_APP_NAME"
  stop_and_delete_app "$AGENT_PROXY_APP_NAME"
  stop_and_delete_app "$MODEL_PROXY_APP_NAME"
  kill_pm2_daemon
  cleanup_orphaned_client_processes
  cleanup_orphaned_service_processes
  cleanup_orphaned_agent_proxy_processes
  cleanup_orphaned_model_proxy_processes

  log "已完成关闭。"
}

main "$@"
