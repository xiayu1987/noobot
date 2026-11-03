/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
export const MCP_TEST_SERVICE = Object.freeze({
  name: "e2e_mcp",
  port: 8080,
  hostname: "noobot-mcp-test",
  path: "/mcp",
});

export function mcpTestServers() {
  const { name, hostname, port, path } = MCP_TEST_SERVICE;
  return {
    [name]: {
      type: "streamableHttp",
      name,
      description: "MCP protocol test service",
      prompt: "Use echo to return the supplied text unchanged.",
      isActive: true,
      baseUrl: `http://${hostname}:${port}${path}`,
      headers: {},
    },
  };
}
