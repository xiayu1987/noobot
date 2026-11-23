/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { createServer } from "node:http";
import {
  RUNTIME_EVENT_CATEGORIES,
  RUNTIME_EVENT_CHANNELS,
  RUNTIME_EVENT_SCOPES,
  SERVICE_STARTUP_EVENTS,
  SERVICE_STARTUP_SOURCE,
  writeRuntimeEvent,
} from "@noobot/runtime-events";
import { registerChatWebSocketServer } from "../ws/chat-websocket-server.js";
import { registerLogWebSocketServer } from "../ws/log-websocket-server.js";

export async function startHttpServer({
  app,
  serviceBotAccess,
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
  const webSockets = new Set();
  let completion;
  const close = () => {
    if (!completion)
      completion = (async () => {
        server.removeAllListeners("upgrade");
        server.on("upgrade", (_request, socket) => socket.destroy());
        const operations = [...webSockets].map(
          (wss) =>
            new Promise((resolve, reject) => {
              for (const socket of wss.clients) socket.terminate();
              wss.close((error) => {
                if (error) reject(error);
                else {
                  webSockets.delete(wss);
                  resolve();
                }
              });
            }),
        );
        if (server.listening)
          operations.push(
            new Promise((resolve, reject) => {
              server.close((error) => (error ? reject(error) : resolve()));
            }),
          );
        const results = await Promise.allSettled(operations);
        const errors = results
          .filter((result) => result.status === "rejected")
          .map((result) => result.reason);
        if (errors.length) throw new AggregateError(errors, "HTTP transport cleanup failed");
      })().catch((cause) => {
        completion = undefined;
        throw cause;
      });
    return completion;
  };
  try {
    server.on("upgrade", (request, socket, head) => {
      if (
        openVSCodeService &&
        typeof openVSCodeService.canHandleRequest === "function" &&
        openVSCodeService.canHandleRequest(request?.url || "")
      ) {
        openVSCodeService.proxyUpgrade(request, socket, head);
      }
    });

    webSockets.add(
      registerChatWebSocketServer(server, {
        serviceBotAccess,
        resolveRequestLocale,
        resolveAuthByApiKey,
        mapAgentRunCommand,
        connectorAccessPort,
        normalizeLocale,
        defaultLocale,
        translateText,
      }).webSocketServer,
    );
    webSockets.add(registerLogWebSocketServer(server, { resolveAuthByApiKey }).webSocketServer);
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
      scope: RUNTIME_EVENT_SCOPES.STARTUP,
      source: SERVICE_STARTUP_SOURCE,
      channel: RUNTIME_EVENT_CHANNELS.DIRECT,
      category: RUNTIME_EVENT_CATEGORIES.STATE,
      level: "info",
      event: SERVICE_STARTUP_EVENTS.LISTEN_STARTED,
      data: {
        host: String(listenHost || ""),
        port: listenPort,
      },
    });
    return { server, close };
  } catch (cause) {
    try {
      await close();
    } catch (cleanup) {
      throw new AggregateError([cause, cleanup], "HTTP startup and cleanup failed", { cause });
    }
    throw cause;
  }
}
