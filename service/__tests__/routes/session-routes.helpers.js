/*
 * Copyright (c) 2026 xiayu
 * Contact: xxxxxxxxx+xxxxxxxxx@xxxxx.xxxxxxx.xxxxxx.xxx
 * SPDX-License-Identifier: MIT
 */
import express from "express";
export { express };
export default express;
import { registerSessionRoutes } from "../../routes/session-routes.js";
export { registerSessionRoutes };

export async function withTestServer(app, run) {
  const server = await new Promise((resolve) => {
    const started = app.listen(0, "127.0.0.1", () => resolve(started));
  });
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;
  try {
    await run(baseUrl);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

export function createSessionApp(options = {}) {
  const app = express();
  if (options.json) app.use(express.json());
  registerSessionRoutes(app, {
    bot: {
      session: {
        getSessionData: async () => ({}),
        getRootSessionId: async () => "",
        deleteSessionBranch: async () => ({ deletedSessionIds: [] }),
        getAllSessionsData: async () => [],
        ...(options.session || {}),
      },
      getAttachmentById: async () => null,
      ...(options.bot || {}),
    },
    handleChat: (_req, res) => res.json({ ok: true }),
    getConnectorChannelStore: () => ({}),
    getConnectorHistoryStore: () => ({}),
    translateText: options.translateText || (() => ""),
    ...options.routeOptions,
  });
  return app;
}
