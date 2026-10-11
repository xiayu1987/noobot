#!/usr/bin/env bash
# Copyright (c) 2026 xiayu
# Contact: 126240622+xiayu1987@users.noreply.github.com
# SPDX-License-Identifier: MIT
set -euo pipefail

: "${NOOBOT_ROOT:?NOOBOT_ROOT is required}"
cd "$NOOBOT_ROOT"

mkdir -p "$PM2_HOME"
echo "[e2e-docker] building client"
npm --prefix client/noobot-chat run build

echo "[e2e-docker] starting pm2-runtime (PM2_HOME=$PM2_HOME)"
exec "$NOOBOT_ROOT/node_modules/.bin/pm2-runtime" "$NOOBOT_ROOT/ecosystem.noobot.config.cjs"
