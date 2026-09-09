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

