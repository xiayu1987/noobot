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
  port = process.env.PORT || 10061,
} = {}) {
  const server = createServer(app);
  registerChatWebSocketServer(server, {
    bot: getBot(),
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
