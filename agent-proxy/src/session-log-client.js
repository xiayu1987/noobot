/*
 * Copyright (c) 2026 xiayu
 * SPDX-License-Identifier: MIT
 */
import { config } from "./config.js";
import {
  createSessionChannelWebSocketClient,
  SESSION_CHANNELS,
} from "@noobot/runtime-events/session-channel";

const DEBUG_ENABLED = ["1", "true", "yes", "on"].includes(
  String(process.env.AGENT_PROXY_SESSION_LOG_DEBUG || "").trim().toLowerCase(),
);
function buildLogWebSocketUrl(apiKey = "") {
  try {
    const target = new URL(config.upstreamHttpBase || "http://127.0.0.1:10061");
    target.protocol = target.protocol === "https:" ? "wss:" : "ws:";
    target.pathname = "/logs/ws";
    target.search = apiKey ? `?apikey=${encodeURIComponent(apiKey)}` : "";
    return target;
  } catch {
    return null;
  }
}

export function createSessionLogClient({ WebSocketImpl } = {}) {
  return createSessionChannelWebSocketClient({
    WebSocketImpl,
    resolveWebSocketUrl: buildLogWebSocketUrl,
    source: "agent-proxy",
    defaultCategory: "agent-proxy",
    defaultEvent: "agentProxy.log",
    defaultSessionId: "agent-proxy",
    debugEnabled: DEBUG_ENABLED,
    channel: SESSION_CHANNELS.AGENT_PROXY_WEB_SOCKET,
  });
}
