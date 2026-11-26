#!/usr/bin/env bash
# Copyright (c) 2026 xiayu
# Contact: 126240622+xiayu1987@users.noreply.github.com
# SPDX-License-Identifier: MIT
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
PLAYWRIGHT_VERSION="$(cd "$ROOT_DIR" && node -p 'require("@playwright/test/package.json").version')"
IMAGE="${NOOBOT_E2E_DOCKER_IMAGE:-noobot-e2e:node26.9.0-pw${PLAYWRIGHT_VERSION}}"
CONTAINER="${NOOBOT_E2E_DOCKER_CONTAINER:-noobot-e2e}"
HOST_PORT="${NOOBOT_E2E_DOCKER_HOST_PORT:-20060}"
READY_TIMEOUT_S="${NOOBOT_E2E_DOCKER_READY_TIMEOUT_S:-300}"
CONNECT_CODE_FILE="${NOOBOT_E2E_CONNECT_CODE_FILE:-$SCRIPT_DIR/connect-code.local}"
MYSQL_PASSWORD_FILE="${NOOBOT_E2E_MYSQL_PASSWORD_FILE:-$SCRIPT_DIR/mysql-password.local}"
SOURCE_WORKSPACE="$ROOT_DIR/workspace"
E2E_WORKSPACE="$ROOT_DIR/.e2e-workspace"
MCP_PROJECT="$ROOT_DIR/scripts/mcp-test-service"
MCP_CONTAINER="$(cd "$ROOT_DIR" && node --input-type=module -e 'import { MCP_TEST_SERVICE } from "./scripts/mcp-test-service/config.mjs"; console.log(MCP_TEST_SERVICE.hostname)')"
NETWORK="noobot-e2e-network"
MOCK_PROJECT="$ROOT_DIR/scripts/mock-model-service"
MOCK_CONTAINER="noobot-mock-model"

TOPOLOGY_EXPORTS="$(cd "$ROOT_DIR" && env -i PATH="$PATH" node ./scripts/lib/runtime-topology-cli.mjs --shell)"
eval "$TOPOLOGY_EXPORTS"
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
  docker build --build-arg "PLAYWRIGHT_VERSION=$PLAYWRIGHT_VERSION" -t "$IMAGE" "$SCRIPT_DIR"
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

stop_container() {
  if docker container inspect "$1" >/dev/null 2>&1; then
    docker rm -f "$1" >/dev/null
  fi
}

teardown() {
  stop_container "$CONTAINER"
  stop_container "$MCP_CONTAINER"
  stop_container "$MOCK_CONTAINER"
}

start_mcp() {
  npm --prefix "$ROOT_DIR" run -s install:mcp-test-service || return 1
  docker run -d --rm --name "$MCP_CONTAINER" --network "$NETWORK" \
    -v "$MCP_PROJECT:/app:ro" -w /app --entrypoint node \
    "$IMAGE" server.mjs >/dev/null || return 1
  local deadline=$((SECONDS + READY_TIMEOUT_S))
  until docker exec "$MCP_CONTAINER" node --input-type=module -e \
    'import { MCP_TEST_SERVICE as c } from "./config.mjs"; const r = await fetch(`http://127.0.0.1:${c.port}/health`); if (!r.ok) process.exit(1);' >/dev/null 2>&1; do
    if ((SECONDS >= deadline)); then
      log "mcp test service not ready after ${READY_TIMEOUT_S}s"
      docker logs --tail 80 "$MCP_CONTAINER" || true
      return 1
    fi
    sleep 2
  done
}

start_mock() {
  [[ "${NOOBOT_E2E_PERF:-}" == "1" ]] || return 0
  docker run -d --rm --name "$MOCK_CONTAINER" --network "$NETWORK" \
    -v "$ROOT_DIR:$ROOT_DIR:ro" -w "$MOCK_PROJECT" --entrypoint node \
    "$IMAGE" server.mjs >/dev/null || return 1
  docker exec "$MOCK_CONTAINER" node --input-type=module -e \
    'import { MOCK_MODEL as c } from "./scenario.mjs"; const r = await fetch(`http://127.0.0.1:${c.port}/health`); if (!r.ok) process.exit(1);'
}

start_service() {
  node "$SCRIPT_DIR/prepare-workspace.mjs" "$SOURCE_WORKSPACE" "$E2E_WORKSPACE" "$ROOT_DIR/service/config/global.config.json" || return 1
  mkdir -p "${E2E_WORKSPACE}.mutation-locks" || return 1
  docker run -d --rm --name "$CONTAINER" --network "$NETWORK" \
    -e NOOBOT_ROOT="$ROOT_DIR" \
    -e NOOBOT_MODEL_PROXY_LOG_DIR="$ROOT_DIR/model-proxy/logs" \
    -v "$ROOT_DIR:$ROOT_DIR" \
    -v "$E2E_WORKSPACE:$SOURCE_WORKSPACE" \
    -v "${E2E_WORKSPACE}.mutation-locks:${SOURCE_WORKSPACE}.mutation-locks" \
    -v "$E2E_WORKSPACE/global.config.json:$ROOT_DIR/service/config/global.config.json:ro" \
    --mount "type=volume,dst=$ROOT_DIR/client/noobot-chat/dist" \
    --mount "type=volume,dst=$ROOT_DIR/client/noobot-chat/node_modules/.vite" \
    --mount "type=volume,dst=$ROOT_DIR/model-proxy/logs" \
    --add-host=host.docker.internal:host-gateway \
    -p "127.0.0.1:${HOST_PORT}:${CLIENT_PORT}" \
    -w "$ROOT_DIR" \
    "$IMAGE" >/dev/null || return 1
  wait_ready
}

cmd_up() {
  if container_running; then
    log "already running"
    return 0
  fi
  teardown
  docker image inspect "$IMAGE" >/dev/null 2>&1 || cmd_build
  if ! docker network inspect "$NETWORK" >/dev/null 2>&1; then
    docker network create "$NETWORK" >/dev/null
  fi
  if ! start_mcp || ! start_mock || ! start_service; then
    teardown
    return 1
  fi
}

cmd_down() {
  teardown
  log "stopped"
}

cmd_restart() {
  cmd_down
  cmd_up
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
    smoke | core | full | perf | perf-single) ;;
    *)
      log "unknown suite: $suite (smoke|core|full|perf|perf-single)"
      return 2
      ;;
  esac
  load_connect_code
  load_mysql_password
  if [[ "$suite" == perf* ]]; then
    export NOOBOT_E2E_PERF=1
    export NOOBOT_E2E_MODEL_ALIAS=e2e_mock
  else
    unset NOOBOT_E2E_PERF
  fi
  cmd_restart
  export NOOBOT_E2E_BASE_URL="http://127.0.0.1:${CLIENT_PORT}"
  export NOOBOT_E2E_USER_ID="${NOOBOT_E2E_USER_ID:-admin}"
  export NOOBOT_E2E_MODEL_ALIAS="${NOOBOT_E2E_MODEL_ALIAS:-gpt_6_1_sol}"
  export NOOBOT_E2E_MYSQL_HOST="${NOOBOT_E2E_MYSQL_HOST:-host.docker.internal}"
  export NOOBOT_WORKSPACE_ROOT="$SOURCE_WORKSPACE"
  local env_args=(
    -e NOOBOT_E2E_BASE_URL -e NOOBOT_E2E_USER_ID -e NOOBOT_E2E_MODEL_ALIAS
    -e NOOBOT_E2E_MYSQL_HOST -e NOOBOT_WORKSPACE_ROOT -e NOOBOT_E2E_CONNECT_CODE
  )
  if [[ "$suite" == perf* ]]; then
    env_args+=(-e NOOBOT_E2E_PERF -e NOOBOT_E2E_PERF_MODE -e NOOBOT_E2E_STREAM_OUTPUT=true)
  fi
  if [[ -n "${NOOBOT_E2E_MYSQL_PASSWORD:-}" ]]; then
    env_args+=(-e NOOBOT_E2E_MYSQL_PASSWORD)
  fi
  docker exec "${env_args[@]}" -w "$ROOT_DIR" "$CONTAINER" \
    npm --prefix "$ROOT_DIR/client/noobot-chat" run "test:e2e:protocol:${suite}" -- "$@"
}

usage() {
  echo "usage: $0 {build|up|down|restart|status|logs [lines]|test [smoke|core|full|perf|perf-single] [playwright args]}"
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
