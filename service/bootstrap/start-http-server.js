/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { createServer } from "node:http";
import { RUNTIME_PORT_TOPOLOGY } from "@noobot/runtime-topology-protocol/ports";
import {
  RUNTIME_EVENT_CATEGORIES,
  RUNTIME_EVENT_CHANNELS,
  writeRoutedRuntimeEvent,
} from "@noobot/runtime-events";
import { registerChatWebSocketServer } from "../ws/chat-websocket-server.js";
import { registerLogWebSocketServer, resolveSessionLogConfig } from "../ws/log-websocket-server.js";

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
  workspaceRootPath,
  port = process.env.PORT || RUNTIME_PORT_TOPOLOGY.servicePort,
  host = process.env.NOOBOT_SERVICE_HOST || undefined,
} = {}) {
  const server = createServer(app);
  const sessionLogConfig = resolveSessionLogConfig({
    workspaceRoot: typeof workspaceRootPath === "function" ? workspaceRootPath() : undefined,
  });
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
    sessionLogConfig,
  });
  registerLogWebSocketServer(server, {
    resolveAuthByApiKey,
    logConfig: sessionLogConfig,
  });
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
  await writeRoutedRuntimeEvent(
    {
      scope: "startup",
      source: "service",
      channel: RUNTIME_EVENT_CHANNELS.DIRECT,
      category: RUNTIME_EVENT_CATEGORIES.STATE,
      level: "info",
      event: "service.startup.httpServer.listen.started",
      workspaceRoot: sessionLogConfig.workspaceRoot,
      data: {
        host: String(listenHost || ""),
        port: listenPort,
      },
    },
    { ...sessionLogConfig, dirName: "events" },
  );
  return server;
}
