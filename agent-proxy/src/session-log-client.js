/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { config } from "./config.js";
import {
  createSessionChannelWebSocketClient,
  SESSION_CHANNELS,
} from "@noobot/runtime-events/session-channel";

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
    channel: SESSION_CHANNELS.AGENT_PROXY_WEB_SOCKET,
  });
}
