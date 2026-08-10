/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { mergeConfig, normalizeMcpServerType } from "@noobot/agent-config-protocol";
import { resolveConfigSecrets } from "../../config/index.js";
import { recoverableToolError } from "../../shared/errors/index.js";
import { tSystem } from "noobot-i18n/agent/system-text";
import { StreamableHttpMcpClient } from "./clients/streamable-http.js";
import { SseMcpClient } from "./clients/sse.js";

export function getMcpServerByName({ globalConfig = {}, userConfig = {}, mcpName = "" }) {
  const name = String(mcpName || "").trim();
  const effectiveConfig = mergeConfig(globalConfig, userConfig);
  const servers = effectiveConfig?.mcpServers || {};
  const server = servers?.[name];
  if (!server) return null;
  if (server?.isActive === false) return null;
  const serverType = normalizeMcpServerType(server?.type);
  if (!serverType) return null;
  if (!String(server?.baseUrl || "").trim()) return null;
  const resolvedHeaders = resolveHeaders(
    server?.headers || {},
    effectiveConfig?.configParams || {},
  );
  const authHeader = String(resolvedHeaders?.Authorization || "").trim();
  if (/^Bearer\s*$/i.test(authHeader)) {
    throw recoverableToolError(`${tSystem("mcp.authHeaderEmptyAfterResolve")}: ${name}`);
  }
  return { name, ...server, type: serverType, headers: resolvedHeaders };
}

function resolveHeaders(rawHeaders = {}, configParams = {}) {
  const resolved = resolveConfigSecrets(rawHeaders, { configParams });
  return resolved && typeof resolved === "object" && !Array.isArray(resolved) ? resolved : {};
}

export function createMcpClient({ server = {}, signal = null, fetchImpl = null }) {
  const commonOptions = {
    baseUrl: server?.baseUrl || "",
    headers: server?.headers || {},
    signal,
    fetchImpl,
  };
  if (server?.type === "sse") {
    return new SseMcpClient(commonOptions);
  }
  return new StreamableHttpMcpClient(commonOptions);
}
