#!/usr/bin/env bash
# Copyright (c) 2026 xiayu
# Contact: 126240622+xiayu1987@users.noreply.github.com
# SPDX-License-Identifier: MIT
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
SERVICE_DIR="$ROOT_DIR/service"
PM2_HOME_DIR="$ROOT_DIR/.pm2"
source "$ROOT_DIR/scripts/runtime-process-config.sh"

[[ -d "$SERVICE_DIR" ]] || { echo "Backend directory not found: $SERVICE_DIR" >&2; exit 1; }

(cd "$SERVICE_DIR" && PM2_HOME="$PM2_HOME_DIR" npx --no-install pm2 stop "${NOOBOT_PM2_APP_NAMES[@]}")
