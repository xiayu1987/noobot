# Copyright (c) 2026 xiayu
# Contact: 126240622+xiayu1987@users.noreply.github.com
# SPDX-License-Identifier: MIT
FROM node:26.9.0-trixie-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl git ripgrep iproute2 procps \
  && rm -rf /var/lib/apt/lists/* \
  && npm install -g npm@12.0.2

ENV PM2_HOME=/var/lib/noobot-e2e/pm2 \
  NOOBOT_RUNTIME_EVENT_PLUGIN_RUN_CONFIG_DEBUG=true \
  NOOBOT_RUNTIME_EVENT_MODEL_CONTEXT_TRACE_DEBUG=true

COPY entrypoint.sh /usr/local/bin/noobot-e2e-entrypoint
RUN chmod +x /usr/local/bin/noobot-e2e-entrypoint

ENTRYPOINT ["/usr/local/bin/noobot-e2e-entrypoint"]
