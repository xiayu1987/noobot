/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { createServer } from "node:http";
import {
  RUNTIME_EVENT_CATEGORIES,
  RUNTIME_EVENT_CHANNELS,
  writeRuntimeEvent,
} from "@noobot/runtime-events";
import { registerChatWebSocketServer } from "../ws/chat-websocket-server.js";
import { registerLogWebSocketServer } from "../ws/log-websocket-server.js";

export async function startHttpServer({
  app,
  getBot,
  resolveRequestLocale,
  resolveAuthByApiKey,
  mapAgentRunCommand,
  connectorAccessPort,
  normalizeLocale,
  defaultLocale,
  translateText,
  openVSCodeService,
  port,
  host,
}) {
  const server = createServer(app);
  server.on("upgrade", (request, socket, head) => {
    if (
      openVSCodeService &&
      typeof openVSCodeService.canHandleRequest === "function" &&
      openVSCodeService.canHandleRequest(request?.url || "")
    ) {
      openVSCodeService.proxyUpgrade(request, socket, head);
    }
  });

  registerChatWebSocketServer(server, {
    getBot,
    resolveRequestLocale,
    resolveAuthByApiKey,
    mapAgentRunCommand,
    connectorAccessPort,
    normalizeLocale,
    defaultLocale,
    translateText,
  });
  registerLogWebSocketServer(server, { resolveAuthByApiKey });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  const listenHost = typeof address === "object" && address ? address.address : "";
  const listenPort = typeof address === "object" && address ? address.port : port;
  await writeRuntimeEvent({
    scope: "startup",
    source: "service",
    channel: RUNTIME_EVENT_CHANNELS.DIRECT,
    category: RUNTIME_EVENT_CATEGORIES.STATE,
    level: "info",
    event: "service.startup.httpServer.listen.started",
    data: {
      host: String(listenHost || ""),
      port: listenPort,
    },
  });
  return server;
}
