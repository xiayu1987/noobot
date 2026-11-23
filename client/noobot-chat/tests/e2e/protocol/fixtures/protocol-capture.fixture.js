/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { test as base } from "@playwright/test";
import { sanitizeUrl } from "@noobot/sanitize";
import { createCapturedFrameLog } from "../helpers/websocket-capture.js";

export const captureTest = base.extend({
  protocolCapture: async ({ page, context }, use) => {
    const received = createCapturedFrameLog();
    const evidence = {
      console: [],
      httpRequests: [],
      httpResponses: [],
      websockets: [],
      websocketSent: [],
      websocketReceived: received.records,
    };
    const bindPage = (target) => {
      target.on("console", (message) =>
        evidence.console.push({ type: message.type(), text: message.text() }),
      );
      target.on("request", (request) =>
        evidence.httpRequests.push({
          atMs: performance.now(),
          method: request.method(),
          url: sanitizeUrl(request.url()),
          resourceType: request.resourceType(),
          ...(/replace-turn/i.test(request.url()) ? { postData: request.postData() } : {}),
        }),
      );
      target.on("response", async (response) => {
        const record = {
          atMs: performance.now(),
          status: response.status(),
          url: sanitizeUrl(response.url()),
        };
        if (/replace-turn/i.test(response.url()) && response.status() >= 400) {
          record.body = await response.text().catch(() => "");
        }
        evidence.httpResponses.push(record);
      });
      target.on("websocket", (socket) => {
        const url = sanitizeUrl(socket.url());
        evidence.websockets.push({ url });
        const captureFrame = ({ payload }) =>
          Object.freeze({ atMs: performance.now(), url, payload });
        socket.on("framesent", (frame) => evidence.websocketSent.push(captureFrame(frame)));
        socket.on("framereceived", (frame) => received.append(captureFrame(frame)));
      });
    };
    Object.defineProperty(evidence, "bindPage", { value: bindPage, enumerable: false });
    Object.defineProperty(evidence, "waitForReceivedFrame", { value: received.waitForMatch });
    bindPage(page);
    context.on("page", bindPage);
    await use(evidence);
  },
});
