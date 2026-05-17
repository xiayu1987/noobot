/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
function normalizeStringArray(input = []) {
  return Array.isArray(input)
    ? input
        .map((item) => String(item || "").trim())
        .filter(Boolean)
    : [];
}

export function resolveAvailableMcpServers(
  effectiveConfig = {},
  { includeNames = [] } = {},
) {
  const servers = effectiveConfig?.mcpServers || {};
  const normalizedNames = normalizeStringArray(includeNames);
  const hasWildcard = normalizedNames.includes("*");
  const includeNameSet = new Set(normalizedNames);
  // 语义约定：
  // - ["*"] => 全量可用 MCP
  // - [] / 未配置 => 不传任何 MCP
  // - ["a", "b"] => 仅传指定 MCP
  if (!hasWildcard && includeNameSet.size === 0) {
    return [];
  }
  return Object.entries(servers)
    .filter(([name]) => (hasWildcard ? true : includeNameSet.has(name)))
    .filter(([, serverCfg]) => serverCfg?.isActive !== false)
    .map(([name, serverCfg]) => ({
      name,
      type: String(serverCfg?.type || ""),
      description: String(serverCfg?.description || ""),
    }));
}
