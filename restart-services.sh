#!/usr/bin/env bash
# Copyright (c) 2026 xiayu
# Contact: 126240622+xiayu1987@users.noreply.github.com
# SPDX-License-Identifier: MIT
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$ROOT_DIR/scripts/runtime-process-config.sh"
CLIENT_DIR="$ROOT_DIR/client/noobot-chat"
SERVICE_DIR="$ROOT_DIR/service"
AGENT_PROXY_DIR="$ROOT_DIR/agent-proxy"
MODEL_PROXY_DIR="$ROOT_DIR/model-proxy"
PM2_HOME_DIR="$ROOT_DIR/.pm2"
PM2_LOG_ROTATE_ENABLED="${PM2_LOG_ROTATE_ENABLED:-true}"
PM2_LOG_ROTATE_MAX_SIZE="${PM2_LOG_ROTATE_MAX_SIZE:-20M}"
PM2_LOG_ROTATE_RETAIN="${PM2_LOG_ROTATE_RETAIN:-14}"
PM2_LOG_ROTATE_WORKER_INTERVAL="${PM2_LOG_ROTATE_WORKER_INTERVAL:-3600}"

run_pm2() {
  (cd "$SERVICE_DIR" && PM2_HOME="$PM2_HOME_DIR" npx pm2 "$@")
}

PM2_ECOSYSTEM_FILE="$ROOT_DIR/ecosystem.noobot.config.cjs"

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

wait_for_runtime_ready() {
  local apps_json elapsed=0
  while ((elapsed < 30)); do
    if apps_json="$(run_pm2 jlist 2>/dev/null)" \
      && echo "$apps_json" | node "$ROOT_DIR/scripts/validate-pm2-processes.mjs" "$ROOT_DIR" >/dev/null 2>&1 \
      && noobot_ports_are_listening; then
      echo "$apps_json" | node "$ROOT_DIR/scripts/validate-pm2-processes.mjs" "$ROOT_DIR"
      return 0
    fi
    sleep 1
    elapsed=$((elapsed + 1))
  done
  echo "Noobot 重启后 30 秒内未就绪" >&2
  run_pm2 ls >&2 || true
  local port
  while IFS= read -r port; do
    ss -lntp | grep ":${port} " >&2 || true
  done < <(noobot_runtime_ports)
  return 1
}

[[ -d "$CLIENT_DIR" ]] || { echo "前端目录不存在: $CLIENT_DIR" >&2; exit 1; }
[[ -d "$SERVICE_DIR" ]] || { echo "后端目录不存在: $SERVICE_DIR" >&2; exit 1; }
[[ -d "$AGENT_PROXY_DIR" ]] || { echo "代理目录不存在: $AGENT_PROXY_DIR" >&2; exit 1; }
[[ -d "$MODEL_PROXY_DIR" ]] || { echo "模型代理目录不存在: $MODEL_PROXY_DIR" >&2; exit 1; }
mkdir -p "$PM2_HOME_DIR"

if ! (cd "$ROOT_DIR" && node "./scripts/check-workspace-runtime-dependencies.mjs" --quiet); then
  echo "Workspace runtime dependencies changed; installing missing workspace links."
  npm --prefix "$ROOT_DIR" install --workspaces
  (cd "$ROOT_DIR" && node "./scripts/check-workspace-runtime-dependencies.mjs" --quiet)
fi

ensure_pm2_log_rotation

export CADDY_ADDR AGENT_PROXY_UPSTREAM PORT
export AGENT_PROXY_PORT AGENT_PROXY_HOST AGENT_PROXY_UPSTREAM_WS_URL AGENT_PROXY_UPSTREAM_HTTP_BASE
[[ -f "$PM2_ECOSYSTEM_FILE" ]] || { echo "PM2 ecosystem 配置不存在: $PM2_ECOSYSTEM_FILE" >&2; exit 1; }
run_pm2 delete "${NOOBOT_PM2_APP_NAMES[@]}" >/dev/null 2>&1 || true
run_pm2 start "$PM2_ECOSYSTEM_FILE" --update-env
wait_for_runtime_ready

run_pm2 ls
