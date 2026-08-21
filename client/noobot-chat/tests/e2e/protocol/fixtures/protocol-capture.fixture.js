/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { test as base } from "@playwright/test";

export const captureTest = base.extend({
  protocolCapture: async ({ page, context }, use) => {
    const evidence = { console: [], httpRequests: [], httpResponses: [], websockets: [], websocketSent: [], websocketReceived: [] };
    const bindPage = (target) => {
      target.on("console", (message) => evidence.console.push({ type: message.type(), text: message.text() }));
      target.on("request", (request) => evidence.httpRequests.push({
        method: request.method(), url: request.url(), resourceType: request.resourceType(),
        ...(/replace-turn/i.test(request.url()) ? { postData: request.postData() } : {}),
      }));
      target.on("response", async (response) => {
        const record = { status: response.status(), url: response.url() };
        if (/replace-turn/i.test(response.url()) && response.status() >= 400) {
          record.body = await response.text().catch(() => "");
        }
        evidence.httpResponses.push(record);
      });
      target.on("websocket", (socket) => {
        evidence.websockets.push({ url: socket.url() });
        socket.on("framesent", ({ payload }) => evidence.websocketSent.push({ url: socket.url(), payload }));
        socket.on("framereceived", ({ payload }) => evidence.websocketReceived.push({ url: socket.url(), payload }));
      });
    };
    Object.defineProperty(evidence, "bindPage", { value: bindPage, enumerable: false });
    bindPage(page);
    context.on("page", bindPage);
    await use(evidence);
  },
});
