#!/usr/bin/env bash
# Copyright (c) 2026 xiayu
# Contact: 126240622+xiayu1987@users.noreply.github.com
# SPDX-License-Identifier: MIT

NOOBOT_PM2_APP_NAMES=(
  "noobot-service"
  "noobot-agent-proxy"
  "noobot-model-proxy"
  "noobot-client"
)

NOOBOT_RUNTIME_TOPOLOGY_CLI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/runtime-topology-cli.mjs"
eval "$(node "$NOOBOT_RUNTIME_TOPOLOGY_CLI" --shell)"

noobot_runtime_ports() {
  local port
  for port in $NOOBOT_RUNTIME_LISTEN_PORTS; do
    printf '%s\n' "$port"
  done
}

noobot_ports_are_listening() {
  local port
  while IFS= read -r port; do
    ss -lnt | grep -q ":${port} " || return 1
  done < <(noobot_runtime_ports)
}

NOOBOT_SCRIPTS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

noobot_wait_runtime_ready() {
  local root_dir="$1"
  local apps_json readiness status baseline="-" detail last_reported=""
  command -v ss >/dev/null 2>&1 || { echo "Noobot startup requires 'ss' to verify runtime ports" >&2; return 1; }
  while true; do
    if apps_json="$(run_pm2 jlist 2>/dev/null)"; then
      status=0
      readiness="$(echo "$apps_json" | node "$NOOBOT_SCRIPTS_DIR/wait-runtime-ready.mjs" \
        "$root_dir" "$baseline" "${NOOBOT_PM2_APP_NAMES[@]}")" || status=$?
      case "$status" in
        0 | 2)
          read -r _ baseline detail <<<"$readiness"
          ;;
        1)
          echo "Noobot startup failed: $readiness" >&2
          return 1
          ;;
        *)
          echo "Noobot readiness check error (exit $status): $readiness" >&2
          return 1
          ;;
      esac
      if [[ "$status" == 0 ]]; then
        if ! echo "$apps_json" | node "$NOOBOT_SCRIPTS_DIR/validate-pm2-processes.mjs" "$root_dir"; then
          return 1
        fi
        noobot_ports_are_listening && return 0
        detail="waiting-for-ports"
      fi
      if [[ "$detail" != "$last_reported" ]]; then
        echo "Waiting for Noobot startup: $detail"
        last_reported="$detail"
      fi
    fi
    sleep 1
  done
}

noobot_report_runtime_failure() {
  local port
  run_pm2 ls >&2 || true
  while IFS= read -r port; do
    ss -lntp | grep ":${port} " >&2 || true
  done < <(noobot_runtime_ports)
  run_pm2 logs --lines 80 --nostream >&2 || true
}
