/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { createServer } from "node:http";
import { registerChatWebSocketServer } from "../ws/chat-websocket-server.js";

export function startHttpServer({
  app,
  getBot,
  resolveRequestLocale,
  resolveAuthByApiKey,
  isForbiddenUserScope,
  normalizeRunConfig,
  normalizeLocale,
  defaultLocale,
  translateText,
  openVSCodeService,
  port = process.env.PORT || 10061,
} = {}) {
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
    isForbiddenUserScope,
    normalizeRunConfig,
    normalizeLocale,
    defaultLocale,
    translateText,
  });
  server.listen(port, () => {
    console.log(`Agent server running on :${port}`);
  });
  return server;
}
