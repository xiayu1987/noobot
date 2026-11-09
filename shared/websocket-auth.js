/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
const AUTH_PROTOCOL_PREFIX = "noobot-auth.";

export function createWebSocketAuthProtocols(apiKey) {
  if (typeof apiKey !== "string" || !/^[A-Za-z0-9_-]+$/u.test(apiKey))
    throw new TypeError("WebSocket authentication requires a token-safe API key");
  return [`${AUTH_PROTOCOL_PREFIX}${apiKey}`];
}

export function readWebSocketApiKey(request) {
  const header = request?.headers?.["sec-websocket-protocol"];
  if (typeof header !== "string") return "";
  const protocols = header.split(",").map((value) => value.trim());
  const credentials = protocols.filter((value) => value.startsWith(AUTH_PROTOCOL_PREFIX));
  if (credentials.length !== 1) return "";
  const apiKey = credentials[0].slice(AUTH_PROTOCOL_PREFIX.length);
  return /^[A-Za-z0-9_-]+$/u.test(apiKey) ? apiKey : "";
}
