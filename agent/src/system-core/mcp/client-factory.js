/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { mergeConfig } from "../config/core/config-merge.js";
import { resolveConfigSecrets } from "../config/core/template-resolver.js";
import { normalizeMcpServerType } from "../config/core/enums.js";
import { recoverableToolError } from "../error/index.js";
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
    throw recoverableToolError(
      `${tSystem("mcp.authHeaderEmptyAfterResolve")}: ${name}`,
    );
  }
  return { name, ...server, type: serverType, headers: resolvedHeaders };
}

function resolveHeaders(rawHeaders = {}, configParams = {}) {
  const resolved = resolveConfigSecrets(rawHeaders, { configParams });
  return resolved && typeof resolved === "object" && !Array.isArray(resolved)
    ? resolved
    : {};
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
