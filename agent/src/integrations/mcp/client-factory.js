/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { mergeConfig, normalizeMcpServerType } from "@noobot/agent-config-protocol";
import { ERROR_CODE, recoverableToolError } from "../../shared/errors/index.js";
import { tSystem } from "noobot-i18n/agent/system-text";
import { StreamableHttpMcpClient } from "./clients/streamable-http.js";
import { SseMcpClient } from "./clients/sse.js";
import { isPlainObject, text } from "@noobot/shared/value";

export function getMcpServerByName({ globalConfig = {}, userConfig = {}, mcpName = "" }) {
  const name = text(mcpName);
  const effectiveConfig = mergeConfig(globalConfig, userConfig);
  const servers = effectiveConfig?.mcpServers || {};
  const server = servers?.[name];
  if (!server) return null;
  if (server?.isActive === false) return null;
  const serverType = normalizeMcpServerType(server?.type);
  if (!serverType) return null;
  if (!text(server?.baseUrl)) return null;
  const resolvedHeaders = isPlainObject(server?.headers) ? { ...server.headers } : {};
  const authHeader = text(resolvedHeaders?.Authorization);
  if (/^Bearer\s*$/i.test(authHeader)) {
    throw recoverableToolError(`${tSystem("mcp.authHeaderEmptyAfterResolve")}: ${name}`, {
      code: ERROR_CODE.RECOVERABLE_MCP_AUTH_HEADER_EMPTY,
    });
  }
  return { name, ...server, type: serverType, headers: resolvedHeaders };
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
