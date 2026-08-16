/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
export function createScenarioProfile({ key = "", definition = {}, tools = [], context = [], services = [], mcpServers = [] } = {}) {
  return {
    key: String(key || "").trim(),
    name: String(definition?.name || "").trim(),
    description: String(definition?.description || "").trim(),
    model: String(definition?.model || "").trim(),
    tools: [...tools], context: [...context], services: [...services], mcpServers: [...mcpServers],
  };
}
