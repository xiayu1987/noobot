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

noobot_address_port() {
  local value="${1#*://}"
  value="${value%%/*}"
  value="${value##*:}"
  [[ "$value" =~ ^[0-9]+$ ]] || return 1
  printf '%s\n' "$value"
}

noobot_runtime_ports() {
  noobot_address_port "${CADDY_ADDR:?CADDY_ADDR is required}"
  noobot_address_port "${PORT:?PORT is required}"
  noobot_address_port "${AGENT_PROXY_PORT:?AGENT_PROXY_PORT is required}"
}

noobot_ports_are_listening() {
  local port
  while IFS= read -r port; do
    ss -lnt | grep -q ":${port} " || return 1
  done < <(noobot_runtime_ports)
}

