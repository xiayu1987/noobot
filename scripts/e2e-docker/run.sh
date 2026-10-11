#!/usr/bin/env bash
# Copyright (c) 2026 xiayu
# Contact: 126240622+xiayu1987@users.noreply.github.com
# SPDX-License-Identifier: MIT
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
IMAGE="${NOOBOT_E2E_DOCKER_IMAGE:-noobot-e2e:node26.9.0}"
CONTAINER="${NOOBOT_E2E_DOCKER_CONTAINER:-noobot-e2e}"
HOST_PORT="${NOOBOT_E2E_DOCKER_HOST_PORT:-20060}"
READY_TIMEOUT_S="${NOOBOT_E2E_DOCKER_READY_TIMEOUT_S:-300}"
CONNECT_CODE_FILE="${NOOBOT_E2E_CONNECT_CODE_FILE:-$SCRIPT_DIR/connect-code.local}"
MYSQL_PASSWORD_FILE="${NOOBOT_E2E_MYSQL_PASSWORD_FILE:-$SCRIPT_DIR/mysql-password.local}"

eval "$(env -i PATH="$PATH" node "$ROOT_DIR/scripts/lib/runtime-topology-cli.mjs" --shell)"
CLIENT_PORT="${NOOBOT_TOPOLOGY_CLIENT_ADDR##*:}"
SERVICE_PORT="$PORT"

log() { echo "[e2e-docker] $*"; }

load_connect_code() {
  if [[ -n "${NOOBOT_E2E_CONNECT_CODE:-}" ]]; then
    return 0
  fi
  if [[ ! -f "$CONNECT_CODE_FILE" ]]; then
    log "set NOOBOT_E2E_CONNECT_CODE or write it to $CONNECT_CODE_FILE (chmod 600)"
    return 2
  fi
  if [[ "$(stat -c '%a' "$CONNECT_CODE_FILE")" != "600" ]]; then
    log "$CONNECT_CODE_FILE must be chmod 600"
    return 2
  fi
  NOOBOT_E2E_CONNECT_CODE="$(tr -d '[:space:]' <"$CONNECT_CODE_FILE")"
  export NOOBOT_E2E_CONNECT_CODE
}

load_mysql_password() {
  if [[ -n "${NOOBOT_E2E_MYSQL_PASSWORD:-}" || ! -f "$MYSQL_PASSWORD_FILE" ]]; then
    return 0
  fi
  if [[ "$(stat -c '%a' "$MYSQL_PASSWORD_FILE")" != "600" ]]; then
    log "$MYSQL_PASSWORD_FILE must be chmod 600"
    return 2
  fi
  NOOBOT_E2E_MYSQL_PASSWORD="$(tr -d '\r\n' <"$MYSQL_PASSWORD_FILE")"
  export NOOBOT_E2E_MYSQL_PASSWORD
}

container_running() {
  [[ "$(docker inspect -f '{{.State.Running}}' "$CONTAINER" 2>/dev/null || true)" == "true" ]]
}

cmd_build() {
  docker build -t "$IMAGE" "$SCRIPT_DIR"
}

wait_ready() {
  local deadline=$((SECONDS + READY_TIMEOUT_S))
  until docker exec "$CONTAINER" curl -fsS "http://127.0.0.1:${SERVICE_PORT}/health" >/dev/null 2>&1 \
    && curl -fsS "http://127.0.0.1:${HOST_PORT}/" >/dev/null 2>&1; do
    if ! container_running; then
      log "container exited"
      docker logs --tail 80 "$CONTAINER" || true
      return 1
    fi
    if ((SECONDS >= deadline)); then
      log "not ready after ${READY_TIMEOUT_S}s"
      docker logs --tail 80 "$CONTAINER" || true
      return 1
    fi
    sleep 2
  done
  log "ready: http://127.0.0.1:${HOST_PORT}"
}

cmd_up() {
  if container_running; then
    log "already running"
    return 0
  fi
  docker image inspect "$IMAGE" >/dev/null 2>&1 || cmd_build
  docker run -d --rm --name "$CONTAINER" \
    -e NOOBOT_ROOT="$ROOT_DIR" \
    -v "$ROOT_DIR:$ROOT_DIR" \
    --mount "type=volume,dst=$ROOT_DIR/client/noobot-chat/dist" \
    --mount "type=volume,dst=$ROOT_DIR/client/noobot-chat/node_modules/.vite" \
    --mount "type=volume,dst=$ROOT_DIR/model-proxy/logs" \
    --add-host=host.docker.internal:host-gateway \
    -p "127.0.0.1:${HOST_PORT}:${CLIENT_PORT}" \
    -w "$ROOT_DIR" \
    "$IMAGE" >/dev/null
  wait_ready
}

cmd_down() {
  if container_running; then
    docker stop "$CONTAINER" >/dev/null
  fi
  log "stopped"
}

cmd_restart() {
  if ! container_running; then
    cmd_up
    return
  fi
  docker restart "$CONTAINER" >/dev/null
  wait_ready
}

cmd_status() {
  if ! container_running; then
    log "not running"
    return 1
  fi
  docker exec "$CONTAINER" "$ROOT_DIR/node_modules/.bin/pm2" ls
}

cmd_logs() {
  docker logs --tail "${1:-200}" "$CONTAINER"
}

cmd_test() {
  local suite="${1:-smoke}"
  shift || true
  case "$suite" in
    smoke | core | full) ;;
    *)
      log "unknown suite: $suite (smoke|core|full)"
      return 2
      ;;
  esac
  load_connect_code
  load_mysql_password
  container_running || cmd_up
  local workspace_root="$ROOT_DIR/workspace"
  NOOBOT_E2E_BASE_URL="http://127.0.0.1:${HOST_PORT}" \
    NOOBOT_E2E_USER_ID="${NOOBOT_E2E_USER_ID:-admin}" \
    NOOBOT_E2E_MODEL_ALIAS="${NOOBOT_E2E_MODEL_ALIAS:-gpt_6_1_sol}" \
    NOOBOT_E2E_MYSQL_HOST="${NOOBOT_E2E_MYSQL_HOST:-host.docker.internal}" \
    NOOBOT_WORKSPACE_ROOT="$workspace_root" \
    NOOBOT_E2E_WORKSPACE_ROOT="$workspace_root" \
    NOOBOT_RUNTIME_EVENTS_WORKSPACE_ROOT="$workspace_root" \
    npm --prefix "$ROOT_DIR/client/noobot-chat" run "test:e2e:protocol:${suite}" -- "$@"
}

usage() {
  echo "usage: $0 {build|up|down|restart|status|logs [lines]|test [smoke|core|full] [playwright args]}"
}

command="${1:-}"
shift || true
case "$command" in
  build) cmd_build ;;
  up) cmd_up ;;
  down) cmd_down ;;
  restart) cmd_restart ;;
  status) cmd_status ;;
  logs) cmd_logs "$@" ;;
  test) cmd_test "$@" ;;
  *)
    usage
    exit 2
    ;;
esac
