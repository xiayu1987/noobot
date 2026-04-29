/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
export function resolveAvailableMcpServers(effectiveConfig = {}) {
  const servers = effectiveConfig?.mcpServers || {};
  return Object.entries(servers)
    .filter(([, serverCfg]) => serverCfg?.isActive !== false)
    .map(([name, serverCfg]) => ({
      name,
      type: String(serverCfg?.type || ""),
      description: String(serverCfg?.description || ""),
    }));
}

